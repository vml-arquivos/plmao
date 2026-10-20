import type { PoolClient } from 'pg';
import { pool, tx } from './db.js';
import { env } from './config.js';

export type Migration = {
  id: string;
  name: string;
  up: (client: PoolClient) => Promise<void>;
};

const rolePermissions: Record<string, string[]> = {
  CLIENTE: ['QUERY_VEHICLE', 'VIEW_HISTORY', 'BUY_CREDITS'],
  OPERADOR: ['QUERY_VEHICLE', 'VIEW_HISTORY', 'BUY_CREDITS', 'VIEW_SENSITIVE_DATA', 'MANAGE_SUPPORT'],
  ADMIN: ['QUERY_VEHICLE', 'VIEW_HISTORY', 'BUY_CREDITS', 'VIEW_SENSITIVE_DATA', 'MANAGE_USERS', 'MANAGE_PRICING', 'MANAGE_PROVIDERS', 'MANAGE_BILLING', 'MANAGE_SUPPORT', 'VIEW_AUDIT'],
  SUPER_ADMIN: ['QUERY_VEHICLE', 'VIEW_HISTORY', 'BUY_CREDITS', 'VIEW_SENSITIVE_DATA', 'MANAGE_USERS', 'MANAGE_PRICING', 'MANAGE_PROVIDERS', 'MANAGE_BILLING', 'MANAGE_SUPPORT', 'VIEW_AUDIT', 'ADMIN_SYSTEM']
};

export const migrations: Migration[] = [
  {
    id: '001_security_and_product_hardening',
    name: 'Security controls, idempotency and configurable products',
    async up(client) {
      await client.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts integer NOT NULL DEFAULT 0;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until timestamptz;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
        ALTER TABLE query_products ADD COLUMN IF NOT EXISTS slug text;
        ALTER TABLE query_products ADD COLUMN IF NOT EXISTS provider_cost_cents integer;
        ALTER TABLE query_products ADD COLUMN IF NOT EXISTS reference_price_cents integer;
        ALTER TABLE query_products ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 100;
        ALTER TABLE query_products ADD COLUMN IF NOT EXISTS features jsonb NOT NULL DEFAULT '[]'::jsonb;
        ALTER TABLE query_products ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
        ALTER TABLE vehicle_queries ADD COLUMN IF NOT EXISTS idempotency_key text;
        ALTER TABLE vehicle_queries ADD COLUMN IF NOT EXISTS request_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
        ALTER TABLE vehicle_queries ADD COLUMN IF NOT EXISTS result_hash text;
        ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
        ALTER TABLE payments ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
        CREATE TABLE IF NOT EXISTS roles (
          id text PRIMARY KEY,
          name text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS permissions (
          id text PRIMARY KEY,
          description text NOT NULL
        );
        CREATE TABLE IF NOT EXISTS role_permissions (
          role_id text NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
          permission_id text NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
          PRIMARY KEY (role_id, permission_id)
        );
        CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));
        CREATE INDEX IF NOT EXISTS idx_vehicle_queries_status_created ON vehicle_queries(status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_vehicle_queries_provider_id ON vehicle_queries(provider_query_id) WHERE provider_query_id IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_queries_user_idempotency ON vehicle_queries(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_payments_user_created ON payments(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_organization_members_user ON organization_members(user_id);
        CREATE INDEX IF NOT EXISTS idx_wallet_transactions_query ON wallet_transactions(query_id) WHERE query_id IS NOT NULL;
      `);

      for (const [role, permissionIds] of Object.entries(rolePermissions)) {
        await client.query('INSERT INTO roles(id,name) VALUES($1,$2) ON CONFLICT(id) DO NOTHING', [role, role.replace('_', ' ')]);
        for (const permissionId of permissionIds) {
          await client.query('INSERT INTO permissions(id,description) VALUES($1,$2) ON CONFLICT(id) DO NOTHING', [permissionId, permissionId.replaceAll('_', ' ').toLowerCase()]);
          await client.query('INSERT INTO role_permissions(role_id,permission_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [role, permissionId]);
        }
      }

      await client.query(`
        UPDATE query_products
        SET slug = COALESCE(slug, lower(id)),
            display_order = CASE id WHEN 'BASIC' THEN 10 WHEN 'DEBTS' THEN 20 WHEN 'COMPLETE' THEN 30 WHEN 'PREMIUM' THEN 40 ELSE display_order END,
            features = CASE id
              WHEN 'BASIC' THEN '["Identificação", "Características", "Situação cadastral"]'::jsonb
              WHEN 'DEBTS' THEN '["Débitos", "Restrições", "Recall"]'::jsonb
              WHEN 'COMPLETE' THEN '["Identificação completa", "Débitos e restrições", "Histórico salvo"]'::jsonb
              WHEN 'PREMIUM' THEN '["Todos os dados disponíveis", "Campos adicionais do provedor"]'::jsonb
              ELSE features
            END,
            updated_at = now()
        WHERE slug IS NULL OR features = '[]'::jsonb;
      `);
    }
  },
  {
    id: '002_query_integrity',
    name: 'Query result integrity and safe reporting indexes',
    async up(client) {
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_vehicle_query_results_created ON vehicle_query_results(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created ON audit_logs(action, created_at DESC);
      `);
    }
  },
  {
    id: '003_identity_and_social_auth',
    name: 'User identities, revocable sessions, consent records and OAuth transaction security',
    async up(client) {
      await client.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS password_enabled boolean NOT NULL DEFAULT true;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
        ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;
        ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

        CREATE TABLE IF NOT EXISTS user_identities (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          provider text NOT NULL CHECK (provider IN ('google','microsoft','apple')),
          provider_account_id text NOT NULL,
          issuer text NOT NULL,
          email_at_provider text,
          email_verified_at timestamptz,
          profile jsonb NOT NULL DEFAULT '{}'::jsonb,
          last_used_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE(provider, provider_account_id),
          UNIQUE(user_id, provider)
        );

        CREATE TABLE IF NOT EXISTS user_sessions (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at timestamptz NOT NULL,
          revoked_at timestamptz,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now(),
          last_seen_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS user_consents (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          consent_type text NOT NULL CHECK (consent_type IN ('TERMS_OF_SERVICE','PRIVACY_POLICY','MARKETING_EMAIL')),
          granted boolean NOT NULL,
          policy_version text NOT NULL,
          source text NOT NULL DEFAULT 'registration',
          ip_hash text,
          created_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS oauth_authorization_states (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          provider text NOT NULL CHECK (provider IN ('google','microsoft','apple')),
          state_hash text NOT NULL UNIQUE,
          nonce text NOT NULL,
          code_verifier text NOT NULL,
          expires_at timestamptz NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS oauth_login_tickets (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          ticket_hash text NOT NULL UNIQUE,
          expires_at timestamptz NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS idx_user_identities_user ON user_identities(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(user_id, expires_at DESC) WHERE revoked_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_user_consents_user_type ON user_consents(user_id, consent_type, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_oauth_states_expiry ON oauth_authorization_states(expires_at);
        CREATE INDEX IF NOT EXISTS idx_oauth_tickets_expiry ON oauth_login_tickets(expires_at);
      `);
    }
  },
  {
    id: '004_commerce_and_operational_controls',
    name: 'Credit packages, checkout orders, payment events and production provider controls',
    async up(client) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS credit_packages (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          slug text NOT NULL UNIQUE,
          name text NOT NULL,
          description text NOT NULL,
          credits integer NOT NULL CHECK (credits > 0),
          price_cents integer NOT NULL CHECK (price_cents > 0),
          active boolean NOT NULL DEFAULT true,
          display_order integer NOT NULL DEFAULT 100,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS payment_orders (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES users(id),
          package_id uuid NOT NULL REFERENCES credit_packages(id),
          status text NOT NULL CHECK (status IN ('CREATED','CHECKOUT_ACTIVE','PAID','CANCELLED','EXPIRED','FAILED','REFUNDED')),
          amount_cents integer NOT NULL CHECK (amount_cents > 0),
          credits integer NOT NULL CHECK (credits > 0),
          provider text NOT NULL,
          external_reference text NOT NULL UNIQUE,
          provider_checkout_id text UNIQUE,
          checkout_url text,
          paid_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS payment_webhook_events (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          provider text NOT NULL,
          provider_event_id text NOT NULL,
          event_type text NOT NULL,
          order_id uuid REFERENCES payment_orders(id),
          payload jsonb NOT NULL DEFAULT '{}'::jsonb,
          received_at timestamptz NOT NULL DEFAULT now(),
          processed_at timestamptz,
          processing_error text,
          UNIQUE(provider, provider_event_id)
        );
        ALTER TABLE payments ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES payment_orders(id);
        ALTER TABLE payments ADD COLUMN IF NOT EXISTS checkout_url text;
        ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_status text;
        CREATE INDEX IF NOT EXISTS idx_credit_packages_active_order ON credit_packages(active,display_order);
        CREATE INDEX IF NOT EXISTS idx_payment_orders_user_created ON payment_orders(user_id,created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_payment_orders_status_created ON payment_orders(status,created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_order ON payment_webhook_events(order_id,received_at DESC);
      `);
      const packages = [
        ['essencial','Pacote Essencial','Saldo pré-pago para consultas pontuais.',10,1990,10],
        ['completo','Pacote Completo','Saldo pré-pago para uma decisão de compra mais informada.',30,4990,20],
        ['profissional','Pacote Profissional','Saldo pré-pago para uso recorrente e operações.',100,13990,30]
      ];
      for (const [slug, name, description, credits, priceCents, displayOrder] of packages) {
        await client.query(`INSERT INTO credit_packages(slug,name,description,credits,price_cents,display_order)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,credits=EXCLUDED.credits,price_cents=EXCLUDED.price_cents,display_order=EXCLUDED.display_order,updated_at=now()`, [slug,name,description,credits,priceCents,displayOrder]);
      }
    }
  },
  {
    id: '005_fipe_funnel_reports',
    name: 'Free FIPE funnel, persistent cache, report documents and source metadata',
    async up(client) {
      await client.query(`
        ALTER TABLE query_products ADD COLUMN IF NOT EXISTS supplier_cost_cents integer NOT NULL DEFAULT 0;
        ALTER TABLE query_products ADD COLUMN IF NOT EXISTS min_margin_cents integer NOT NULL DEFAULT 0;
        ALTER TABLE query_products ADD COLUMN IF NOT EXISTS source text;
        ALTER TABLE query_products ADD COLUMN IF NOT EXISTS coverage text;
        ALTER TABLE query_products ADD COLUMN IF NOT EXISTS commercial_status text NOT NULL DEFAULT 'ACTIVE';
        ALTER TABLE query_products ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false;
        ALTER TABLE query_products ADD COLUMN IF NOT EXISTS is_free boolean NOT NULL DEFAULT false;

        CREATE TABLE IF NOT EXISTS fipe_cache (
          cache_key text PRIMARY KEY,
          provider text NOT NULL,
          vehicle_type text NOT NULL CHECK (vehicle_type IN ('cars','motorcycles','trucks')),
          brand_id text NOT NULL,
          model_id text NOT NULL,
          year_id text NOT NULL,
          reference_code text,
          reference_month text NOT NULL,
          payload jsonb NOT NULL,
          expires_at timestamptz NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_fipe_cache_expiry ON fipe_cache(expires_at);

        CREATE TABLE IF NOT EXISTS fipe_usage (
          scope_key text NOT NULL,
          bucket_date date NOT NULL,
          count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (scope_key, bucket_date)
        );

        CREATE TABLE IF NOT EXISTS report_documents (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          document_code text NOT NULL UNIQUE,
          query_id uuid REFERENCES vehicle_queries(id) ON DELETE SET NULL,
          user_id uuid REFERENCES users(id) ON DELETE SET NULL,
          report_kind text NOT NULL CHECK (report_kind IN ('FIPE_FREE','VEHICLE_QUERY')),
          report_version integer NOT NULL DEFAULT 1 CHECK (report_version > 0),
          provider text NOT NULL,
          report_hash text NOT NULL,
          snapshot jsonb NOT NULL,
          previous_document_id uuid REFERENCES report_documents(id),
          superseded_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_report_documents_user_created ON report_documents(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_report_documents_query_created ON report_documents(query_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS query_source_rules (
          product_id text NOT NULL REFERENCES query_products(id) ON DELETE CASCADE,
          source_type text NOT NULL,
          provider text NOT NULL,
          active boolean NOT NULL DEFAULT false,
          priority integer NOT NULL DEFAULT 100,
          coverage text NOT NULL DEFAULT '',
          PRIMARY KEY(product_id, source_type, provider)
        );

        CREATE TABLE IF NOT EXISTS provider_health_events (
          id bigserial PRIMARY KEY,
          provider text NOT NULL,
          source_type text NOT NULL,
          status text NOT NULL,
          latency_ms integer,
          error_code text,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_provider_health_created ON provider_health_events(provider, source_type, created_at DESC);

        CREATE TABLE IF NOT EXISTS funnel_events (
          id bigserial PRIMARY KEY,
          user_id uuid REFERENCES users(id) ON DELETE SET NULL,
          session_key text,
          event_type text NOT NULL,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_funnel_events_type_created ON funnel_events(event_type, created_at DESC);
      `);

      await client.query(`
        INSERT INTO query_products(id,name,description,credit_cost,slug,features,display_order,source,coverage,commercial_status,featured,is_free)
        VALUES('FIPE_FREE','Consulta FIPE Grátis','Valor médio da Tabela FIPE vigente, com relatório e impressão.',0,'fipe-free','["Valor FIPE vigente","Referência mensal","PDF e impressão","Checklist de compra segura"]'::jsonb,1,'Parallelum/FIPE API v2 com fallback BrasilAPI','Tabela FIPE mensal; não consulta situação documental.','FREE',true,true)
        ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,credit_cost=0,slug=EXCLUDED.slug,features=EXCLUDED.features,display_order=EXCLUDED.display_order,source=EXCLUDED.source,coverage=EXCLUDED.coverage,commercial_status=EXCLUDED.commercial_status,featured=EXCLUDED.featured,is_free=true;

        INSERT INTO query_products(id,name,description,credit_cost,active,slug,features,display_order,source,coverage,commercial_status,featured,is_free)
        VALUES
          ('CADASTRAL','Consulta Cadastral Essencial','Confirme se as características do anúncio correspondem ao veículo registrado.',5,false,'cadastral-essencial','["Placa","Marca e modelo","Ano, cor e combustível","Município e UF","Chassi e RENAVAM mascarados"]'::jsonb,10,'Aguardando provider veicular autorizado','Cobertura conforme contrato do fornecedor; produto em breve.','SOON',false,false),
          ('RESTRICTIONS','Restrições e Gravame','Verifique impedimentos que podem afetar a negociação ou transferência.',8,false,'restricoes-gravame','["Gravame","Restrições financeiras","Restrição judicial","Roubo/furto quando coberto"]'::jsonb,20,'Aguardando fonte contratada e autorizada','Cobertura conforme contrato do fornecedor; produto em breve.','SOON',false,false)
        ON CONFLICT(id) DO NOTHING;

        UPDATE query_products SET source=COALESCE(source,'Provider veicular contratado'), coverage=COALESCE(coverage,description), commercial_status=COALESCE(commercial_status,'ACTIVE'), is_free=COALESCE(is_free,false) WHERE id <> 'FIPE_FREE';

        INSERT INTO query_source_rules(product_id,source_type,provider,active,priority,coverage) VALUES
          ('FIPE_FREE','FIPE','parallelum',true,10,'Valor médio e referência mensal da Tabela FIPE'),
          ('FIPE_FREE','FIPE','brasilapi',true,20,'Fallback documentado de consulta FIPE'),
          ('CADASTRAL','IDENTITY','official',false,10,'Aguardando provider veicular autorizado'),
          ('RESTRICTIONS','RESTRICTIONS','contracted',false,10,'Aguardando fonte contratada e autorizada'),
          ('BASIC','IDENTITY','official',false,20,'Aguardando provider veicular autorizado'),
          ('DEBTS','DEBTS','official',false,10,'Aguardando cobertura contratada'),
          ('COMPLETE','FIPE','parallelum',false,10,'Ativação progressiva'),
          ('PREMIUM','PREMIUM','contracted',false,10,'Aguardando fornecedores licenciados')
        ON CONFLICT(product_id,source_type,provider) DO NOTHING;
      `);
    }
  },
  {
    id: '006_profile_and_password_recovery',
    name: 'Profile editing and single-use password reset tokens',
    async up(client) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash text NOT NULL UNIQUE,
          expires_at timestamptz NOT NULL,
          used_at timestamptz,
          request_ip_hash text,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_created ON password_reset_tokens(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_active ON password_reset_tokens(token_hash, expires_at) WHERE used_at IS NULL;
      `);
    }
  },
  {
    id: '007_admin_commercial_controls',
    name: 'Admin series, coupons, affiliates and organization branding',
    async up(client) {
      await client.query(`
        ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS subtotal_cents integer;
        ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS discount_cents integer NOT NULL DEFAULT 0;
        ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS coupon_id uuid;
        ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS affiliate_id uuid;
        ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS affiliate_commission_bps integer NOT NULL DEFAULT 0;
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS slug text;
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS primary_color text;
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS accent_color text;
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS logo_url text;
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS custom_domain text;
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug) WHERE slug IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_custom_domain ON organizations(custom_domain) WHERE custom_domain IS NOT NULL;
        CREATE TABLE IF NOT EXISTS platform_settings (
          key text PRIMARY KEY,
          value jsonb NOT NULL DEFAULT '{}'::jsonb,
          updated_by uuid REFERENCES users(id),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS coupons (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          code text NOT NULL UNIQUE,
          discount_type text NOT NULL CHECK (discount_type IN ('PERCENT','FIXED')),
          discount_value integer NOT NULL CHECK (discount_value > 0),
          max_redemptions integer CHECK (max_redemptions IS NULL OR max_redemptions > 0),
          redeemed_count integer NOT NULL DEFAULT 0,
          starts_at timestamptz,
          expires_at timestamptz,
          active boolean NOT NULL DEFAULT true,
          created_by uuid REFERENCES users(id),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS affiliates (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid REFERENCES users(id) ON DELETE SET NULL,
          name text NOT NULL,
          email text,
          code text NOT NULL UNIQUE,
          commission_bps integer NOT NULL DEFAULT 1000 CHECK (commission_bps >= 0 AND commission_bps <= 5000),
          active boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE SET NULL;
        CREATE TABLE IF NOT EXISTS affiliate_commissions (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          affiliate_id uuid NOT NULL REFERENCES affiliates(id),
          payment_id uuid UNIQUE REFERENCES payments(id),
          order_id uuid REFERENCES payment_orders(id),
          amount_cents integer NOT NULL CHECK (amount_cents >= 0),
          status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','CANCELLED')),
          created_at timestamptz NOT NULL DEFAULT now(),
          paid_at timestamptz
        );
        CREATE TABLE IF NOT EXISTS coupon_redemptions (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          coupon_id uuid NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
          payment_order_id uuid NOT NULL UNIQUE REFERENCES payment_orders(id) ON DELETE CASCADE,
          status text NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED','REDEEMED','RELEASED')),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          redeemed_at timestamptz
        );
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_payment_orders_coupon') THEN
            ALTER TABLE payment_orders ADD CONSTRAINT fk_payment_orders_coupon FOREIGN KEY (coupon_id) REFERENCES coupons(id);
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_payment_orders_affiliate') THEN
            ALTER TABLE payment_orders ADD CONSTRAINT fk_payment_orders_affiliate FOREIGN KEY (affiliate_id) REFERENCES affiliates(id);
          END IF;
        END $$;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_coupons_code_upper ON coupons(upper(code));
        CREATE UNIQUE INDEX IF NOT EXISTS idx_affiliates_code_upper ON affiliates(upper(code));
        CREATE UNIQUE INDEX IF NOT EXISTS idx_affiliates_user ON affiliates(user_id) WHERE user_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_payment_orders_coupon ON payment_orders(coupon_id);
        CREATE INDEX IF NOT EXISTS idx_payment_orders_affiliate ON payment_orders(affiliate_id);
        ALTER TABLE users ADD COLUMN IF NOT EXISTS affiliate_id uuid REFERENCES affiliates(id);
        CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_affiliate ON affiliate_commissions(affiliate_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_coupons_active_window ON coupons(active, starts_at, expires_at);
        CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon_status ON coupon_redemptions(coupon_id, status);
        CREATE INDEX IF NOT EXISTS idx_users_affiliate ON users(affiliate_id);
        CREATE INDEX IF NOT EXISTS idx_organization_members_org_user ON organization_members(organization_id, user_id);
      `);
    }
  },
  {
    id: '008_configurable_reports_org_pricing_security',
    name: 'Configurable reports, organization pricing and security controls',
    async up(client) {
      await client.query(`
        ALTER TABLE query_products ADD COLUMN IF NOT EXISTS reference_price_cents integer;
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'query_products_reference_price_cents_check') THEN
            ALTER TABLE query_products ADD CONSTRAINT query_products_reference_price_cents_check CHECK (reference_price_cents IS NULL OR reference_price_cents >= 0);
          END IF;
        END $$;
        CREATE TABLE IF NOT EXISTS report_templates (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          product_id text NOT NULL REFERENCES query_products(id) ON DELETE CASCADE,
          version integer NOT NULL CHECK (version > 0),
          name text NOT NULL,
          status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED')),
          config jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object' AND config::text !~* '"(owner|ownername|ownerdocument|cpf|cnpj|document|address|phone|email)"'),
          created_by uuid REFERENCES users(id),
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE(product_id, version)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_report_templates_published_product ON report_templates(product_id) WHERE status = 'PUBLISHED';
        CREATE INDEX IF NOT EXISTS idx_report_templates_product_status ON report_templates(product_id, status, version DESC);
        CREATE TABLE IF NOT EXISTS product_report_configs (
          product_id text PRIMARY KEY REFERENCES query_products(id) ON DELETE CASCADE,
          template_id uuid NOT NULL REFERENCES report_templates(id),
          mode text NOT NULL DEFAULT 'SNAPSHOT' CHECK (mode IN ('SNAPSHOT','LIVE')),
          formats text[] NOT NULL DEFAULT ARRAY['JSON','HTML','PDF'],
          updated_by uuid REFERENCES users(id),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        ALTER TABLE report_documents ADD COLUMN IF NOT EXISTS product_id text;
        ALTER TABLE report_documents ADD COLUMN IF NOT EXISTS template_id uuid;
        ALTER TABLE report_documents ADD COLUMN IF NOT EXISTS template_version integer;
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_documents_product_id_fkey') THEN
            ALTER TABLE report_documents ADD CONSTRAINT report_documents_product_id_fkey FOREIGN KEY (product_id) REFERENCES query_products(id);
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_documents_template_id_fkey') THEN
            ALTER TABLE report_documents ADD CONSTRAINT report_documents_template_id_fkey FOREIGN KEY (template_id) REFERENCES report_templates(id);
          END IF;
        END $$;
        CREATE INDEX IF NOT EXISTS idx_report_documents_product_created ON report_documents(product_id, created_at DESC);

        INSERT INTO report_templates(product_id,version,name,status,config)
        SELECT p.id,1,p.name || ' — relatório padrão','PUBLISHED',jsonb_build_object(
          'title',p.name,
          'subtitle','Relatório veicular Placa na Mão',
          'sections',jsonb_build_array(
            jsonb_build_object('key','identification','label','Identificação do veículo','order',10,'visible',true,'fields',jsonb_build_array(
              jsonb_build_object('key','identification.plate','label','Placa','visible',true),
              jsonb_build_object('key','identification.brand','label','Marca','visible',true),
              jsonb_build_object('key','identification.model','label','Modelo','visible',true),
              jsonb_build_object('key','characteristics.modelYear','label','Ano do modelo','visible',true),
              jsonb_build_object('key','characteristics.color','label','Cor','visible',true),
              jsonb_build_object('key','characteristics.fuel','label','Combustível','visible',true)
            )),
            jsonb_build_object('key','registration','label','Registro e situação','order',20,'visible',true,'fields',jsonb_build_array(
              jsonb_build_object('key','registration.city','label','Município','visible',true),
              jsonb_build_object('key','registration.state','label','UF','visible',true),
              jsonb_build_object('key','registration.status','label','Situação','visible',true),
              jsonb_build_object('key','registration.licensingYear','label','Ano de licenciamento','visible',true)
            )),
            jsonb_build_object('key','coverage','label','Cobertura contratada','order',30,'visible',true,'fields',jsonb_build_array(
              jsonb_build_object('key','coverage','label','Cobertura','visible',true),
              jsonb_build_object('key','debts','label','Débitos','visible',true),
              jsonb_build_object('key','restrictions','label','Restrições','visible',true),
              jsonb_build_object('key','recall','label','Recall','visible',true)
            ))
          )
        )
        FROM query_products p
        WHERE NOT EXISTS (SELECT 1 FROM report_templates t WHERE t.product_id=p.id AND t.version=1);

        INSERT INTO product_report_configs(product_id,template_id,mode,formats)
        SELECT p.id,t.id,'SNAPSHOT',ARRAY['JSON','HTML','PDF']
        FROM query_products p JOIN report_templates t ON t.product_id=p.id AND t.version=1 AND t.status='PUBLISHED'
        WHERE NOT EXISTS (SELECT 1 FROM product_report_configs c WHERE c.product_id=p.id);

        CREATE TABLE IF NOT EXISTS organization_credit_package_prices (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          package_id uuid NOT NULL REFERENCES credit_packages(id) ON DELETE CASCADE,
          price_cents integer NOT NULL CHECK (price_cents > 0),
          active boolean NOT NULL DEFAULT true,
          starts_at timestamptz,
          ends_at timestamptz,
          created_by uuid REFERENCES users(id),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE(organization_id, package_id),
          CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
        );
        CREATE INDEX IF NOT EXISTS idx_org_credit_package_prices_window ON organization_credit_package_prices(organization_id, package_id, active, starts_at, ends_at);
        CREATE TABLE IF NOT EXISTS team_totp (
          user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          encrypted_secret text NOT NULL,
          enabled_at timestamptz,
          last_verified_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS team_totp_recovery_codes (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          code_hash text NOT NULL,
          used_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_team_totp_recovery_user_active ON team_totp_recovery_codes(user_id) WHERE used_at IS NULL;
        CREATE TABLE IF NOT EXISTS auth_challenges (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          kind text NOT NULL CHECK (kind IN ('TOTP_LOGIN','TOTP_ENROLL')),
          token_hash text NOT NULL UNIQUE,
          expires_at timestamptz NOT NULL,
          used_at timestamptz,
          ip_hash text,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_auth_challenges_active ON auth_challenges(token_hash, expires_at) WHERE used_at IS NULL;
        CREATE TABLE IF NOT EXISTS contact_messages (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid REFERENCES users(id) ON DELETE SET NULL,
          name text NOT NULL,
          email text NOT NULL,
          subject text NOT NULL,
          message text NOT NULL,
          category text NOT NULL DEFAULT 'SUPPORT' CHECK (category IN ('SUPPORT','PRIVACY','LGPD','COMMERCIAL')),
          status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','CLOSED')),
          created_at timestamptz NOT NULL DEFAULT now(),
          closed_at timestamptz
        );
        CREATE INDEX IF NOT EXISTS idx_contact_messages_status_created ON contact_messages(status, created_at DESC);
        CREATE TABLE IF NOT EXISTS audit_retention_runs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          cutoff_at timestamptz NOT NULL,
          deleted_count integer NOT NULL DEFAULT 0 CHECK (deleted_count >= 0),
          executed_by uuid REFERENCES users(id),
          created_at timestamptz NOT NULL DEFAULT now()
        );
      `);
    }
  },
  {
    id: '009_query_money_pricing_migration',
    name: 'Monetary query pricing, audited wallet conversion and direct query orders',
    async up(client) {
      await client.query(`
        ALTER TABLE query_products ADD COLUMN IF NOT EXISTS price_cents integer;
        UPDATE query_products
        SET price_cents = CASE
          WHEN COALESCE(is_free, false) THEN 0
          ELSE COALESCE(reference_price_cents, GREATEST(credit_cost, 1) * 100)
        END
        WHERE price_cents IS NULL;
        ALTER TABLE query_products ALTER COLUMN price_cents SET DEFAULT 0;
        ALTER TABLE query_products ALTER COLUMN price_cents SET NOT NULL;
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='query_products_price_cents_check') THEN
            ALTER TABLE query_products ADD CONSTRAINT query_products_price_cents_check CHECK (price_cents >= 0);
          END IF;
        END $$;

        ALTER TABLE wallets ADD COLUMN IF NOT EXISTS balance_cents integer NOT NULL DEFAULT 0 CHECK (balance_cents >= 0);
        ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS amount_cents integer NOT NULL DEFAULT 0;
        ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS balance_before_cents integer NOT NULL DEFAULT 0;
        ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS balance_after_cents integer NOT NULL DEFAULT 0;
        UPDATE wallet_transactions SET amount_cents = amount * 100, balance_before_cents = balance_before * 100, balance_after_cents = balance_after * 100 WHERE amount_cents = 0 AND (amount <> 0 OR balance_before <> 0 OR balance_after <> 0);
        ALTER TABLE vehicle_queries ADD COLUMN IF NOT EXISTS price_cents integer NOT NULL DEFAULT 0;
        ALTER TABLE vehicle_queries ADD COLUMN IF NOT EXISTS charge_source text NOT NULL DEFAULT 'LEGACY_CREDIT';
        ALTER TABLE vehicle_queries ADD COLUMN IF NOT EXISTS payment_order_id uuid;
        ALTER TABLE payments ALTER COLUMN credits SET DEFAULT 0;
        ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS purchase_type text NOT NULL DEFAULT 'CREDIT_PACKAGE';
        ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS product_id text;
        ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS query_plate text;
        ALTER TABLE payment_orders ALTER COLUMN package_id DROP NOT NULL;
        ALTER TABLE payment_orders ALTER COLUMN credits DROP NOT NULL;
        ALTER TABLE payment_orders ALTER COLUMN credits SET DEFAULT 0;
        DO $$ DECLARE constraint_name text; BEGIN
          FOR constraint_name IN
            SELECT c.conname FROM pg_constraint c
            JOIN pg_class t ON t.oid=c.conrelid
            WHERE t.relname='payment_orders' AND c.contype='c' AND pg_get_constraintdef(c.oid) ILIKE '%credits%'
          LOOP
            EXECUTE format('ALTER TABLE payment_orders DROP CONSTRAINT IF EXISTS %I', constraint_name);
          END LOOP;
        END $$;
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='payment_orders_credits_nonnegative_check') THEN
            ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_credits_nonnegative_check CHECK (credits >= 0);
          END IF;
        END $$;
        ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS subtotal_cents integer;
        ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS amount_cents integer;
        ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS affiliate_code text;
        ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS discount_cents integer NOT NULL DEFAULT 0;
        CREATE TABLE IF NOT EXISTS organization_query_prices (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          product_id text NOT NULL REFERENCES query_products(id) ON DELETE CASCADE,
          price_cents integer NOT NULL CHECK (price_cents >= 0),
          active boolean NOT NULL DEFAULT true,
          starts_at timestamptz,
          ends_at timestamptz,
          created_by uuid REFERENCES users(id),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE(organization_id, product_id),
          CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
        );
        CREATE INDEX IF NOT EXISTS idx_org_query_prices_window ON organization_query_prices(organization_id, product_id, active, starts_at, ends_at);
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='payment_orders_purchase_type_check') THEN
            ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_purchase_type_check CHECK (purchase_type IN ('CREDIT_PACKAGE','QUERY'));
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='payment_orders_product_id_fkey') THEN
            ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_product_id_fkey FOREIGN KEY (product_id) REFERENCES query_products(id);
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='vehicle_queries_payment_order_id_fkey') THEN
            ALTER TABLE vehicle_queries ADD CONSTRAINT vehicle_queries_payment_order_id_fkey FOREIGN KEY (payment_order_id) REFERENCES payment_orders(id);
          END IF;
        END $$;

        CREATE TABLE IF NOT EXISTS wallet_money_conversions (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
          legacy_credit_balance integer NOT NULL CHECK (legacy_credit_balance >= 0),
          converted_balance_cents integer NOT NULL CHECK (converted_balance_cents >= 0),
          conversion_rate_cents integer NOT NULL DEFAULT 100 CHECK (conversion_rate_cents > 0),
          audit_log_id bigint REFERENCES audit_logs(id),
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS query_payment_entitlements (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          order_id uuid NOT NULL UNIQUE REFERENCES payment_orders(id) ON DELETE CASCADE,
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          product_id text NOT NULL REFERENCES query_products(id),
          plate text NOT NULL,
          status text NOT NULL DEFAULT 'READY' CHECK (status IN ('READY','CONSUMED','FAILED')),
          query_id uuid REFERENCES vehicle_queries(id),
          created_at timestamptz NOT NULL DEFAULT now(),
          consumed_at timestamptz
        );
        CREATE INDEX IF NOT EXISTS idx_query_entitlements_user_status ON query_payment_entitlements(user_id, status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_payment_orders_query_product ON payment_orders(product_id, purchase_type, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_vehicle_queries_payment_order ON vehicle_queries(payment_order_id) WHERE payment_order_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_payment_orders_user_query ON payment_orders(user_id, purchase_type, product_id, created_at DESC);

        INSERT INTO wallet_money_conversions(user_id,legacy_credit_balance,converted_balance_cents)
        SELECT w.user_id,w.balance,w.balance * 100
        FROM wallets w
        ON CONFLICT(user_id) DO NOTHING;
        UPDATE wallets w
        SET balance_cents = c.converted_balance_cents,
            balance = 0,
            updated_at = now()
        FROM wallet_money_conversions c
        WHERE c.user_id=w.user_id;
        INSERT INTO audit_logs(user_id,action,entity,entity_id,metadata)
        SELECT c.user_id,'CONVERT_LEGACY_CREDITS_TO_CENTS','WALLET',c.user_id::text,
          jsonb_build_object('legacyCreditBalance',c.legacy_credit_balance,'convertedBalanceCents',c.converted_balance_cents,'conversionRateCents',c.conversion_rate_cents,'migration','009_query_money_pricing_migration')
        FROM wallet_money_conversions c
        WHERE c.audit_log_id IS NULL;
        UPDATE wallet_money_conversions c
        SET audit_log_id = a.id
        FROM audit_logs a
        WHERE c.audit_log_id IS NULL
          AND a.user_id=c.user_id
          AND a.action='CONVERT_LEGACY_CREDITS_TO_CENTS'
          AND a.entity_id=c.user_id::text
          AND a.metadata->>'migration'='009_query_money_pricing_migration';
      `);
    }
  }
];

export async function runMigrations(): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id text PRIMARY KEY,
    name text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await tx(async (client) => {
        await client.query(`SELECT set_config('lock_timeout', $1, true)`, [`${env.MIGRATION_LOCK_TIMEOUT_MS}ms`]);
        await client.query('SELECT pg_advisory_xact_lock(8432026)');
        for (const migration of migrations) {
          const applied = await client.query('SELECT 1 FROM schema_migrations WHERE id=$1', [migration.id]);
          if (applied.rowCount) continue;
          await migration.up(client);
          await client.query('INSERT INTO schema_migrations(id,name) VALUES($1,$2)', [migration.id, migration.name]);
        }
      });
      return;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (code !== '55P03' || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * attempt, 3000)));
    }
  }
}
