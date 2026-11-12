import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Migration } from './migrations.js';
import { readImageInfo } from './lib/imageInfo.js';
import { SEED_SOURCE, VEHICLE_SEED } from './data/vehicleSeed.js';
import { EXTRA_SEED_SOURCE, EXTRA_VEHICLE_SEED } from './data/vehicleSeedExtra.js';
import { CONSUMPTION_SEED, HONDA_CIVIC_OBS, COROLLA_HYBRID_VERSION, CIVIC_MODEL, CIVIC_SUMMARY, INMETRO_NAME, INMETRO_PBEV_2024_URL, COLLECTED_AT, type ConsumptionSeed } from './data/consumptionSeed.js';
import { VEHICLE_PHOTOS, photoPage, photoUrl } from './data/vehiclePhotos.js';
import { readBundledSnapshot, upsertCatalog, rematchCatalog } from './lib/catalog.js';
import { FIELD_CATALOG, VT_CATALOG } from './report/catalog.js';
import { planPackages } from './pricing/packagePlanner.js';
import { loadPaymentSettings } from './pricing/settings.js';
import { floorPriceFor } from './pricing/productPricing.js';
import { FINANCING_FAQS, SEED_ARTICLES, SUPPORT_FAQS, SEED_FAQS, SEED_FEATURES, SEED_MATRIX } from './content.seed.js';

/**
 * Migrações do produto Placa na Mão (010+): configurações de pagamento, comissões/repasses,
 * preços de referência, API pública, dados sensíveis em repouso e auditoria de revelação de PII.
 * Dinheiro: centavos inteiros · percentuais: basis points.
 */
/** Aplica o padrão do código nas páginas de SEO nunca editadas no painel, guardando o valor anterior em seo_pages_history. */
async function reviewSeoRows(client: Parameters<Migration['up']>[0], reason: string): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS seo_pages_history (
      id bigserial PRIMARY KEY,
      path text NOT NULL,
      h1 text, title text, description text, keyword text,
      sections jsonb NOT NULL DEFAULT '[]'::jsonb,
      faq jsonb NOT NULL DEFAULT '[]'::jsonb,
      reason text NOT NULL,
      saved_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_seo_pages_history_path ON seo_pages_history(path, saved_at DESC);
  `);
      const { SEO_SEED } = await import('./seoSeed.js');
      const canon = (v: unknown) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
      for (const r of SEO_SEED) {
        const cur = await client.query('SELECT h1,title,description,keyword,sections,faq,updated_by FROM seo_pages WHERE path=$1', [r.path]);
        const sections = JSON.stringify(r.sections ?? []); const faq = JSON.stringify(r.faq);
        if (!cur.rowCount) {
          await client.query(`INSERT INTO seo_pages(path,h1,title,description,keyword,sections,faq) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) ON CONFLICT (path) DO NOTHING`, [r.path, r.h1, r.title ?? null, r.description ?? null, r.keyword, sections, faq]);
          continue;
        }
        const row = cur.rows[0]!;
        if (row.updated_by) continue; // editado no painel: nunca é sobrescrito
        const same = (row.title ?? null) === (r.title ?? null) && (row.description ?? null) === (r.description ?? null)
          && canon(row.sections ?? []) === canon(r.sections ?? []) && canon(row.faq ?? []) === canon(r.faq);
        if (same) continue;
        await client.query(`INSERT INTO seo_pages_history(path,h1,title,description,keyword,sections,faq,reason) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)`,
          [r.path, row.h1, row.title, row.description, row.keyword, JSON.stringify(row.sections ?? []), JSON.stringify(row.faq ?? []), reason]);
        await client.query(`UPDATE seo_pages SET title=COALESCE($2,title), description=COALESCE($3,description), sections=$4::jsonb, faq=$5::jsonb WHERE path=$1 AND updated_by IS NULL`,
          [r.path, r.title ?? null, r.description ?? null, sections, faq]);
      }
}

export const placaMigrations: Migration[] = [
  {
    id: '010_payment_settings',
    name: 'Configurações de pagamento, recebimento, impostos e margem (linha única)',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS payment_settings (
          id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
          tax_regime text NOT NULL DEFAULT 'SIMPLES_NACIONAL' CHECK (tax_regime IN ('SIMPLES_NACIONAL','LUCRO_PRESUMIDO','LUCRO_REAL','MANUAL')),
          tax_cash_bps integer NOT NULL DEFAULT 600 CHECK (tax_cash_bps BETWEEN 0 AND 5000),
          tax_boleto_bps integer NOT NULL DEFAULT 600 CHECK (tax_boleto_bps BETWEEN 0 AND 5000),
          tax_debit_bps integer NOT NULL DEFAULT 600 CHECK (tax_debit_bps BETWEEN 0 AND 5000),
          tax_credit_cash_bps integer NOT NULL DEFAULT 600 CHECK (tax_credit_cash_bps BETWEEN 0 AND 5000),
          tax_credit_installment_bps integer NOT NULL DEFAULT 600 CHECK (tax_credit_installment_bps BETWEEN 0 AND 5000),
          pix_fee_bps integer NOT NULL DEFAULT 99 CHECK (pix_fee_bps BETWEEN 0 AND 2000),
          pix_fixed_fee_cents integer NOT NULL DEFAULT 0 CHECK (pix_fixed_fee_cents BETWEEN 0 AND 10000),
          boleto_fixed_fee_cents integer NOT NULL DEFAULT 350 CHECK (boleto_fixed_fee_cents BETWEEN 0 AND 10000),
          boleto_default_risk_bps integer NOT NULL DEFAULT 300 CHECK (boleto_default_risk_bps BETWEEN 0 AND 3000),
          boleto_months integer NOT NULL DEFAULT 1 CHECK (boleto_months BETWEEN 1 AND 12),
          boleto_monthly_interest_bps integer NOT NULL DEFAULT 0 CHECK (boleto_monthly_interest_bps BETWEEN 0 AND 1000),
          debit_fee_bps integer NOT NULL DEFAULT 150 CHECK (debit_fee_bps BETWEEN 0 AND 2000),
          credit_cash_fee_bps integer NOT NULL DEFAULT 449 CHECK (credit_cash_fee_bps BETWEEN 0 AND 2000),
          credit_installment_fee_bps integer NOT NULL DEFAULT 549 CHECK (credit_installment_fee_bps BETWEEN 0 AND 2000),
          anticipation_bps integer NOT NULL DEFAULT 150 CHECK (anticipation_bps BETWEEN 0 AND 2000),
          installments_max integer NOT NULL DEFAULT 3 CHECK (installments_max BETWEEN 1 AND 12),
          card_monthly_interest_bps integer NOT NULL DEFAULT 0 CHECK (card_monthly_interest_bps BETWEEN 0 AND 1000),
          customer_pays_interest boolean NOT NULL DEFAULT true,
          enabled_methods text[] NOT NULL DEFAULT ARRAY['PIX','CREDITO_A_VISTA']::text[],
          operational_cost_cents integer NOT NULL DEFAULT 0 CHECK (operational_cost_cents >= 0),
          desired_margin_bps integer NOT NULL DEFAULT 3000 CHECK (desired_margin_bps BETWEEN 0 AND 100000),
          min_margin_bps integer NOT NULL DEFAULT 1000 CHECK (min_margin_bps BETWEEN 0 AND 100000),
          margin_base text NOT NULL DEFAULT 'TOTAL_COST' CHECK (margin_base IN ('COST_PRICE','TOTAL_COST')),
          reference_discount_bps integer NOT NULL DEFAULT 500 CHECK (reference_discount_bps BETWEEN 0 AND 5000),
          price_ending_cents integer NOT NULL DEFAULT 90 CHECK (price_ending_cents BETWEEN 0 AND 99),
          commission_base text NOT NULL DEFAULT 'NET' CHECK (commission_base IN ('GROSS','NET','MARGIN')),
          commission_default_bps integer NOT NULL DEFAULT 1000 CHECK (commission_default_bps BETWEEN 0 AND 5000),
          commission_hold_days integer NOT NULL DEFAULT 7 CHECK (commission_hold_days BETWEEN 0 AND 90),
          payout_min_cents integer NOT NULL DEFAULT 5000 CHECK (payout_min_cents >= 0),
          receiver_name text,
          receiver_document text,
          receiver_pix_key text,
          receiver_bank_notes text,
          receipt_footer text,
          fiscal_acknowledged_at timestamptz,
          fiscal_acknowledged_by uuid REFERENCES users(id),
          updated_by uuid REFERENCES users(id),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        INSERT INTO payment_settings(id) VALUES (1) ON CONFLICT (id) DO NOTHING;
      `);
    }
  },
  {
    id: '011_partners_commissions_payouts',
    name: 'Parceiros unificados, comissões com base configurável, estorno e repasses',
    up: async (client) => {
      await client.query(`
        ALTER TABLE affiliates
          ADD COLUMN IF NOT EXISTS partner_type text NOT NULL DEFAULT 'AFFILIATE',
          ADD COLUMN IF NOT EXISTS commission_base text,
          ADD COLUMN IF NOT EXISTS pix_key text,
          ADD COLUMN IF NOT EXISTS document text,
          ADD COLUMN IF NOT EXISTS payout_notes text;
        ALTER TABLE affiliates DROP CONSTRAINT IF EXISTS affiliates_partner_type_check;
        ALTER TABLE affiliates ADD CONSTRAINT affiliates_partner_type_check CHECK (partner_type IN ('AFFILIATE','INFLUENCER','SELLER','ORGANIZATION'));
        ALTER TABLE affiliates DROP CONSTRAINT IF EXISTS affiliates_commission_base_check;
        ALTER TABLE affiliates ADD CONSTRAINT affiliates_commission_base_check CHECK (commission_base IS NULL OR commission_base IN ('GROSS','NET','MARGIN'));

        CREATE TABLE IF NOT EXISTS payouts (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          affiliate_id uuid NOT NULL REFERENCES affiliates(id),
          amount_cents integer NOT NULL CHECK (amount_cents > 0),
          status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','APPROVED','PAID','REJECTED','CANCELLED')),
          pix_key_snapshot text,
          receipt_reference text,
          notes text,
          requested_by uuid REFERENCES users(id),
          approved_by uuid REFERENCES users(id),
          paid_by uuid REFERENCES users(id),
          requested_at timestamptz NOT NULL DEFAULT now(),
          approved_at timestamptz,
          paid_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_payouts_affiliate_status ON payouts(affiliate_id, status, created_at DESC);

        ALTER TABLE affiliate_commissions DROP CONSTRAINT IF EXISTS affiliate_commissions_status_check;
        ALTER TABLE affiliate_commissions ADD CONSTRAINT affiliate_commissions_status_check CHECK (status IN ('PENDING','AVAILABLE','PAID','CANCELLED','REVERSED'));
        ALTER TABLE affiliate_commissions
          ADD COLUMN IF NOT EXISTS base_type text NOT NULL DEFAULT 'GROSS',
          ADD COLUMN IF NOT EXISTS base_cents integer NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS rate_bps integer NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS available_at timestamptz,
          ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
          ADD COLUMN IF NOT EXISTS reversal_reason text,
          ADD COLUMN IF NOT EXISTS payout_id uuid REFERENCES payouts(id);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_affiliate_commissions_order ON affiliate_commissions(order_id) WHERE order_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_status ON affiliate_commissions(status, available_at);
        CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_payout ON affiliate_commissions(payout_id) WHERE payout_id IS NOT NULL;
      `);
    }
  },
  {
    id: '012_reference_prices_and_price_history',
    name: 'Preços de referência (uso interno), modo de preço e histórico/versão de preços',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS price_references (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          product_id text NOT NULL REFERENCES query_products(id) ON DELETE CASCADE,
          source_label text NOT NULL,
          price_cents integer NOT NULL CHECK (price_cents > 0),
          observed_at date NOT NULL DEFAULT current_date,
          note text,
          created_by uuid REFERENCES users(id),
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_price_references_product ON price_references(product_id, observed_at DESC);
        ALTER TABLE query_products
          ADD COLUMN IF NOT EXISTS pricing_mode text NOT NULL DEFAULT 'MANUAL',
          ADD COLUMN IF NOT EXISTS floor_price_cents integer,
          ADD COLUMN IF NOT EXISTS margin_locked boolean NOT NULL DEFAULT false,
          ADD COLUMN IF NOT EXISTS price_updated_at timestamptz,
          ADD COLUMN IF NOT EXISTS price_version integer NOT NULL DEFAULT 1;
        ALTER TABLE query_products DROP CONSTRAINT IF EXISTS query_products_pricing_mode_check;
        ALTER TABLE query_products ADD CONSTRAINT query_products_pricing_mode_check CHECK (pricing_mode IN ('MANUAL','REFERENCE'));
        CREATE TABLE IF NOT EXISTS product_price_history (
          id bigserial PRIMARY KEY,
          product_id text NOT NULL REFERENCES query_products(id) ON DELETE CASCADE,
          version integer NOT NULL,
          old_price_cents integer,
          new_price_cents integer NOT NULL,
          reference_price_cents integer,
          floor_price_cents integer,
          provider_cost_cents integer,
          margin_locked boolean NOT NULL DEFAULT false,
          reason text NOT NULL,
          changed_by uuid REFERENCES users(id),
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_product_price_history_product ON product_price_history(product_id, created_at DESC);
      `);
    }
  },
  {
    id: '013_public_api_pii_and_session_audience',
    name: 'API pública com chaves, JSON bruto criptografado, revelação auditada de PII e audiência de sessão',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS api_keys (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name text NOT NULL,
          key_prefix text NOT NULL UNIQUE,
          key_hash text NOT NULL UNIQUE,
          active boolean NOT NULL DEFAULT true,
          last_used_at timestamptz,
          revoked_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id, created_at DESC);
        ALTER TABLE vehicle_query_results
          ADD COLUMN IF NOT EXISTS raw_enc text,
          ADD COLUMN IF NOT EXISTS normalizer_version integer NOT NULL DEFAULT 2;
        ALTER TABLE vehicle_queries ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'WEB';
        ALTER TABLE vehicle_queries DROP CONSTRAINT IF EXISTS vehicle_queries_source_check;
        ALTER TABLE vehicle_queries ADD CONSTRAINT vehicle_queries_source_check CHECK (source IN ('WEB','API','ADMIN'));
        CREATE TABLE IF NOT EXISTS pii_reveals (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES users(id),
          query_id uuid REFERENCES vehicle_queries(id) ON DELETE SET NULL,
          field text NOT NULL,
          reason text NOT NULL,
          ip_hash text,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_pii_reveals_user ON pii_reveals(user_id, created_at DESC);
        ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'client';
        ALTER TABLE user_sessions DROP CONSTRAINT IF EXISTS user_sessions_audience_check;
        ALTER TABLE user_sessions ADD CONSTRAINT user_sessions_audience_check CHECK (audience IN ('client','admin'));
      `);
    }
  },
  {
    id: '014_refunds_chargebacks_and_net_amounts',
    name: 'Estornos e chargebacks: status adicionais, valores líquidos e clawback de comissões',
    up: async (client) => {
      await client.query(`
        ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
        ALTER TABLE payments ADD CONSTRAINT payments_status_check CHECK (status IN ('PENDING','PAID','CANCELLED','FAILED','REFUNDED'));
        ALTER TABLE query_payment_entitlements DROP CONSTRAINT IF EXISTS query_payment_entitlements_status_check;
        ALTER TABLE query_payment_entitlements ADD CONSTRAINT query_payment_entitlements_status_check CHECK (status IN ('READY','CONSUMED','FAILED','REVOKED'));
        ALTER TABLE affiliate_commissions DROP CONSTRAINT IF EXISTS affiliate_commissions_status_check;
        ALTER TABLE affiliate_commissions ADD CONSTRAINT affiliate_commissions_status_check CHECK (status IN ('PENDING','AVAILABLE','PAID','CANCELLED','REVERSED','CLAWBACK_DUE'));
        ALTER TABLE payment_orders
          ADD COLUMN IF NOT EXISTS payment_method text,
          ADD COLUMN IF NOT EXISTS gateway_fee_cents integer,
          ADD COLUMN IF NOT EXISTS net_cents integer,
          ADD COLUMN IF NOT EXISTS refunded_at timestamptz,
          ADD COLUMN IF NOT EXISTS reversal_kind text;
        ALTER TABLE payment_orders DROP CONSTRAINT IF EXISTS payment_orders_reversal_kind_check;
        ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_reversal_kind_check CHECK (reversal_kind IS NULL OR reversal_kind IN ('REFUND','CHARGEBACK'));
      `);
    }
  },
  {
    id: '015_placanamao_catalog',
    name: 'Catálogo Placa na Mão: planos Básica/Completa/Premium, pacotes de saldo e fontes',
    up: async (client) => {
      // Preços PROVISÓRIOS: o dono define custo do provedor e preços de referência no painel financeiro.
      // A trava de margem só passa a valer depois que o custo do provedor é informado.
      await client.query(`
        UPDATE query_products SET name='Consulta Básica', description='Identificação e características do veículo pela placa.',
          features='["Marca, modelo e ano","Cor, combustível e categoria","Município e UF de emplacamento","Situação do veículo","Chassi e RENAVAM com proteção parcial"]'::jsonb,
          coverage='Identificação, características e situação cadastral', display_order=10, featured=false, active=true, commercial_status='ACTIVE', price_cents=990, credit_cost=10, pricing_mode='REFERENCE'
          WHERE id='BASIC';
        UPDATE query_products SET name='Consulta Completa', description='Débitos, restrições, recall e situação, além de toda a identificação.',
          features='["Tudo da Consulta Básica","Débitos: IPVA, licenciamento, multas e DPVAT","Restrições: furto/roubo, judicial, administrativa, tributária e RENAJUD","Recall e situação do veículo","Relatório em PDF com QR de verificação"]'::jsonb,
          coverage='Identificação, débitos, restrições, recall e situação', display_order=20, featured=true, active=true, commercial_status='ACTIVE', price_cents=2490, credit_cost=25, pricing_mode='REFERENCE'
          WHERE id='COMPLETE';
        UPDATE query_products SET name='Consulta Premium', description='Todos os campos que o provedor retornar, incluindo gravame e inspeção.',
          features='["Tudo da Consulta Completa","Gravame e intenção de gravame","Inspeção veicular e comunicação de venda","Registro, CRV e dados adicionais","Todos os campos que o provedor retornar"]'::jsonb,
          coverage='Cobertura máxima conforme retorno do provedor', display_order=30, featured=false, active=true, commercial_status='ACTIVE', price_cents=3990, credit_cost=40, pricing_mode='REFERENCE'
          WHERE id='PREMIUM';
        UPDATE query_products SET active=false, commercial_status='SOON', featured=false WHERE id IN ('DEBTS','CADASTRAL','RESTRICTIONS');
        UPDATE query_products SET display_order=1, featured=false WHERE id='FIPE_FREE';

        DELETE FROM query_source_rules WHERE product_id IN ('BASIC','COMPLETE','PREMIUM','DEBTS','CADASTRAL','RESTRICTIONS');
        INSERT INTO query_source_rules(product_id,source_type,provider,active,priority,coverage) VALUES
          ('BASIC','IDENTITY','contracted',true,10,'Identificação e características (provedor contratado)'),
          ('COMPLETE','IDENTITY','contracted',true,10,'Identificação, débitos, restrições e recall (provedor contratado)'),
          ('PREMIUM','IDENTITY','contracted',true,10,'Cobertura máxima conforme retorno do provedor contratado'),
          ('DEBTS','DEBTS','contracted',false,10,'Descontinuado: incluso na Consulta Completa'),
          ('CADASTRAL','IDENTITY','contracted',false,10,'Descontinuado: incluso na Consulta Básica'),
          ('RESTRICTIONS','RESTRICTIONS','contracted',false,10,'Descontinuado: incluso na Consulta Completa');

        UPDATE credit_packages SET name='Pacote Inicial', description='Saldo pré-pago para consultas pontuais.', credits=25, price_cents=2490, display_order=10, active=true WHERE slug='essencial';
        UPDATE credit_packages SET name='Pacote Plus', description='Mais saldo, com bônus, para quem consulta com frequência.', credits=105, price_cents=9990, display_order=20, active=true WHERE slug='completo';
        UPDATE credit_packages SET name='Pacote Pro', description='Para lojistas, despachantes e operações recorrentes. Melhor custo por consulta.', credits=320, price_cents=29990, display_order=30, active=true WHERE slug='profissional';
      `);
    }
  },
  {
    id: '016_catalog_cms',
    name: 'Catálogo editável: produtos com conteúdo, matriz de comparação, pacotes, FAQ e artigos',
    up: async (client) => {
      await client.query(`
        ALTER TABLE query_products
          ADD COLUMN IF NOT EXISTS list_price_cents integer,
          ADD COLUMN IF NOT EXISTS badge text,
          ADD COLUMN IF NOT EXISTS tagline text,
          ADD COLUMN IF NOT EXISTS long_description text,
          ADD COLUMN IF NOT EXISTS report_sections text[],
          ADD COLUMN IF NOT EXISTS show_on_home boolean NOT NULL DEFAULT true;
        ALTER TABLE query_products DROP CONSTRAINT IF EXISTS query_products_list_price_check;
        ALTER TABLE query_products ADD CONSTRAINT query_products_list_price_check CHECK (list_price_cents IS NULL OR list_price_cents >= 0);
        ALTER TABLE credit_packages
          ADD COLUMN IF NOT EXISTS badge text,
          ADD COLUMN IF NOT EXISTS tagline text,
          ADD COLUMN IF NOT EXISTS highlights jsonb NOT NULL DEFAULT '[]'::jsonb;

        CREATE TABLE IF NOT EXISTS catalog_features (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          key text NOT NULL UNIQUE,
          label text NOT NULL,
          description text NOT NULL DEFAULT '',
          display_order integer NOT NULL DEFAULT 100,
          active boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS product_catalog_features (
          product_id text NOT NULL REFERENCES query_products(id) ON DELETE CASCADE,
          feature_id uuid NOT NULL REFERENCES catalog_features(id) ON DELETE CASCADE,
          status text NOT NULL DEFAULT 'INCLUDED' CHECK (status IN ('INCLUDED','NOT_INCLUDED','SOON')),
          note text,
          PRIMARY KEY (product_id, feature_id)
        );
        CREATE TABLE IF NOT EXISTS faqs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          category text NOT NULL DEFAULT 'Geral',
          question text NOT NULL,
          answer text NOT NULL,
          display_order integer NOT NULL DEFAULT 100,
          active boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_faqs_active_order ON faqs(active, display_order);
        CREATE TABLE IF NOT EXISTS articles (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
          title text NOT NULL,
          excerpt text NOT NULL DEFAULT '',
          body text NOT NULL DEFAULT '',
          category text NOT NULL DEFAULT 'Geral',
          tags text[] NOT NULL DEFAULT ARRAY[]::text[],
          cover_image_url text,
          author text NOT NULL DEFAULT 'Equipe Placa na Mão',
          seo_title text,
          seo_description text,
          status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED')),
          published_at timestamptz,
          created_by uuid REFERENCES users(id),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(status, published_at DESC);
      `);

      // Catálogo final. O preço público é cerca de 5% abaixo da referência interna (manual, nunca exibida ao público).
      type P = { id: string; name: string; tagline: string; description: string; long: string; price: number; ref: number; order: number; featured: boolean; badge: string | null; features: string[]; sections: string[] | null; coverage: string; rule: string | null };
      const ident = ['IDENTIFICACAO', 'CARACTERISTICAS', 'REGISTRO'];
      const products: P[] = [
        { id: 'COMPLETE', name: 'Consulta Completa', tagline: 'A checagem inteira, em um só relatório.', description: 'Identificação, débitos, multas, restrições, gravame, recall e inspeção em um único relatório.', long: 'A checagem mais completa antes de comprar, vender ou financiar. Reúne tudo da Básica e acrescenta financiamento (gravame), recall e inspeção, e costuma sair mais barata do que somar consultas avulsas.', price: 5490, ref: 5790, order: 10, featured: true, badge: 'Mais completa', features: ['Tudo da Consulta Básica', 'Financiamento e gravame', 'Recall e inspeção veicular', 'Relatório em PDF com código de validação'], sections: [...ident, 'DEBITOS', 'RESTRICOES', 'GRAVAME', 'INSPECAO_RECALL'], coverage: 'Identificação, débitos, restrições, gravame, recall e inspeção', rule: 'Identificação, débitos, restrições, gravame, recall e inspeção (fonte contratada)' },
        { id: 'BASIC', name: 'Consulta Básica', tagline: 'Cadastro, débitos, multas e restrições.', description: 'Dados do veículo, débitos, multas e restrições para uma compra com mais segurança.', long: 'O essencial para fechar uma compra com tranquilidade: confere se o veículo é o do anúncio e se há débitos, multas ou restrições registradas.', price: 2990, ref: 3150, order: 20, featured: false, badge: 'Custo-benefício', features: ['Dados do veículo e situação', 'Débitos e multas', 'Restrições (furto/roubo, judicial e outras)', 'Relatório em PDF'], sections: [...ident, 'DEBITOS', 'RESTRICOES'], coverage: 'Identificação, débitos e restrições', rule: 'Identificação, débitos e restrições (fonte contratada)' },
        { id: 'AUCTION', name: 'Consulta Leilão', tagline: 'Passagem do veículo por leilão.', description: 'Histórico de passagem por leilão. Disponível assim que a fonte de dados for ativada.', long: 'Saiba se o veículo já passou por leilão, informação importante para avaliação, seguro e revenda. Ainda não está disponível: não vendemos o que não podemos entregar.', price: 2790, ref: 2950, order: 30, featured: false, badge: null, features: ['Histórico de passagem por leilão', 'Relatório em PDF'], sections: null, coverage: 'Histórico de leilão (em breve)', rule: null },
        { id: 'LIEN', name: 'Consulta Gravame', tagline: 'Financiamento e restrição financeira.', description: 'Veja se o veículo tem gravame ou restrição financeira antes da transferência.', long: 'Verifica sinais de financiamento ativo: gravame e intenção de gravame informados pela fonte. Ideal para quem já conferiu o resto e quer fechar essa dúvida.', price: 1190, ref: 1250, order: 40, featured: false, badge: null, features: ['Gravame e restrição financeira', 'Intenção de gravame', 'Relatório em PDF'], sections: ['IDENTIFICACAO', 'GRAVAME'], coverage: 'Gravame e restrição financeira', rule: 'Gravame e restrição financeira (fonte contratada)' },
        { id: 'CADASTRAL', name: 'Consulta Cadastral', tagline: 'Confirme se o veículo é o do anúncio.', description: 'Marca, modelo, ano, cor, combustível, município e situação do veículo pela placa.', long: 'A forma mais rápida e barata de conferir se o veículo corresponde ao anúncio e ao documento: identificação, características e situação cadastral.', price: 990, ref: 1050, order: 50, featured: false, badge: null, features: ['Marca, modelo, ano e cor', 'Combustível e categoria', 'Município, UF e situação', 'Relatório em PDF'], sections: ident, coverage: 'Identificação, características e situação cadastral', rule: 'Identificação e características (fonte contratada)' }
      ];
      for (const p of products) {
        await client.query(
          `INSERT INTO query_products(id,name,description,credit_cost,active,slug,features,display_order,source,coverage,commercial_status,featured,is_free,price_cents,reference_price_cents,pricing_mode,tagline,long_description,badge,report_sections,show_on_home,list_price_cents)
           VALUES($1,$2,$3,$4,true,$5,$6::jsonb,$7,'Fonte de dados contratada',$8,$9,$10,false,$11,$12,'MANUAL',$13,$14,$15,$16::text[],true,NULL)
           ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, credit_cost=EXCLUDED.credit_cost, active=true, slug=EXCLUDED.slug, features=EXCLUDED.features,
             display_order=EXCLUDED.display_order, coverage=EXCLUDED.coverage, commercial_status=EXCLUDED.commercial_status, featured=EXCLUDED.featured, is_free=false,
             price_cents=EXCLUDED.price_cents, reference_price_cents=EXCLUDED.reference_price_cents, pricing_mode='MANUAL', tagline=EXCLUDED.tagline, long_description=EXCLUDED.long_description,
             badge=EXCLUDED.badge, report_sections=EXCLUDED.report_sections, show_on_home=true, updated_at=now()`,
          [p.id, p.name, p.description, Math.ceil(p.price / 100), p.id.toLowerCase(), JSON.stringify(p.features), p.order, p.coverage, p.rule ? 'ACTIVE' : 'SOON', p.featured, p.price, p.ref, p.tagline, p.long, p.badge, p.sections]
        );
        await client.query('DELETE FROM query_source_rules WHERE product_id=$1', [p.id]);
        if (p.rule) await client.query(`INSERT INTO query_source_rules(product_id,source_type,provider,active,priority,coverage) VALUES($1,'IDENTITY','contracted',true,10,$2)`, [p.id, p.rule]);
        await client.query(
          `INSERT INTO report_templates(product_id,version,name,status,config)
           SELECT $1::text,1,$2::text,'PUBLISHED',COALESCE((SELECT config FROM report_templates WHERE product_id='BASIC' AND version=1), '{"title":"Relatório","subtitle":"Relatório veicular Placa na Mão","sections":[]}'::jsonb)
           WHERE NOT EXISTS (SELECT 1 FROM report_templates WHERE product_id=$1 AND version=1)`, [p.id, `${p.name} — relatório padrão`]);
        await client.query(
          `INSERT INTO product_report_configs(product_id,template_id,mode,formats)
           SELECT $1::text,t.id,'SNAPSHOT',ARRAY['JSON','HTML','PDF'] FROM report_templates t WHERE t.product_id=$1 AND t.version=1 AND t.status='PUBLISHED'
           ON CONFLICT (product_id) DO NOTHING`, [p.id]);
      }
      // Planos antigos fora da vitrine (continuam no histórico dos clientes que já usaram).
      await client.query(`UPDATE query_products SET active=false, featured=false, show_on_home=false WHERE id IN ('PREMIUM','DEBTS','RESTRICTIONS')`);
      await client.query(`UPDATE query_products SET show_on_home=false, features='["Valor médio FIPE do mês","Sem cadastro, sem custo"]'::jsonb, tagline='Valor médio de mercado, grátis.', long_description='Consulte o valor médio da Tabela FIPE por marca, modelo e ano. Gratuito, sem cadastro.' WHERE id='FIPE_FREE'`);

      await client.query(`UPDATE credit_packages SET name='Pacote Inicial', description='Saldo pré-pago para consultas pontuais.', tagline='Para começar', credits=60, price_cents=6000, display_order=10, active=true WHERE slug='essencial'`);
      await client.query(`UPDATE credit_packages SET name='Pacote Plus', description='Mais saldo, com bônus, para quem consulta com frequência.', tagline='Para quem compra e vende com frequência', credits=130, price_cents=12000, display_order=20, active=true WHERE slug='completo'`);
      await client.query(`UPDATE credit_packages SET name='Pacote Pro', description='Para lojistas, despachantes e operações recorrentes. Melhor custo por consulta.', tagline='Para lojistas e despachantes', credits=350, price_cents=30000, display_order=30, active=true WHERE slug='profissional'`);

      const features = await client.query('SELECT 1 FROM catalog_features LIMIT 1');
      if (!features.rowCount) {
        for (const f of SEED_FEATURES) await client.query('INSERT INTO catalog_features(key,label,description,display_order) VALUES($1,$2,$3,$4) ON CONFLICT (key) DO NOTHING', [f.key, f.label, f.description, f.order]);
        for (const [productId, map] of Object.entries(SEED_MATRIX)) {
          for (const [key, status] of Object.entries(map)) {
            await client.query(`INSERT INTO product_catalog_features(product_id,feature_id,status) SELECT $1,id,$3 FROM catalog_features WHERE key=$2 ON CONFLICT DO NOTHING`, [productId, key, status]);
          }
        }
      }
      const faqs = await client.query('SELECT 1 FROM faqs LIMIT 1');
      if (!faqs.rowCount) {
        let order = 10;
        for (const f of SEED_FAQS) { await client.query('INSERT INTO faqs(category,question,answer,display_order) VALUES($1,$2,$3,$4)', [f.category, f.question, f.answer, order]); order += 10; }
      }
      const articles = await client.query('SELECT 1 FROM articles LIMIT 1');
      if (!articles.rowCount) {
        let day = 0;
        for (const a of SEED_ARTICLES) {
          await client.query(`INSERT INTO articles(slug,title,excerpt,body,category,tags,status,published_at,seo_description) VALUES($1,$2,$3,$4,$5,$6::text[],'PUBLISHED',now() - ($7 || ' days')::interval,$3) ON CONFLICT (slug) DO NOTHING`, [a.slug, a.title, a.excerpt, a.body, a.category, a.tags, String(day)]);
          day += 3;
        }
      }
    }
  },
  {
    id: '017_admin_people_billing_fiscal',
    name: 'Painel profissional: papéis da equipe, tipos de cliente, empresas, cobranças com parcelas e notas fiscais',
    up: async (client) => {
      await client.query(`
        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
        ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('SUPER_ADMIN','ADMIN','FINANCEIRO','OPERADOR','SUPORTE','CONTEUDO','CLIENTE'));

        ALTER TABLE user_profiles
          ADD COLUMN IF NOT EXISTS customer_type text NOT NULL DEFAULT 'PARTICULAR',
          ADD COLUMN IF NOT EXISTS segment text,
          ADD COLUMN IF NOT EXISTS legal_name text,
          ADD COLUMN IF NOT EXISTS state_registration text,
          ADD COLUMN IF NOT EXISTS municipal_registration text,
          ADD COLUMN IF NOT EXISTS billing_email text,
          ADD COLUMN IF NOT EXISTS zip text,
          ADD COLUMN IF NOT EXISTS street text,
          ADD COLUMN IF NOT EXISTS street_number text,
          ADD COLUMN IF NOT EXISTS complement text,
          ADD COLUMN IF NOT EXISTS district text,
          ADD COLUMN IF NOT EXISTS notes text,
          ADD COLUMN IF NOT EXISTS archived_at timestamptz,
          ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;
        ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_customer_type_check;
        ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_customer_type_check CHECK (customer_type IN ('PARTICULAR','AUTONOMO','EMPRESA'));
        CREATE INDEX IF NOT EXISTS idx_user_profiles_type ON user_profiles(customer_type);

        ALTER TABLE organizations
          ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'EMPRESA',
          ADD COLUMN IF NOT EXISTS segment text,
          ADD COLUMN IF NOT EXISTS legal_name text,
          ADD COLUMN IF NOT EXISTS contact_name text,
          ADD COLUMN IF NOT EXISTS email text,
          ADD COLUMN IF NOT EXISTS phone text,
          ADD COLUMN IF NOT EXISTS state_registration text,
          ADD COLUMN IF NOT EXISTS municipal_registration text,
          ADD COLUMN IF NOT EXISTS zip text,
          ADD COLUMN IF NOT EXISTS street text,
          ADD COLUMN IF NOT EXISTS street_number text,
          ADD COLUMN IF NOT EXISTS complement text,
          ADD COLUMN IF NOT EXISTS district text,
          ADD COLUMN IF NOT EXISTS city text,
          ADD COLUMN IF NOT EXISTS state char(2),
          ADD COLUMN IF NOT EXISTS notes text,
          ADD COLUMN IF NOT EXISTS archived_at timestamptz;

        ALTER TABLE faqs ADD COLUMN IF NOT EXISTS archived_at timestamptz;
        ALTER TABLE articles ADD COLUMN IF NOT EXISTS archived_at timestamptz;
        ALTER TABLE query_products ADD COLUMN IF NOT EXISTS archived_at timestamptz;

        CREATE TABLE IF NOT EXISTS fiscal_settings (
          id integer PRIMARY KEY CHECK (id = 1),
          legal_name text, trade_name text, cnpj text, state_registration text, municipal_registration text,
          tax_regime text NOT NULL DEFAULT 'SIMPLES' CHECK (tax_regime IN ('MEI','SIMPLES','PRESUMIDO','REAL')),
          cnae text, service_code text, service_description text,
          iss_rate_bps integer CHECK (iss_rate_bps IS NULL OR (iss_rate_bps BETWEEN 0 AND 1000)),
          city text, state char(2), city_ibge_code text,
          zip text, street text, street_number text, district text, email text, phone text,
          emission_mode text NOT NULL DEFAULT 'MANUAL' CHECK (emission_mode IN ('MANUAL')),
          environment text NOT NULL DEFAULT 'HOMOLOGACAO' CHECK (environment IN ('HOMOLOGACAO','PRODUCAO')),
          series text NOT NULL DEFAULT '1',
          accountant_email text,
          notes text,
          updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        INSERT INTO fiscal_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING;

        CREATE TABLE IF NOT EXISTS charges (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid REFERENCES users(id) ON DELETE SET NULL,
          organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
          description text NOT NULL,
          total_cents integer NOT NULL CHECK (total_cents > 0),
          status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PAID','CANCELLED')),
          notes text,
          created_by uuid REFERENCES users(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          cancelled_at timestamptz,
          CHECK (user_id IS NOT NULL OR organization_id IS NOT NULL)
        );
        CREATE INDEX IF NOT EXISTS idx_charges_user ON charges(user_id);
        CREATE INDEX IF NOT EXISTS idx_charges_org ON charges(organization_id);
        CREATE INDEX IF NOT EXISTS idx_charges_status ON charges(status);

        CREATE TABLE IF NOT EXISTS charge_installments (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          charge_id uuid NOT NULL REFERENCES charges(id) ON DELETE CASCADE,
          number integer NOT NULL CHECK (number > 0),
          amount_cents integer NOT NULL CHECK (amount_cents > 0),
          due_date date NOT NULL,
          status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','CANCELLED')),
          paid_at timestamptz,
          paid_amount_cents integer,
          method text CHECK (method IS NULL OR method IN ('PIX','BOLETO','CARTAO','TRANSFERENCIA','DINHEIRO','OUTRO')),
          reference text,
          UNIQUE (charge_id, number)
        );
        CREATE INDEX IF NOT EXISTS idx_installments_due ON charge_installments(status, due_date);

        CREATE TABLE IF NOT EXISTS fiscal_documents (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          kind text NOT NULL DEFAULT 'NFSE' CHECK (kind IN ('NFSE','NFE')),
          status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ISSUED','CANCELLED')),
          user_id uuid REFERENCES users(id) ON DELETE SET NULL,
          organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
          payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
          charge_id uuid REFERENCES charges(id) ON DELETE SET NULL,
          installment_id uuid REFERENCES charge_installments(id) ON DELETE SET NULL,
          amount_cents integer NOT NULL CHECK (amount_cents > 0),
          description text NOT NULL,
          customer_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
          number text, series text, access_key text, verification_code text,
          issued_at timestamptz, pdf_url text, xml_url text,
          cancel_reason text, cancelled_at timestamptz,
          notes text,
          created_by uuid REFERENCES users(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_fiscal_documents_status ON fiscal_documents(status, created_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_fiscal_documents_payment ON fiscal_documents(payment_id) WHERE payment_id IS NOT NULL AND status <> 'CANCELLED';
        CREATE UNIQUE INDEX IF NOT EXISTS idx_fiscal_documents_installment ON fiscal_documents(installment_id) WHERE installment_id IS NOT NULL AND status <> 'CANCELLED';
      `);
      // Quem já tem empresa preenchida no perfil vira "Empresa"; o resto segue como particular.
      await client.query(`UPDATE user_profiles SET customer_type='EMPRESA' WHERE customer_type='PARTICULAR' AND company_name IS NOT NULL AND btrim(company_name) <> '' AND length(regexp_replace(coalesce(cpf_cnpj,''),'\\D','','g')) = 14`);
    }
  },
  {
    id: '018_vehicle_guide',
    name: 'Guia de veículos: modelos, versões com ficha técnica, opiniões de donos e dicas',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS vehicle_models (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          slug text NOT NULL UNIQUE,
          brand text NOT NULL,
          name text NOT NULL,
          vehicle_type text NOT NULL DEFAULT 'CAR' CHECK (vehicle_type IN ('CAR','MOTORCYCLE','TRUCK')),
          body_type text,
          year_from integer CHECK (year_from IS NULL OR year_from BETWEEN 1950 AND 2100),
          year_to integer CHECK (year_to IS NULL OR year_to BETWEEN 1950 AND 2100),
          summary text NOT NULL DEFAULT '',
          review text NOT NULL DEFAULT '',
          pros jsonb NOT NULL DEFAULT '[]'::jsonb,
          cons jsonb NOT NULL DEFAULT '[]'::jsonb,
          buyer_tips text NOT NULL DEFAULT '',
          image_url text,
          status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED')),
          archived_at timestamptz,
          created_by uuid REFERENCES users(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_vehicle_models_list ON vehicle_models(status, archived_at, brand, name);

        CREATE TABLE IF NOT EXISTS vehicle_versions (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          model_id uuid NOT NULL REFERENCES vehicle_models(id) ON DELETE CASCADE,
          name text NOT NULL,
          year_model integer CHECK (year_model IS NULL OR year_model BETWEEN 1950 AND 2100),
          fuel text,
          fipe_code text,
          specs jsonb NOT NULL DEFAULT '{}'::jsonb,
          display_order integer NOT NULL DEFAULT 0,
          active boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_versions_unique ON vehicle_versions(model_id, lower(name), coalesce(year_model, 0));
        CREATE INDEX IF NOT EXISTS idx_vehicle_versions_model ON vehicle_versions(model_id, display_order);

        CREATE TABLE IF NOT EXISTS vehicle_opinions (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          model_id uuid NOT NULL REFERENCES vehicle_models(id) ON DELETE CASCADE,
          version_id uuid REFERENCES vehicle_versions(id) ON DELETE SET NULL,
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
          ratings jsonb NOT NULL DEFAULT '{}'::jsonb,
          title text NOT NULL DEFAULT '',
          liked text NOT NULL DEFAULT '',
          disliked text NOT NULL DEFAULT '',
          comment text NOT NULL DEFAULT '',
          owner_since integer CHECK (owner_since IS NULL OR owner_since BETWEEN 1950 AND 2100),
          km integer CHECK (km IS NULL OR km BETWEEN 0 AND 2000000),
          status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
          reject_reason text,
          moderated_by uuid REFERENCES users(id) ON DELETE SET NULL,
          moderated_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (model_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_vehicle_opinions_model ON vehicle_opinions(model_id, status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_vehicle_opinions_status ON vehicle_opinions(status, created_at);

        CREATE TABLE IF NOT EXISTS vehicle_tips (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          category text NOT NULL DEFAULT 'CUIDADOS',
          title text NOT NULL,
          body text NOT NULL DEFAULT '',
          model_id uuid REFERENCES vehicle_models(id) ON DELETE CASCADE,
          status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED')),
          display_order integer NOT NULL DEFAULT 0,
          archived_at timestamptz,
          created_by uuid REFERENCES users(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_vehicle_tips_list ON vehicle_tips(status, archived_at, category, display_order);
      `);
    }
  },
  {
    id: '019_financing_simulator',
    name: 'Simulador de financiamento: taxas de mercado (Banco Central), tarifas de referência e simulações salvas',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS financing_settings (
          id smallint PRIMARY KEY CHECK (id = 1),
          cdc_pf_pct numeric(7,4) NOT NULL DEFAULT 1.97,
          cdc_pj_pct numeric(7,4) NOT NULL DEFAULT 1.45,
          leasing_pf_pct numeric(7,4),
          leasing_pj_pct numeric(7,4) NOT NULL DEFAULT 1.37,
          rates_reference_month text NOT NULL DEFAULT '2026-08',
          rates_source text NOT NULL DEFAULT 'Banco Central do Brasil (SGS 25471, 25447, 25450)',
          auto_refresh boolean NOT NULL DEFAULT true,
          rates_refreshed_at timestamptz,
          rates_refresh_error text,
          fee_cadastro_cents integer NOT NULL DEFAULT 60000 CHECK (fee_cadastro_cents >= 0),
          fee_avaliacao_cents integer NOT NULL DEFAULT 40000 CHECK (fee_avaliacao_cents >= 0),
          fee_registro_cents integer NOT NULL DEFAULT 25000 CHECK (fee_registro_cents >= 0),
          iof_pf_daily_pct numeric(8,5) NOT NULL DEFAULT 0.0082,
          iof_pj_daily_pct numeric(8,5) NOT NULL DEFAULT 0.0041,
          iof_additional_pct numeric(6,3) NOT NULL DEFAULT 0.38,
          iof_cap_days integer NOT NULL DEFAULT 365,
          updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        INSERT INTO financing_settings(id) VALUES (1) ON CONFLICT (id) DO NOTHING;

        CREATE TABLE IF NOT EXISTS financing_simulations (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          code text NOT NULL UNIQUE,
          user_id uuid REFERENCES users(id) ON DELETE SET NULL,
          modality text NOT NULL,
          vehicle_kind text NOT NULL,
          person_type text NOT NULL,
          vehicle_value_cents bigint NOT NULL,
          down_payment_cents bigint NOT NULL,
          months integer NOT NULL,
          monthly_rate_pct numeric(7,4) NOT NULL,
          installment_cents bigint NOT NULL,
          total_paid_cents bigint NOT NULL,
          cet_annual_pct numeric(8,2),
          input jsonb NOT NULL DEFAULT '{}'::jsonb,
          output jsonb,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        ALTER TABLE financing_simulations ADD COLUMN IF NOT EXISTS output jsonb;
        CREATE INDEX IF NOT EXISTS idx_financing_simulations_created ON financing_simulations(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_financing_simulations_user ON financing_simulations(user_id, created_at DESC);
      `);
    }
  },
  {
    id: '020_vehicle_seed',
    name: 'Guia de veículos: fonte da ficha técnica e carga inicial de modelos muito vendidos',
    up: async (client) => {
      await client.query('ALTER TABLE vehicle_models ADD COLUMN IF NOT EXISTS spec_source text');
      // Idempotente e sem sobrescrever: se a equipe já cadastrou ou editou o modelo, nada é alterado.
      for (const model of VEHICLE_SEED) {
        const inserted = await client.query(
          `INSERT INTO vehicle_models(slug,brand,name,vehicle_type,body_type,year_from,summary,status,spec_source)
           VALUES($1,$2,$3,$4,$5,$6,$7,'PUBLISHED',$8) ON CONFLICT (slug) DO NOTHING RETURNING id`,
          [model.slug, model.brand, model.name, model.vehicleType, model.bodyType, model.yearFrom ?? null, `${model.brand} ${model.name}: ficha técnica de referência, sem opiniões ainda. Seja o primeiro a avaliar.`, SEED_SOURCE]
        );
        const modelId = inserted.rows[0]?.id as string | undefined;
        if (!modelId) continue;
        let order = 0;
        for (const v of model.versions) {
          await client.query(
            `INSERT INTO vehicle_versions(model_id,name,year_model,fuel,specs,display_order) VALUES($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT DO NOTHING`,
            [modelId, v.name, v.yearModel, v.fuel, JSON.stringify(v.specs), order++]
          );
        }
      }
    }
  },
  {
    id: '021_financing_banks',
    name: 'Simulador: bancos (taxas e tarifas por instituição) e taxas médias por instituição do Banco Central',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS financing_banks (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          name text NOT NULL,
          bcb_match text NOT NULL DEFAULT '',
          cdc_pf_pct numeric(7,4) CHECK (cdc_pf_pct IS NULL OR (cdc_pf_pct >= 0.05 AND cdc_pf_pct <= 15)),
          cdc_pj_pct numeric(7,4) CHECK (cdc_pj_pct IS NULL OR (cdc_pj_pct >= 0.05 AND cdc_pj_pct <= 15)),
          leasing_pj_pct numeric(7,4) CHECK (leasing_pj_pct IS NULL OR (leasing_pj_pct >= 0.05 AND leasing_pj_pct <= 15)),
          fee_cadastro_cents bigint CHECK (fee_cadastro_cents IS NULL OR fee_cadastro_cents BETWEEN 0 AND 5000000),
          fee_avaliacao_cents bigint CHECK (fee_avaliacao_cents IS NULL OR fee_avaliacao_cents BETWEEN 0 AND 5000000),
          fee_registro_cents bigint CHECK (fee_registro_cents IS NULL OR fee_registro_cents BETWEEN 0 AND 5000000),
          notes text NOT NULL DEFAULT '',
          active boolean NOT NULL DEFAULT true,
          display_order integer NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_financing_banks_name ON financing_banks(lower(name));
        CREATE TABLE IF NOT EXISTS financing_bank_rates (
          segment text NOT NULL CHECK (segment IN ('PF','PJ')),
          modality text NOT NULL CHECK (modality IN ('CDC','LEASING')),
          institution text NOT NULL,
          monthly_pct numeric(7,4) NOT NULL,
          annual_pct numeric(8,2),
          position integer,
          period text,
          fetched_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (segment, modality, institution)
        );
        ALTER TABLE financing_settings ADD COLUMN IF NOT EXISTS banks_refreshed_at timestamptz;
        ALTER TABLE financing_settings ADD COLUMN IF NOT EXISTS banks_refresh_error text;
      `);
      // Bancos comuns em financiamento de veículos. Sem taxa própria: a média do Banco Central da instituição é usada quando existir.
      const seed: Array<[string, string]> = [
        ['Banco do Brasil', 'DO BRASIL'], ['Bradesco', 'BRADESCO'], ['Itaú', 'ITAU'], ['Santander', 'SANTANDER'], ['Banco BV', 'BV'], ['Banco Pan', 'PAN'],
        ['Banco Safra', 'SAFRA'], ['Banco Volkswagen', 'VOLKSWAGEN'], ['Banco RCI (Renault)', 'RCI'], ['Banco Toyota', 'TOYOTA'], ['Banco Honda', 'HONDA'], ['Banco Yamaha', 'YAMAHA']
      ];
      let order = 0;
      for (const [name, match] of seed) {
        await client.query('INSERT INTO financing_banks(name,bcb_match,display_order) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [name, match, order++]);
      }
    }
  },
  {
    id: '022_vehicle_consumption_obs',
    name: 'Guia de veículos: consumo oficial como observações por fonte (Inmetro, fabricante) e híbridos Corolla e Civic',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS vehicle_consumption_obs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          brand text NOT NULL,
          model text NOT NULL,
          version_label text NOT NULL,
          model_year integer CHECK (model_year IS NULL OR model_year BETWEEN 1950 AND 2100),
          segment text,
          propulsion text,
          fuel text NOT NULL,
          city_kml numeric(5,1) CHECK (city_kml IS NULL OR (city_kml > 0 AND city_kml <= 60)),
          road_kml numeric(5,1) CHECK (road_kml IS NULL OR (road_kml > 0 AND road_kml <= 60)),
          unit text NOT NULL DEFAULT 'km/l',
          cycle text NOT NULL,
          source_kind text NOT NULL CHECK (source_kind IN ('INMETRO','FABRICANTE','OUTRA')),
          source_name text NOT NULL,
          source_url text NOT NULL,
          reference_date date,
          collected_at date NOT NULL,
          status text NOT NULL DEFAULT 'A_CONFERIR' CHECK (status IN ('CONFERIDO','A_CONFERIR')),
          note text NOT NULL DEFAULT '',
          model_id uuid REFERENCES vehicle_models(id) ON DELETE SET NULL,
          version_id uuid REFERENCES vehicle_versions(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CHECK (city_kml IS NOT NULL OR road_kml IS NOT NULL)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_consumption_unique ON vehicle_consumption_obs(lower(brand), lower(model), lower(version_label), coalesce(model_year, 0), lower(fuel), lower(cycle), source_kind);
        CREATE INDEX IF NOT EXISTS idx_vehicle_consumption_model ON vehicle_consumption_obs(model_id) WHERE status = 'CONFERIDO';
      `);

      // Corolla XEi: a ficha de referência trazia 11,9/14,5 (gasolina) e 8,0/10,0 (etanol); a tabela do Inmetro traz 12,3/14,9 e 8,6/10,7.
      // Só corrige se a ficha ainda tem o valor da carga inicial (se a equipe editou, não mexe).
      await client.query(
        `UPDATE vehicle_versions v SET specs = specs || '{"cons_city_gas_kml":12.3,"cons_road_gas_kml":14.9,"cons_city_eth_kml":8.6,"cons_road_eth_kml":10.7}'::jsonb, updated_at = now()
           FROM vehicle_models m WHERE m.id = v.model_id AND m.slug = 'toyota-corolla' AND v.name = 'XEi 2.0'
            AND (v.specs->>'cons_city_gas_kml')::numeric = 11.9 AND (v.specs->>'cons_road_gas_kml')::numeric = 14.5
            AND (v.specs->>'cons_city_eth_kml')::numeric = 8 AND (v.specs->>'cons_road_eth_kml')::numeric = 10`
      );

      // Versão híbrida do Corolla (só com o que as fontes informam).
      const corolla = await client.query(`SELECT id FROM vehicle_models WHERE slug='toyota-corolla'`);
      if (corolla.rowCount) {
        const v = COROLLA_HYBRID_VERSION;
        await client.query(
          `INSERT INTO vehicle_versions(model_id,name,year_model,fuel,specs,display_order) VALUES($1,$2,$3,$4,$5::jsonb,10) ON CONFLICT DO NOTHING`,
          [corolla.rows[0].id, v.name, v.yearModel, v.fuel, JSON.stringify(v.specs)]
        );
      }
      // Civic: modelo novo, publicado só com o consumo oficial.
      const civic = await client.query(
        `INSERT INTO vehicle_models(slug,brand,name,vehicle_type,body_type,summary,status,spec_source) VALUES($1,$2,$3,$4,$5,'','PUBLISHED',$6) ON CONFLICT (slug) DO NOTHING RETURNING id`,
        [CIVIC_MODEL.slug, CIVIC_MODEL.brand, CIVIC_MODEL.name, CIVIC_MODEL.vehicleType, CIVIC_MODEL.bodyType, CIVIC_MODEL.specSource]
      );
      if (civic.rowCount) {
        await client.query(
          `INSERT INTO vehicle_versions(model_id,name,year_model,fuel,specs,display_order) VALUES($1,$2,$3,$4,$5::jsonb,0) ON CONFLICT DO NOTHING`,
          [civic.rows[0].id, CIVIC_MODEL.version.name, CIVIC_MODEL.version.yearModel, CIVIC_MODEL.version.fuel, JSON.stringify(CIVIC_MODEL.version.specs)]
        );
      }

      const link = async (o: ConsumptionSeed) => {
        const m = await client.query(`SELECT id FROM vehicle_models WHERE slug=$1`, [o.modelSlug]);
        const modelId = (m.rows[0]?.id as string | undefined) ?? null;
        let versionId: string | null = null;
        if (modelId && o.versionName) {
          const v = await client.query(`SELECT id FROM vehicle_versions WHERE model_id=$1 AND lower(name)=lower($2) ORDER BY year_model DESC NULLS LAST LIMIT 1`, [modelId, o.versionName]);
          versionId = (v.rows[0]?.id as string | undefined) ?? null;
        }
        await client.query(
          `INSERT INTO vehicle_consumption_obs(brand,model,version_label,segment,propulsion,fuel,city_kml,road_kml,cycle,source_kind,source_name,source_url,collected_at,status,note,model_id,version_id)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PBEV 2024',$9,$10,$11,$12,'CONFERIDO',$13,$14,$15) ON CONFLICT DO NOTHING`,
          [o.brand, o.model, o.versionLabel, o.segment, o.propulsion, o.fuel, o.cityKml, o.roadKml, o.sourceKind, o.sourceName ?? INMETRO_NAME, o.sourceUrl ?? INMETRO_PBEV_2024_URL, COLLECTED_AT, o.note, modelId, versionId]
        );
      };
      for (const o of [...CONSUMPTION_SEED, HONDA_CIVIC_OBS]) await link(o);
    }
  },
  {
    id: '023_vehicle_catalog',
    name: 'Catálogo de frota (Senatran), ligação com o guia, destaques, créditos de foto e interesse por veículo',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS vehicle_catalog (
          id bigserial PRIMARY KEY,
          raw_name text NOT NULL UNIQUE,
          search_text text NOT NULL,
          fleet_total bigint NOT NULL DEFAULT 0 CHECK (fleet_total >= 0),
          year_min integer,
          year_max integer,
          years jsonb NOT NULL DEFAULT '{}'::jsonb,
          snapshot text NOT NULL,
          model_id uuid REFERENCES vehicle_models(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_vehicle_catalog_fleet ON vehicle_catalog(fleet_total DESC);
        CREATE INDEX IF NOT EXISTS idx_vehicle_catalog_model ON vehicle_catalog(model_id) WHERE model_id IS NOT NULL;

        CREATE TABLE IF NOT EXISTS vehicle_catalog_snapshots (
          snapshot text PRIMARY KEY,
          names integer NOT NULL,
          fleet_total bigint NOT NULL,
          source_name text NOT NULL,
          license text NOT NULL,
          loaded_at timestamptz NOT NULL DEFAULT now()
        );

        ALTER TABLE vehicle_models
          ADD COLUMN IF NOT EXISTS catalog_brands text[] NOT NULL DEFAULT '{}',
          ADD COLUMN IF NOT EXISTS catalog_names text[] NOT NULL DEFAULT '{}',
          ADD COLUMN IF NOT EXISTS catalog_exclude text[] NOT NULL DEFAULT '{}',
          ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false,
          ADD COLUMN IF NOT EXISTS featured_order integer,
          ADD COLUMN IF NOT EXISTS image_credit text,
          ADD COLUMN IF NOT EXISTS image_license text,
          ADD COLUMN IF NOT EXISTS image_source_url text;

        CREATE TABLE IF NOT EXISTS vehicle_interest_events (
          id bigserial PRIMARY KEY,
          event_type text NOT NULL CHECK (event_type IN ('SIMULATOR_PICK','SEARCH_PICK','MODEL_VIEW','SEARCH_NO_RESULT')),
          catalog_id bigint REFERENCES vehicle_catalog(id) ON DELETE SET NULL,
          model_id uuid REFERENCES vehicle_models(id) ON DELETE SET NULL,
          term text,
          session_key text,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_vehicle_interest_created ON vehicle_interest_events(event_type, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_vehicle_interest_catalog ON vehicle_interest_events(catalog_id) WHERE catalog_id IS NOT NULL;
      `);

      // Nomes que o Senatran escreve de outro jeito ou que pertencem a outro modelo (todos conferidos no arquivo de set/2026).
      await client.query(`UPDATE vehicle_models SET catalog_exclude='{plus}' WHERE slug='chevrolet-onix' AND catalog_exclude='{}'`);
      await client.query(`UPDATE vehicle_models SET catalog_names='{onix plus}' WHERE slug='chevrolet-onix-sedan' AND catalog_names='{}'`);
      await client.query(`UPDATE vehicle_models SET catalog_exclude='{cross}' WHERE slug='toyota-corolla' AND catalog_exclude='{}'`);
      await client.query(`UPDATE vehicle_models SET catalog_exclude='{sw4}' WHERE slug='toyota-hilux' AND catalog_exclude='{}'`);
      await client.query(`UPDATE vehicle_models SET catalog_names='{t cross,tcross}' WHERE slug='volkswagen-t-cross' AND catalog_names='{}'`);

      const snap = readBundledSnapshot();
      await upsertCatalog(client, snap);
      await rematchCatalog(client);
    }
  },
  {
    id: '024_vehicle_photos_free_license',
    name: 'Fotos de veículos com licença livre e crédito (só onde o modelo ainda não tem foto)',
    up: async (client) => {
      for (const p of VEHICLE_PHOTOS) {
        await client.query(
          `UPDATE vehicle_models SET image_url=$2, image_credit=$3, image_license=$4, image_source_url=$5 WHERE slug=$1 AND image_url IS NULL`,
          [p.slug, photoUrl(p.file), p.credit, p.license, photoPage(p.file)]
        );
      }
    }
  },
  {
    id: '025_financing_faqs',
    name: 'Perguntas e respostas sobre CDC x leasing, atraso e inadimplência',
    up: async (client) => {
      const max = await client.query('SELECT coalesce(max(display_order),0) AS m FROM faqs');
      let order = Number(max.rows[0].m) + 10;
      for (const f of FINANCING_FAQS) {
        const r = await client.query('INSERT INTO faqs(category,question,answer,display_order) SELECT $1,$2,$3,$4 WHERE NOT EXISTS (SELECT 1 FROM faqs WHERE question=$2)', [f.category, f.question, f.answer, order]);
        if (r.rowCount) order += 10;
      }
    }
  },
  {
    id: '026_garage',
    name: 'Minha garagem: veículos salvos com quilometragem e itens (lembretes, manutenções e gastos informados pela pessoa)',
    up: async (client) => {
      await client.query(`
        ALTER TABLE saved_vehicles ADD COLUMN IF NOT EXISTS model_label text;
        ALTER TABLE saved_vehicles ADD COLUMN IF NOT EXISTS model_year integer CHECK (model_year IS NULL OR model_year BETWEEN 1950 AND 2100);
        ALTER TABLE saved_vehicles ADD COLUMN IF NOT EXISTS km integer CHECK (km IS NULL OR km BETWEEN 0 AND 3000000);
        ALTER TABLE saved_vehicles ADD COLUMN IF NOT EXISTS km_updated_at timestamptz;
        CREATE TABLE IF NOT EXISTS garage_items (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          vehicle_id uuid NOT NULL REFERENCES saved_vehicles(id) ON DELETE CASCADE,
          kind text NOT NULL CHECK (kind IN ('REMINDER','MAINTENANCE','EXPENSE')),
          title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
          due_date date,
          due_km integer CHECK (due_km IS NULL OR due_km BETWEEN 0 AND 3000000),
          event_date date,
          km integer CHECK (km IS NULL OR km BETWEEN 0 AND 3000000),
          amount_cents integer CHECK (amount_cents IS NULL OR amount_cents BETWEEN 0 AND 1000000000),
          done_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_garage_items_vehicle ON garage_items(vehicle_id, kind, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_garage_items_user ON garage_items(user_id);
        CREATE INDEX IF NOT EXISTS idx_vehicle_queries_user_plate ON vehicle_queries(user_id, plate);
      `);
    }
  },
  {
    id: '027_report_scope_publications',
    name: 'Escopo de relatório por produto: histórico de publicações do modelo de campos (snapshot por consulta)',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS report_template_publications (
          id bigserial PRIMARY KEY,
          product_id text NOT NULL REFERENCES query_products(id) ON DELETE CASCADE,
          template_id uuid NOT NULL REFERENCES report_templates(id) ON DELETE CASCADE,
          published_at timestamptz NOT NULL DEFAULT now(),
          superseded_at timestamptz,
          published_by uuid REFERENCES users(id),
          CHECK (superseded_at IS NULL OR superseded_at >= published_at)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_report_pub_current ON report_template_publications(product_id) WHERE superseded_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_report_pub_product_time ON report_template_publications(product_id, published_at);
      `);
    },
    down: async (client) => {
      await client.query('DROP TABLE IF EXISTS report_template_publications');
    }
  },
  {
    id: '028_email_outbox_secure_links',
    name: 'Fila de e-mails transacionais (retries, idempotência, auditoria) e links seguros expiráveis',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS email_outbox (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 8 AND 200),
          template text NOT NULL CHECK (template ~ '^[A-Z][A-Z0-9_]{2,59}$'),
          to_email text NOT NULL CHECK (position('@' in to_email) > 1 AND length(to_email) <= 254),
          to_name text,
          subject text NOT NULL,
          payload jsonb NOT NULL DEFAULT '{}'::jsonb,
          status text NOT NULL DEFAULT 'AGENDADO' CHECK (status IN ('AGENDADO','ENVIANDO','RETRY','ENVIADO','ENTREGUE','BOUNCED','FALHOU','CANCELADO')),
          attempts integer NOT NULL DEFAULT 0,
          max_attempts integer NOT NULL DEFAULT 6 CHECK (max_attempts BETWEEN 1 AND 20),
          next_attempt_at timestamptz NOT NULL DEFAULT now(),
          locked_at timestamptz,
          last_error text,
          message_id text,
          related_type text,
          related_id text,
          resend_count integer NOT NULL DEFAULT 0,
          created_by uuid REFERENCES users(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          sent_at timestamptz,
          delivered_at timestamptz,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_email_outbox_due ON email_outbox(next_attempt_at) WHERE status IN ('AGENDADO','RETRY');
        CREATE INDEX IF NOT EXISTS idx_email_outbox_related ON email_outbox(related_type, related_id);
        CREATE INDEX IF NOT EXISTS idx_email_outbox_message ON email_outbox(message_id) WHERE message_id IS NOT NULL;
        CREATE TABLE IF NOT EXISTS email_events (
          id bigserial PRIMARY KEY,
          outbox_id uuid NOT NULL REFERENCES email_outbox(id) ON DELETE CASCADE,
          event text NOT NULL,
          detail jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_email_events_outbox ON email_events(outbox_id, id);
        CREATE TABLE IF NOT EXISTS secure_links (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          token_hash text NOT NULL UNIQUE,
          purpose text NOT NULL CHECK (purpose IN ('CONTRACT_SIGN','CONTRACT_VIEW','FISCAL_DOCUMENT')),
          resource_type text NOT NULL,
          resource_id uuid NOT NULL,
          recipient_email text,
          expires_at timestamptz NOT NULL,
          max_uses integer NOT NULL DEFAULT 10 CHECK (max_uses BETWEEN 1 AND 100),
          uses integer NOT NULL DEFAULT 0,
          revoked_at timestamptz,
          created_by uuid REFERENCES users(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          last_used_at timestamptz
        );
        CREATE INDEX IF NOT EXISTS idx_secure_links_resource ON secure_links(resource_type, resource_id);
      `);
    },
    down: async (client) => {
      await client.query('DROP TABLE IF EXISTS secure_links; DROP TABLE IF EXISTS email_events; DROP TABLE IF EXISTS email_outbox;');
    }
  }
  ,
  {
    id: '029_cnpj_cache',
    name: 'Cache de consulta de CNPJ (dados cadastrais minimos, sem quadro societario)',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS cnpj_cache (
          cnpj text PRIMARY KEY CHECK (cnpj ~ '^[0-9]{14}$'),
          data jsonb NOT NULL,
          source text NOT NULL,
          fetched_at timestamptz NOT NULL DEFAULT now()
        );
      `);
    },
    down: async (client) => { await client.query('DROP TABLE IF EXISTS cnpj_cache;'); }
  }
  ,
  {
    id: '030_contracts',
    name: 'Contratos versionados, assinatura eletronica e trilha imutavel',
    up: async (client) => {
      await client.query(`
        CREATE SEQUENCE IF NOT EXISTS contract_number_seq;
        CREATE TABLE IF NOT EXISTS contract_templates (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          code text NOT NULL UNIQUE,
          name text NOT NULL,
          kind text NOT NULL CHECK (kind IN ('PF_AVULSO','PJ_B2B','PACOTE_PERSONALIZADO','PARCEIRO','ADITIVO')),
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS contract_template_versions (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          template_id uuid NOT NULL REFERENCES contract_templates(id),
          version integer NOT NULL,
          status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','IN_REVIEW','APPROVED','PUBLISHED','RETIRED')),
          title text NOT NULL,
          body text NOT NULL,
          legal_review_ref text,
          created_by uuid REFERENCES users(id) ON DELETE SET NULL,
          approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
          approved_at timestamptz,
          published_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE(template_id, version)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_template_published ON contract_template_versions(template_id) WHERE status='PUBLISHED';
        CREATE TABLE IF NOT EXISTS contracts (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          number text NOT NULL UNIQUE,
          kind text NOT NULL CHECK (kind IN ('PF_AVULSO','PJ_B2B','PACOTE_PERSONALIZADO','PARCEIRO','ADITIVO')),
          status text NOT NULL DEFAULT 'RASCUNHO' CHECK (status IN ('RASCUNHO','EM_APROVACAO','APROVADO','AGUARDANDO_ASSINATURA','ASSINADO','RECUSADO','EXPIRADO','CANCELADO')),
          template_version_id uuid NOT NULL REFERENCES contract_template_versions(id),
          parent_contract_id uuid REFERENCES contracts(id),
          user_id uuid REFERENCES users(id) ON DELETE SET NULL,
          organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
          affiliate_id uuid REFERENCES affiliates(id) ON DELETE SET NULL,
          party jsonb NOT NULL,
          terms jsonb NOT NULL,
          rendered_body text NOT NULL,
          body_hash text NOT NULL,
          created_by uuid REFERENCES users(id) ON DELETE SET NULL,
          approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
          approved_at timestamptz,
          approved_hash text,
          sent_at timestamptz,
          expires_at timestamptz,
          signed_at timestamptz,
          cancel_reason text,
          applied_at timestamptz,
          applied_by uuid REFERENCES users(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_contracts_party ON contracts(organization_id, user_id, affiliate_id);
        CREATE TABLE IF NOT EXISTS contract_signers (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
          name text NOT NULL,
          email text NOT NULL,
          role text NOT NULL DEFAULT 'CONTRATANTE',
          status text NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE','ASSINADO','RECUSADO')),
          signed_at timestamptz,
          evidence jsonb,
          UNIQUE(contract_id, email)
        );
        CREATE TABLE IF NOT EXISTS contract_events (
          id bigserial PRIMARY KEY,
          contract_id uuid NOT NULL REFERENCES contracts(id),
          event text NOT NULL,
          actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
          detail jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_contract_events_contract ON contract_events(contract_id, id);
        CREATE OR REPLACE FUNCTION contract_events_immutable() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'contract_events e imutavel'; END; $$ LANGUAGE plpgsql;
        DROP TRIGGER IF EXISTS trg_contract_events_immutable ON contract_events;
        CREATE TRIGGER trg_contract_events_immutable BEFORE UPDATE OR DELETE ON contract_events FOR EACH ROW EXECUTE FUNCTION contract_events_immutable();
      `);
    },
    down: async (client) => {
      await client.query(`
        DROP TABLE IF EXISTS contract_events; DROP FUNCTION IF EXISTS contract_events_immutable();
        DROP TABLE IF EXISTS contract_signers; DROP TABLE IF EXISTS contracts;
        DROP TABLE IF EXISTS contract_template_versions; DROP TABLE IF EXISTS contract_templates;
        DROP SEQUENCE IF EXISTS contract_number_seq;
      `);
    }
  }
  ,
  {
    id: '031_payment_refunds',
    name: 'Solicitacoes de estorno pela API do provedor (idempotentes e auditaveis)',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS payment_refunds (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          order_id uuid NOT NULL REFERENCES payment_orders(id),
          provider text NOT NULL,
          external_payment_id text NOT NULL,
          status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','CONFIRMED','FAILED')),
          reason text NOT NULL,
          provider_refund_id text,
          error_code text,
          requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_refunds_active ON payment_refunds(order_id) WHERE status IN ('REQUESTED','CONFIRMED');
      `);
    },
    down: async (client) => { await client.query('DROP TABLE IF EXISTS payment_refunds;'); }
  }
  ,
  {
    id: '032_fiscal_queue',
    name: 'Fila de emissao fiscal com idempotencia, tentativas e trilha',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS fiscal_jobs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          document_id uuid NOT NULL REFERENCES fiscal_documents(id),
          idempotency_key text NOT NULL UNIQUE,
          provider text NOT NULL,
          status text NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE','ENVIANDO','RETRY','AGUARDANDO_PROVEDOR','EMITIDO','REJEITADO','CANCELADO','FALHOU')),
          attempts integer NOT NULL DEFAULT 0,
          max_attempts integer NOT NULL DEFAULT 6,
          next_attempt_at timestamptz NOT NULL DEFAULT now(),
          locked_at timestamptz,
          provider_ref text,
          last_error text,
          created_by uuid REFERENCES users(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_jobs_open_per_document ON fiscal_jobs(document_id) WHERE status IN ('PENDENTE','ENVIANDO','RETRY','AGUARDANDO_PROVEDOR');
        CREATE INDEX IF NOT EXISTS idx_fiscal_jobs_due ON fiscal_jobs(status, next_attempt_at);
        CREATE TABLE IF NOT EXISTS fiscal_events (
          id bigserial PRIMARY KEY,
          job_id uuid NOT NULL REFERENCES fiscal_jobs(id) ON DELETE CASCADE,
          event text NOT NULL,
          detail jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_fiscal_events_job ON fiscal_events(job_id, id);
      `);
    },
    down: async (client) => { await client.query('DROP TABLE IF EXISTS fiscal_events; DROP TABLE IF EXISTS fiscal_jobs;'); }
  }
  ,
  {
    id: '033_support_chat',
    name: 'Chat de suporte: conversas, mensagens, anexos seguros, notas internas e trilha',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS support_conversations (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          subject text NOT NULL,
          category text NOT NULL DEFAULT 'OUTRO' CHECK (category IN ('DUVIDA','PAGAMENTO','CONSULTA','CONTA','LGPD','OUTRO')),
          status text NOT NULL DEFAULT 'ABERTA' CHECK (status IN ('ABERTA','AGUARDANDO_ATENDENTE','EM_ATENDIMENTO','AGUARDANDO_CLIENTE','RESOLVIDA','ENCERRADA')),
          priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('BAIXA','NORMAL','ALTA','URGENTE')),
          handler text NOT NULL DEFAULT 'BOT' CHECK (handler IN ('BOT','HUMAN')),
          assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
          related_type text CHECK (related_type IN ('QUERY','ORDER','PAYMENT')),
          related_id uuid,
          last_message_at timestamptz NOT NULL DEFAULT now(),
          client_read_at timestamptz,
          staff_read_at timestamptz,
          resolved_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_support_conv_user ON support_conversations(user_id, last_message_at DESC);
        CREATE INDEX IF NOT EXISTS idx_support_conv_inbox ON support_conversations(status, priority, last_message_at DESC);
        CREATE TABLE IF NOT EXISTS support_messages (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          conversation_id uuid NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
          sender_type text NOT NULL CHECK (sender_type IN ('CLIENTE','ATENDENTE','BOT','SISTEMA')),
          sender_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
          body text NOT NULL CHECK (char_length(body) <= 4000),
          internal boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now(),
          CHECK (NOT internal OR sender_type = 'ATENDENTE')
        );
        CREATE INDEX IF NOT EXISTS idx_support_msg_conv ON support_messages(conversation_id, created_at);
        CREATE TABLE IF NOT EXISTS support_attachments (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          conversation_id uuid NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
          message_id uuid REFERENCES support_messages(id) ON DELETE SET NULL,
          uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
          file_name text NOT NULL,
          mime text NOT NULL CHECK (mime IN ('image/png','image/jpeg','image/webp','application/pdf')),
          size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 2097152),
          sha256 text NOT NULL,
          data bytea NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_support_att_conv ON support_attachments(conversation_id);
        CREATE TABLE IF NOT EXISTS support_events (
          id bigserial PRIMARY KEY,
          conversation_id uuid NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
          event text NOT NULL,
          actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
          detail jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_support_events_conv ON support_events(conversation_id, id);
      `);
    },
    down: async (client) => { await client.query('DROP TABLE IF EXISTS support_events; DROP TABLE IF EXISTS support_attachments; DROP TABLE IF EXISTS support_messages; DROP TABLE IF EXISTS support_conversations;'); }
  },
  {
    id: '034_testimonials',
    name: 'Depoimentos autorizados: consentimento, moderacao e trilha',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS testimonials (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid REFERENCES users(id) ON DELETE SET NULL,
          source text NOT NULL CHECK (source IN ('CLIENTE','MANUAL')),
          status text NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE','APROVADO','PUBLICADO','OCULTO','REMOVIDO')),
          display_name text NOT NULL DEFAULT '',
          body text NOT NULL DEFAULT '',
          rating smallint CHECK (rating BETWEEN 1 AND 5),
          consent_text text,
          consent_version text,
          consent_at timestamptz,
          consent_ip_hash text,
          proof_ref text,
          content_hash text,
          created_by uuid REFERENCES users(id) ON DELETE SET NULL,
          approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
          approved_at timestamptz,
          published_at timestamptz,
          reason text,
          removed_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CHECK (status = 'REMOVIDO' OR (length(body) BETWEEN 10 AND 500 AND length(display_name) BETWEEN 2 AND 80)),
          CHECK (status IN ('PENDENTE','REMOVIDO') OR (content_hash IS NOT NULL AND consent_at IS NOT NULL))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uq_testimonials_user_active ON testimonials(user_id) WHERE user_id IS NOT NULL AND status <> 'REMOVIDO';
        CREATE INDEX IF NOT EXISTS idx_testimonials_status ON testimonials(status, published_at DESC);
        CREATE TABLE IF NOT EXISTS testimonial_events (
          id bigserial PRIMARY KEY,
          testimonial_id uuid NOT NULL REFERENCES testimonials(id) ON DELETE CASCADE,
          event text NOT NULL,
          actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
          detail jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_testimonial_events ON testimonial_events(testimonial_id, id);
      `);
    },
    down: async (client) => { await client.query('DROP TABLE IF EXISTS testimonial_events; DROP TABLE IF EXISTS testimonials;'); }
  },
  {
    id: '035_support_faqs',
    name: 'Perguntas e respostas do atendimento (chat)',
    up: async (client) => {
      const max = await client.query('SELECT coalesce(max(display_order),0) AS m FROM faqs');
      let order = Number(max.rows[0].m) + 10;
      for (const f of SUPPORT_FAQS) {
        const r = await client.query('INSERT INTO faqs(category,question,answer,display_order) SELECT $1,$2,$3,$4 WHERE NOT EXISTS (SELECT 1 FROM faqs WHERE question=$2)', [f.category, f.question, f.answer, order]);
        if (r.rowCount) order += 10;
      }
    },
    down: async (client) => {
      for (const f of SUPPORT_FAQS) await client.query('DELETE FROM faqs WHERE question=$1 AND answer=$2', [f.question, f.answer]);
    }
  },
  {
    id: '036_civic_summary',
    name: 'Guia de veículos: descrição do Civic com o que as fontes informam',
    up: async (client) => {
      await client.query(`UPDATE vehicle_models SET summary=$1, updated_at=now() WHERE slug='honda-civic' AND summary=''`, [CIVIC_SUMMARY]);
    },
    down: async (client) => {
      await client.query(`UPDATE vehicle_models SET summary='', updated_at=now() WHERE slug='honda-civic' AND summary=$1`, [CIVIC_SUMMARY]);
    }
  },
  {
    id: '037_admin_trusted_devices',
    name: 'Painel: computadores confiáveis (não pedem o código de 2FA de novo)',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS admin_trusted_devices (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash text NOT NULL UNIQUE,
          label text,
          created_at timestamptz NOT NULL DEFAULT now(),
          last_used_at timestamptz,
          expires_at timestamptz NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_admin_trusted_devices_user ON admin_trusted_devices(user_id, expires_at DESC);
      `);
    },
    down: async (client) => { await client.query('DROP TABLE IF EXISTS admin_trusted_devices'); }
  },
  {
    id: '038_dealerships',
    name: 'Loja: cadastro da loja, equipe, estoque de veículos, leads, propostas e avaliações de troca',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS dealerships (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          owner_user_id uuid NOT NULL REFERENCES users(id),
          name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
          slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) BETWEEN 3 AND 40),
          whatsapp text CHECK (whatsapp IS NULL OR whatsapp ~ '^[0-9]{10,13}$'),
          email text CHECK (email IS NULL OR char_length(email) <= 254),
          city text CHECK (city IS NULL OR char_length(city) <= 80),
          state text CHECK (state IS NULL OR state ~ '^[A-Z]{2}$'),
          about text NOT NULL DEFAULT '' CHECK (char_length(about) <= 1000),
          public_enabled boolean NOT NULL DEFAULT false,
          active boolean NOT NULL DEFAULT true,
          vehicle_limit integer NOT NULL DEFAULT 30 CHECK (vehicle_limit >= 0 AND vehicle_limit <= 100000),
          member_limit integer NOT NULL DEFAULT 3 CHECK (member_limit >= 1 AND member_limit <= 1000),
          trade_in_discount_bps integer NOT NULL DEFAULT 800 CHECK (trade_in_discount_bps BETWEEN 0 AND 5000),
          stale_days integer NOT NULL DEFAULT 60 CHECK (stale_days BETWEEN 7 AND 720),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uq_dealerships_slug ON dealerships(lower(slug));
        CREATE UNIQUE INDEX IF NOT EXISTS uq_dealerships_owner ON dealerships(owner_user_id);

        CREATE TABLE IF NOT EXISTS dealership_members (
          dealership_id uuid NOT NULL REFERENCES dealerships(id) ON DELETE CASCADE,
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role text NOT NULL CHECK (role IN ('OWNER','MANAGER','SELLER')),
          active boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (dealership_id, user_id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uq_dealership_member_one_store ON dealership_members(user_id) WHERE active;

        CREATE TABLE IF NOT EXISTS stock_vehicles (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          dealership_id uuid NOT NULL REFERENCES dealerships(id) ON DELETE CASCADE,
          plate text CHECK (plate IS NULL OR plate ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'),
          brand text NOT NULL CHECK (char_length(btrim(brand)) BETWEEN 1 AND 40),
          model text NOT NULL CHECK (char_length(btrim(model)) BETWEEN 1 AND 60),
          version text NOT NULL DEFAULT '' CHECK (char_length(version) <= 80),
          year_manufacture smallint CHECK (year_manufacture IS NULL OR year_manufacture BETWEEN 1950 AND 2100),
          year_model smallint CHECK (year_model IS NULL OR year_model BETWEEN 1950 AND 2100),
          color text NOT NULL DEFAULT '' CHECK (char_length(color) <= 30),
          fuel text NOT NULL DEFAULT '' CHECK (char_length(fuel) <= 30),
          transmission text NOT NULL DEFAULT '' CHECK (char_length(transmission) <= 30),
          mileage_km integer CHECK (mileage_km IS NULL OR mileage_km BETWEEN 0 AND 3000000),
          price_cents integer NOT NULL CHECK (price_cents BETWEEN 0 AND 2000000000),
          cost_cents integer CHECK (cost_cents IS NULL OR cost_cents BETWEEN 0 AND 2000000000),
          fipe_cents integer CHECK (fipe_cents IS NULL OR fipe_cents BETWEEN 0 AND 2000000000),
          status text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','RESERVED','SOLD','ARCHIVED')),
          public_listed boolean NOT NULL DEFAULT true,
          seal_enabled boolean NOT NULL DEFAULT true,
          description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
          photos jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(photos) = 'array' AND jsonb_array_length(photos) <= 8),
          query_id uuid REFERENCES vehicle_queries(id) ON DELETE SET NULL,
          ipva_due_on date,
          licensing_due_on date,
          entered_on date NOT NULL DEFAULT current_date,
          sold_at timestamptz,
          sold_price_cents integer CHECK (sold_price_cents IS NULL OR sold_price_cents BETWEEN 0 AND 2000000000),
          created_by uuid REFERENCES users(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CHECK (status <> 'SOLD' OR sold_at IS NOT NULL)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_open_plate ON stock_vehicles(dealership_id, plate) WHERE plate IS NOT NULL AND status IN ('AVAILABLE','RESERVED');
        CREATE INDEX IF NOT EXISTS idx_stock_dealership_status ON stock_vehicles(dealership_id, status, entered_on);
        CREATE INDEX IF NOT EXISTS idx_stock_public ON stock_vehicles(dealership_id, created_at DESC) WHERE public_listed AND status IN ('AVAILABLE','RESERVED');

        CREATE TABLE IF NOT EXISTS dealer_leads (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          dealership_id uuid NOT NULL REFERENCES dealerships(id) ON DELETE CASCADE,
          vehicle_id uuid REFERENCES stock_vehicles(id) ON DELETE SET NULL,
          assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
          name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
          phone text CHECK (phone IS NULL OR phone ~ '^[0-9]{10,13}$'),
          email text CHECK (email IS NULL OR char_length(email) <= 254),
          source text NOT NULL DEFAULT 'OUTRO' CHECK (source IN ('VITRINE','SITE','WHATSAPP','INDICACAO','LOJA','OUTRO')),
          stage text NOT NULL DEFAULT 'NEW' CHECK (stage IN ('NEW','CONTACT','PROPOSAL','VISIT','WON','LOST')),
          notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 2000),
          lost_reason text CHECK (lost_reason IS NULL OR char_length(lost_reason) <= 200),
          value_cents integer CHECK (value_cents IS NULL OR value_cents BETWEEN 0 AND 2000000000),
          next_contact_at timestamptz,
          consent_at timestamptz,
          closed_at timestamptz,
          created_by uuid REFERENCES users(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CHECK (phone IS NOT NULL OR email IS NOT NULL),
          CHECK ((stage IN ('WON','LOST')) = (closed_at IS NOT NULL))
        );
        CREATE INDEX IF NOT EXISTS idx_dealer_leads_stage ON dealer_leads(dealership_id, stage, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_dealer_leads_assigned ON dealer_leads(assigned_to) WHERE assigned_to IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_dealer_leads_followup ON dealer_leads(dealership_id, next_contact_at) WHERE next_contact_at IS NOT NULL AND stage NOT IN ('WON','LOST');
        CREATE INDEX IF NOT EXISTS idx_dealer_leads_dedupe ON dealer_leads(dealership_id, phone, created_at DESC) WHERE phone IS NOT NULL;

        CREATE TABLE IF NOT EXISTS dealer_lead_events (
          id bigserial PRIMARY KEY,
          lead_id uuid NOT NULL REFERENCES dealer_leads(id) ON DELETE CASCADE,
          type text NOT NULL CHECK (type IN ('CREATED','STAGE','NOTE','ASSIGNED','PROPOSAL')),
          from_stage text,
          to_stage text,
          note text CHECK (note IS NULL OR char_length(note) <= 2000),
          actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_dealer_lead_events ON dealer_lead_events(lead_id, id);

        CREATE TABLE IF NOT EXISTS dealer_proposals (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          code text NOT NULL UNIQUE,
          dealership_id uuid NOT NULL REFERENCES dealerships(id) ON DELETE CASCADE,
          lead_id uuid REFERENCES dealer_leads(id) ON DELETE SET NULL,
          vehicle_id uuid REFERENCES stock_vehicles(id) ON DELETE SET NULL,
          customer_name text NOT NULL CHECK (char_length(btrim(customer_name)) BETWEEN 2 AND 80),
          vehicle_label text NOT NULL CHECK (char_length(btrim(vehicle_label)) BETWEEN 2 AND 160),
          price_cents integer NOT NULL CHECK (price_cents BETWEEN 1 AND 2000000000),
          down_payment_cents integer NOT NULL DEFAULT 0 CHECK (down_payment_cents >= 0),
          trade_in_cents integer NOT NULL DEFAULT 0 CHECK (trade_in_cents >= 0),
          months integer CHECK (months IS NULL OR months BETWEEN 1 AND 120),
          installment_cents integer CHECK (installment_cents IS NULL OR installment_cents >= 0),
          rate_pct numeric(7,3) CHECK (rate_pct IS NULL OR rate_pct >= 0),
          valid_until date NOT NULL,
          notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 500),
          snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_by uuid REFERENCES users(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          CHECK (down_payment_cents + trade_in_cents <= price_cents)
        );
        CREATE INDEX IF NOT EXISTS idx_dealer_proposals ON dealer_proposals(dealership_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS dealer_trade_ins (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          dealership_id uuid NOT NULL REFERENCES dealerships(id) ON DELETE CASCADE,
          lead_id uuid REFERENCES dealer_leads(id) ON DELETE SET NULL,
          plate text CHECK (plate IS NULL OR plate ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'),
          vehicle_label text NOT NULL CHECK (char_length(btrim(vehicle_label)) BETWEEN 2 AND 160),
          year_model smallint CHECK (year_model IS NULL OR year_model BETWEEN 1950 AND 2100),
          mileage_km integer NOT NULL CHECK (mileage_km BETWEEN 0 AND 3000000),
          condition text NOT NULL CHECK (condition IN ('EXCELENTE','BOM','REGULAR')),
          fipe_cents integer NOT NULL CHECK (fipe_cents BETWEEN 100000 AND 2000000000),
          suggested_cents integer NOT NULL CHECK (suggested_cents >= 0),
          min_cents integer NOT NULL CHECK (min_cents >= 0),
          max_cents integer NOT NULL CHECK (max_cents >= 0),
          breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
          created_by uuid REFERENCES users(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_dealer_trade_ins ON dealer_trade_ins(dealership_id, created_at DESC);
      `);
    },
    down: async (client) => {
      await client.query(`
        DROP TABLE IF EXISTS dealer_trade_ins;
        DROP TABLE IF EXISTS dealer_proposals;
        DROP TABLE IF EXISTS dealer_lead_events;
        DROP TABLE IF EXISTS dealer_leads;
        DROP TABLE IF EXISTS stock_vehicles;
        DROP TABLE IF EXISTS dealership_members;
        DROP TABLE IF EXISTS dealerships;
      `);
    }
  },
  {
    id: '039_dealer_branding',
    name: 'Loja: personalização da vitrine (logo, capa, cor, Instagram, endereço, horário) e arquivamento',
    up: async (client) => {
      await client.query(`
        ALTER TABLE dealerships
          ADD COLUMN IF NOT EXISTS logo_url text CHECK (logo_url IS NULL OR (logo_url ~ '^https://' AND length(logo_url) <= 500)),
          ADD COLUMN IF NOT EXISTS cover_url text CHECK (cover_url IS NULL OR (cover_url ~ '^https://' AND length(cover_url) <= 500)),
          ADD COLUMN IF NOT EXISTS accent_color text CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9a-fA-F]{6}$'),
          ADD COLUMN IF NOT EXISTS instagram text CHECK (instagram IS NULL OR instagram ~ '^[A-Za-z0-9._]{1,30}$'),
          ADD COLUMN IF NOT EXISTS address text CHECK (address IS NULL OR length(address) <= 160),
          ADD COLUMN IF NOT EXISTS hours text CHECK (hours IS NULL OR length(hours) <= 120),
          ADD COLUMN IF NOT EXISTS archived_at timestamptz;
      `);
    },
    down: async (client) => {
      await client.query(`ALTER TABLE dealerships DROP COLUMN IF EXISTS logo_url, DROP COLUMN IF EXISTS cover_url, DROP COLUMN IF EXISTS accent_color, DROP COLUMN IF EXISTS instagram, DROP COLUMN IF EXISTS address, DROP COLUMN IF EXISTS hours, DROP COLUMN IF EXISTS archived_at`);
    }
  },
  {
    id: '040_free_coupon_orders',
    name: 'Pedidos de consulta com total zero (cupom de 100%)',
    up: async (client) => {
      await client.query(`
        ALTER TABLE payment_orders DROP CONSTRAINT IF EXISTS payment_orders_amount_cents_check;
        ALTER TABLE payment_orders DROP CONSTRAINT IF EXISTS payment_orders_amount_nonnegative_check;
        ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_amount_nonnegative_check CHECK (amount_cents >= 0);
      `);
    },
    down: async (client) => {
      await client.query(`
        ALTER TABLE payment_orders DROP CONSTRAINT IF EXISTS payment_orders_amount_nonnegative_check;
        ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_amount_cents_check CHECK (amount_cents > 0) NOT VALID;
      `);
    }
  },
  {
    id: '041_search_types',
    name: 'Consulta por chassi, Renavam e documento do proprietário: tipo de busca em consultas, pedidos e direitos pagos',
    up: async (client) => {
      await client.query(`
        ALTER TABLE vehicle_queries ADD COLUMN IF NOT EXISTS search_type text NOT NULL DEFAULT 'PLATE';
        ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS query_search_type text NOT NULL DEFAULT 'PLATE';
        ALTER TABLE query_payment_entitlements ADD COLUMN IF NOT EXISTS search_type text NOT NULL DEFAULT 'PLATE';
        ALTER TABLE vehicle_queries DROP CONSTRAINT IF EXISTS vehicle_queries_search_type_check;
        ALTER TABLE vehicle_queries ADD CONSTRAINT vehicle_queries_search_type_check CHECK (search_type IN ('PLATE','CHASSIS','RENAVAM','OWNER_DOC'));
        ALTER TABLE payment_orders DROP CONSTRAINT IF EXISTS payment_orders_query_search_type_check;
        ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_query_search_type_check CHECK (query_search_type IN ('PLATE','CHASSIS','RENAVAM','OWNER_DOC'));
        ALTER TABLE query_payment_entitlements DROP CONSTRAINT IF EXISTS query_payment_entitlements_search_type_check;
        ALTER TABLE query_payment_entitlements ADD CONSTRAINT query_payment_entitlements_search_type_check CHECK (search_type IN ('PLATE','CHASSIS','RENAVAM','OWNER_DOC'));
      `);
    },
    down: async (client) => {
      await client.query(`
        ALTER TABLE query_payment_entitlements DROP COLUMN IF EXISTS search_type;
        ALTER TABLE payment_orders DROP COLUMN IF EXISTS query_search_type;
        ALTER TABLE vehicle_queries DROP COLUMN IF EXISTS search_type;
      `);
    }
  },
  {
    id: '042_purchase_contracts',
    name: 'Contrato de adesão por compra: texto exato, código de confirmação por e-mail, aceite com evidências, vínculo ao pedido',
    up: async (client) => {
      await client.query(`
        CREATE SEQUENCE IF NOT EXISTS purchase_contract_seq;
        CREATE TABLE IF NOT EXISTS purchase_contracts (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          number text NOT NULL UNIQUE,
          user_id uuid NOT NULL REFERENCES users(id),
          kind text NOT NULL CHECK (kind IN ('PACKAGE','QUERY')),
          item_key text NOT NULL,
          amount_cents integer NOT NULL CHECK (amount_cents >= 0),
          model_version text NOT NULL,
          party jsonb NOT NULL,
          body text NOT NULL,
          body_hash text NOT NULL,
          status text NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE','ACEITO','USADO','EXPIRADO')),
          otp_channel text NOT NULL DEFAULT 'EMAIL',
          otp_destination text,
          otp_hash text,
          otp_expires_at timestamptz,
          otp_attempts integer NOT NULL DEFAULT 0,
          otp_sent_count integer NOT NULL DEFAULT 0,
          otp_last_sent_at timestamptz,
          accepted_at timestamptz,
          accept_ip_hash text,
          accept_user_agent text,
          order_id uuid REFERENCES payment_orders(id),
          expires_at timestamptz NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_contracts_order ON purchase_contracts(order_id) WHERE order_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_purchase_contracts_user ON purchase_contracts(user_id, created_at DESC);
        CREATE OR REPLACE FUNCTION purchase_contracts_frozen() RETURNS trigger AS $$
        BEGIN
          IF NEW.body IS DISTINCT FROM OLD.body OR NEW.body_hash IS DISTINCT FROM OLD.body_hash OR NEW.party IS DISTINCT FROM OLD.party
             OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents OR NEW.number IS DISTINCT FROM OLD.number OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
            RAISE EXCEPTION 'purchase_contracts: texto e partes nao mudam depois de gerados';
          END IF;
          RETURN NEW;
        END; $$ LANGUAGE plpgsql;
        DROP TRIGGER IF EXISTS trg_purchase_contracts_frozen ON purchase_contracts;
        CREATE TRIGGER trg_purchase_contracts_frozen BEFORE UPDATE ON purchase_contracts FOR EACH ROW EXECUTE FUNCTION purchase_contracts_frozen();
      `);
    },
    down: async (client) => {
      await client.query('DROP TABLE IF EXISTS purchase_contracts; DROP FUNCTION IF EXISTS purchase_contracts_frozen(); DROP SEQUENCE IF EXISTS purchase_contract_seq;');
    }
  },
  {
    id: '043_legal_acceptance_audit',
    name: 'Aceite auditável: IP, navegador, versão e vínculo no registro de consentimentos e no contrato de compra',
    up: async (client) => {
      await client.query(`
        ALTER TABLE user_consents ADD COLUMN IF NOT EXISTS ip text;
        ALTER TABLE user_consents ADD COLUMN IF NOT EXISTS user_agent text;
        ALTER TABLE user_consents ADD COLUMN IF NOT EXISTS related_type text;
        ALTER TABLE user_consents ADD COLUMN IF NOT EXISTS related_id text;
        ALTER TABLE purchase_contracts ADD COLUMN IF NOT EXISTS accept_ip text;
        ALTER TABLE purchase_contracts ADD COLUMN IF NOT EXISTS privacy_accepted_at timestamptz;
        ALTER TABLE purchase_contracts ADD COLUMN IF NOT EXISTS privacy_version text;
        CREATE INDEX IF NOT EXISTS idx_user_consents_related ON user_consents(related_type, related_id) WHERE related_id IS NOT NULL;
      `);
    },
    down: async (client) => {
      await client.query(`
        DROP INDEX IF EXISTS idx_user_consents_related;
        ALTER TABLE purchase_contracts DROP COLUMN IF EXISTS privacy_version;
        ALTER TABLE purchase_contracts DROP COLUMN IF EXISTS privacy_accepted_at;
        ALTER TABLE purchase_contracts DROP COLUMN IF EXISTS accept_ip;
        ALTER TABLE user_consents DROP COLUMN IF EXISTS related_id;
        ALTER TABLE user_consents DROP COLUMN IF EXISTS related_type;
        ALTER TABLE user_consents DROP COLUMN IF EXISTS user_agent;
        ALTER TABLE user_consents DROP COLUMN IF EXISTS ip;
      `);
    }
  },
  {
    id: '044_complete_product_vehicle_total_sections',
    name: 'Consulta Completa passa a exibir histórico/ocorrências e FIPE (blocos do Veículo Total)',
    up: async (client) => {
      // Aditivo: só acrescenta as duas seções novas ao produto COMPLETE, se ele usa lista de seções e ainda não as tem.
      await client.query(`UPDATE query_products SET report_sections = report_sections || ARRAY(SELECT x FROM unnest(ARRAY['HISTORICO','FIPE']) x WHERE NOT (x = ANY(report_sections)))
        WHERE id='COMPLETE' AND report_sections IS NOT NULL`);
    },
    down: async (client) => {
      await client.query(`UPDATE query_products SET report_sections = array_remove(array_remove(report_sections,'HISTORICO'),'FIPE') WHERE id='COMPLETE' AND report_sections IS NOT NULL`);
    }
  },
  {
    id: '045_vehicle_queries_archived',
    name: 'Cliente pode arquivar consultas (estornadas, falhas ou antigas) para limpar o histórico',
    up: async (client) => {
      await client.query(`ALTER TABLE vehicle_queries ADD COLUMN IF NOT EXISTS archived_at timestamptz`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_vehicle_queries_user_archived ON vehicle_queries(user_id, archived_at)`);
    },
    down: async (client) => {
      await client.query(`DROP INDEX IF EXISTS idx_vehicle_queries_user_archived`);
      await client.query(`ALTER TABLE vehicle_queries DROP COLUMN IF EXISTS archived_at`);
    }
  },
  {
    id: '046_packages_match_credify_services',
    name: 'Textos e seções dos pacotes passam a refletir a consulta da Credify de cada um (Completa = Veículo Total; Gravame com dados do veículo)',
    up: async (client) => {
      await client.query(`UPDATE query_products SET
          description='Cadastro, débitos, multas, restrições, gravame, indício de sinistro, roubo/furto, leilão, recall, valor FIPE e proprietários em um único relatório.',
          features=$1::jsonb,
          coverage='Cadastro, débitos, restrições, gravame, histórico (sinistro, roubo/furto, leilão), recall, FIPE e proprietários',
          updated_at=now()
        WHERE id='COMPLETE'`, [JSON.stringify(['Tudo da Consulta Básica', 'Indício de sinistro, roubo/furto e leilão', 'Financiamento e gravame', 'Recall e inspeção veicular', 'Valor FIPE e preço médio de mercado', 'Quantidade de proprietários anteriores', 'Relatório em PDF com código de validação'])]);
      await client.query(`UPDATE query_products SET
          report_sections=ARRAY['IDENTIFICACAO','CARACTERISTICAS','GRAVAME'],
          features=$1::jsonb,
          coverage='Dados do veículo, gravame e restrição financeira',
          updated_at=now()
        WHERE id='LIEN' AND report_sections IS NOT NULL`, [JSON.stringify(['Dados do veículo', 'Gravame e restrição financeira', 'Agente financeiro, contrato e data de inclusão', 'Intenção de gravame', 'Relatório em PDF'])]);
    },
    down: async (client) => {
      await client.query(`UPDATE query_products SET report_sections=ARRAY['IDENTIFICACAO','GRAVAME'], updated_at=now() WHERE id='LIEN' AND report_sections IS NOT NULL`);
    }
  },
  {
    id: '047_complete_product_analyses',
    name: 'Consulta Completa passa a exibir as análises do sistema (chassi, quilometragem de referência, histórico e projeção da FIPE)',
    up: async (client) => {
      await client.query(`UPDATE query_products SET report_sections = report_sections || ARRAY['ANALISES']
        WHERE id='COMPLETE' AND report_sections IS NOT NULL AND NOT ('ANALISES' = ANY(report_sections))`);
      await client.query(`UPDATE query_products SET features=$1::jsonb, updated_at=now() WHERE id='COMPLETE'`,
        [JSON.stringify(['Tudo da Consulta Básica', 'Indício de sinistro, roubo/furto e leilão', 'Financiamento e gravame', 'Recall e inspeção veicular', 'Valor FIPE, histórico de preço e tendência', 'Decodificador de chassi e quilometragem de referência (estimativa)', 'Quantidade de proprietários anteriores', 'Relatório em PDF com código de validação'])]);
    },
    down: async (client) => {
      await client.query(`UPDATE query_products SET report_sections = array_remove(report_sections,'ANALISES') WHERE id='COMPLETE' AND report_sections IS NOT NULL`);
    }
  },
  {
    id: '048_package_descriptions_by_model',
    name: 'Descrição e itens de cada pacote de consulta alinhados ao que o relatório entrega',
    up: async (client) => {
      const rows: Array<{ id: string; tagline: string; description: string; long: string; coverage: string; features: string[] }> = [
        { id: 'COMPLETE', tagline: 'Histórico completo do veículo em um só relatório.',
          description: 'Cadastro, débitos, restrições, gravame, sinistro, roubo/furto, leilão, recall, FIPE com histórico e análises do sistema.',
          long: 'A checagem mais completa antes de comprar, vender ou financiar. Reúne tudo da Consulta Básica e acrescenta histórico de ocorrências (indício de sinistro, roubo/furto e leilão), gravame, recall, valor FIPE com evolução de preço e análises da Placa na Mão (decodificador de chassi e quilometragem de referência estimada).',
          coverage: 'Cadastro, débitos, restrições, gravame, histórico, recall, FIPE e análises',
          features: ['Dados do veículo, chassi, motor e características', 'Débitos: IPVA, licenciamento, multas e DPVAT', 'Restrições: furto/roubo, judicial, administrativa, tributária e RENAJUD', 'Indício de sinistro, roubo/furto e passagem por leilão', 'Financiamento: gravame e intenção de gravame', 'Recall e inspeção veicular', 'Valor FIPE, preço médio, variação em 12 e 24 meses e projeção', 'Decodificador de chassi e quilometragem de referência (estimativa)', 'Quantidade de proprietários anteriores', 'Relatório em PDF com código de validação'] },
        { id: 'BASIC', tagline: 'Cadastro, débitos e restrições.',
          description: 'Dados do veículo, débitos, multas e restrições para comprar com mais segurança.',
          long: 'O essencial para fechar uma compra com tranquilidade: confere se o veículo é o do anúncio e se há débitos, multas ou restrições registradas.',
          coverage: 'Cadastro, débitos e restrições',
          features: ['Dados do veículo, chassi e características', 'Município, UF e situação do veículo', 'Débitos: IPVA, licenciamento, multas e DPVAT', 'Restrições: furto/roubo, judicial, administrativa e tributária', 'Relatório em PDF com código de validação'] },
        { id: 'LIEN', tagline: 'Financiamento e restrição financeira.',
          description: 'Veja se o veículo tem gravame ou restrição financeira antes da transferência.',
          long: 'Verifica financiamento ativo: gravame, agente financeiro e intenção de gravame informados pela fonte. Ideal para quem já conferiu o resto e quer fechar essa dúvida.',
          coverage: 'Dados do veículo, gravame e restrição financeira',
          features: ['Dados do veículo', 'Gravame e restrição financeira', 'Agente financeiro, contrato e data de inclusão', 'Intenção de gravame', 'Relatório em PDF com código de validação'] },
        { id: 'CADASTRAL', tagline: 'Confirme se o veículo é o do anúncio.',
          description: 'Marca, modelo, ano, cor, combustível, município e situação do veículo pela placa.',
          long: 'A forma mais rápida e barata de conferir se o veículo corresponde ao anúncio e ao documento: identificação, características e situação cadastral.',
          coverage: 'Identificação, características e situação cadastral',
          features: ['Marca, modelo, ano e cor', 'Combustível, categoria e espécie', 'Município, UF e situação', 'Relatório em PDF com código de validação'] },
        { id: 'AUCTION', tagline: 'Passagem do veículo por leilão.',
          description: 'Histórico de passagem por leilão. Disponível quando a fonte de dados for ativada.',
          long: 'Saiba se o veículo já passou por leilão, informação importante para avaliação, seguro e revenda. Ainda não está disponível: só vendemos o que conseguimos entregar.',
          coverage: 'Histórico de leilão (em breve)',
          features: ['Passagem por leilão', 'Dados do veículo', 'Relatório em PDF com código de validação'] }
      ];
      for (const r of rows) {
        await client.query(`UPDATE query_products SET tagline=$2, description=$3, long_description=$4, coverage=$5, features=$6::jsonb, updated_at=now() WHERE id=$1`,
          [r.id, r.tagline, r.description, r.long, r.coverage, JSON.stringify(r.features)]);
      }
    },
    down: async () => { /* textos comerciais: sem reversão */ }
  },
  {
    id: '049_support_assistant',
    name: 'Suporte: respostas prontas da equipe e relatos de problema (erros do sistema)',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS support_canned_replies (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          title text NOT NULL,
          body text NOT NULL,
          category text NOT NULL DEFAULT 'GERAL',
          active boolean NOT NULL DEFAULT true,
          use_count integer NOT NULL DEFAULT 0,
          created_by uuid REFERENCES users(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_support_canned_title ON support_canned_replies(lower(title));
        CREATE TABLE IF NOT EXISTS support_problem_reports (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          fingerprint text NOT NULL,
          source text NOT NULL CHECK (source IN ('CHAT','NAVEGADOR','CONSULTA')),
          severity text NOT NULL DEFAULT 'MEDIA' CHECK (severity IN ('BAIXA','MEDIA','ALTA')),
          title text NOT NULL,
          detail jsonb NOT NULL DEFAULT '{}'::jsonb,
          route text,
          status text NOT NULL DEFAULT 'ABERTO' CHECK (status IN ('ABERTO','EM_ANALISE','RESOLVIDO','IGNORADO')),
          occurrences integer NOT NULL DEFAULT 1,
          users_affected integer NOT NULL DEFAULT 0,
          last_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
          conversation_id uuid REFERENCES support_conversations(id) ON DELETE SET NULL,
          note text,
          first_seen timestamptz NOT NULL DEFAULT now(),
          last_seen timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_support_problem_fp ON support_problem_reports(fingerprint) WHERE status IN ('ABERTO','EM_ANALISE');
        CREATE INDEX IF NOT EXISTS idx_support_problem_list ON support_problem_reports(status, last_seen DESC);
      `);
      const canned: Array<[string, string, string]> = [
        ['Boas-vindas', 'Olá! Aqui é da equipe da Placa na Mão. Vou te ajudar com isso. Pode me passar mais detalhes?', 'GERAL'],
        ['Consulta em andamento', 'Sua consulta está sendo processada. Costuma levar poucos segundos. Se passou de alguns minutos, me avise o número da placa que eu confiro agora.', 'CONSULTA'],
        ['Consulta falhou: valor devolvido', 'A fonte de dados não respondeu e a consulta não foi concluída. O valor volta para o seu saldo automaticamente. Pode tentar de novo em alguns minutos.', 'CONSULTA'],
        ['Informação não veio no relatório', 'O relatório mostra só o que a fonte de dados retorna para essa placa. Quando um item não vem, ele não aparece. Se achar que faltou algo, me diga qual item e a placa que eu verifico.', 'CONSULTA'],
        ['Pix pago e saldo não entrou', 'Vou conferir o seu pagamento. Pix confirma em poucos minutos. Se já passou disso, me envie o comprovante (imagem ou PDF) por aqui.', 'PAGAMENTO'],
        ['Reembolso: como funciona', 'Consulta concluída não é reembolsada, porque o dado já foi entregue. Se houve falha ou cobrança em duplicidade, eu analiso e devolvo. Me diga o dia e o valor.', 'PAGAMENTO'],
        ['Esqueci a senha', 'Na tela de entrada, clique em "Esqueci a senha" e siga o e-mail que enviaremos. Se o e-mail não chegar, olhe o spam e me avise.', 'CONTA'],
        ['Dados pessoais (LGPD)', 'Recebi seu pedido sobre dados pessoais. Vamos analisar e responder dentro do prazo legal. Para sua segurança, vamos confirmar sua identidade antes de qualquer alteração.', 'LGPD'],
        ['Pedir mais informações', 'Para eu conseguir ajudar, me envie: a placa, o horário aproximado e, se tiver, uma imagem da tela com o problema.', 'GERAL'],
        ['Problema registrado', 'Registramos o problema e a equipe técnica já está analisando. Assim que corrigido, avisamos por aqui.', 'GERAL'],
        ['Encerramento', 'Fico à disposição. Se precisar de mais alguma coisa, é só escrever por aqui. Obrigado por usar a Placa na Mão!', 'GERAL']
      ];
      for (const [title, body, category] of canned) await client.query(`INSERT INTO support_canned_replies(title,body,category) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [title, body, category]);
    },
    down: async (client) => { await client.query('DROP TABLE IF EXISTS support_problem_reports; DROP TABLE IF EXISTS support_canned_replies;'); }
  },
  {
    id: '050_seo_pages',
    name: 'SEO por página: título, descrição, palavra-chave, textos e perguntas frequentes editáveis no painel',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS seo_pages (
          path text PRIMARY KEY,
          title text,
          description text,
          keyword text,
          sections jsonb NOT NULL DEFAULT '[]'::jsonb,
          faq jsonb NOT NULL DEFAULT '[]'::jsonb,
          noindex boolean NOT NULL DEFAULT false,
          updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
      `);
      const { SEO_SEED } = await import('./seoSeed.js');
      for (const r of SEO_SEED) {
        await client.query(
          `INSERT INTO seo_pages(path,title,description,keyword,sections,faq) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb) ON CONFLICT (path) DO NOTHING`,
          [r.path, r.title ?? null, r.description ?? null, r.keyword, JSON.stringify(r.sections ?? []), JSON.stringify(r.faq)]);
      }
    },
    down: async (client) => { await client.query('DROP TABLE IF EXISTS seo_pages;'); }
  },
  {
    id: '051_seo_h1',
    name: 'SEO por página: campo H1 (título da página, até 30 caracteres) e conteúdo pronto para as demais páginas do site',
    up: async (client) => {
      await client.query('ALTER TABLE seo_pages ADD COLUMN IF NOT EXISTS h1 text;');
      const { SEO_SEED } = await import('./seoSeed.js');
      for (const r of SEO_SEED) {
        // Página nova entra completa. Página que já existia ganha o H1 e, se ninguém editou pelo painel, também os textos revisados. O que foi editado no painel nunca é sobrescrito.
        await client.query(
          `INSERT INTO seo_pages(path,h1,title,description,keyword,sections,faq) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)
           ON CONFLICT (path) DO UPDATE SET
             h1=COALESCE(seo_pages.h1,EXCLUDED.h1),
             keyword=COALESCE(seo_pages.keyword,EXCLUDED.keyword),
             title=CASE WHEN seo_pages.updated_by IS NULL THEN COALESCE(EXCLUDED.title,seo_pages.title) ELSE seo_pages.title END,
             description=CASE WHEN seo_pages.updated_by IS NULL THEN COALESCE(EXCLUDED.description,seo_pages.description) ELSE seo_pages.description END,
             sections=CASE WHEN seo_pages.updated_by IS NULL THEN EXCLUDED.sections ELSE seo_pages.sections END,
             faq=CASE WHEN seo_pages.updated_by IS NULL THEN EXCLUDED.faq ELSE seo_pages.faq END`,
          [r.path, r.h1, r.title ?? null, r.description ?? null, r.keyword, JSON.stringify(r.sections ?? []), JSON.stringify(r.faq)]);
      }
    },
    down: async (client) => { await client.query('ALTER TABLE seo_pages DROP COLUMN IF EXISTS h1;'); }
  },
  {
    id: '052_customer_responsibility',
    name: 'Cadastro completo do cliente: aceite do termo de responsabilidade pelas informações consultadas (data e versão)',
    up: async (client) => {
      await client.query(`
        ALTER TABLE user_profiles
          ADD COLUMN IF NOT EXISTS responsibility_accepted_at timestamptz,
          ADD COLUMN IF NOT EXISTS responsibility_version text;
      `);
    },
    down: async (client) => { await client.query('ALTER TABLE user_profiles DROP COLUMN IF EXISTS responsibility_version, DROP COLUMN IF EXISTS responsibility_accepted_at;'); }
  },
  {
    id: '053_complete_owner_section',
    name: 'Consulta Completa: seção de proprietário liberada no relatório do cliente (dados completos, sem máscara)',
    up: async (client) => {
      await client.query(`UPDATE query_products SET report_sections = report_sections || ARRAY['PROPRIETARIO'], updated_at=now()
        WHERE id='COMPLETE' AND report_sections IS NOT NULL AND NOT ('PROPRIETARIO' = ANY(report_sections))`);
    },
    down: async (client) => {
      await client.query(`UPDATE query_products SET report_sections = array_remove(report_sections,'PROPRIETARIO') WHERE id='COMPLETE' AND report_sections IS NOT NULL`);
    }
  },
  {
    id: '054_report_share_links',
    name: 'Link do vendedor: compartilhar o relatório com o comprador (expira, limita visualizações e pode ser revogado)',
    up: async (client) => {
      await client.query(`
        ALTER TABLE secure_links DROP CONSTRAINT IF EXISTS secure_links_purpose_check;
        ALTER TABLE secure_links ADD CONSTRAINT secure_links_purpose_check CHECK (purpose IN ('CONTRACT_SIGN','CONTRACT_VIEW','FISCAL_DOCUMENT','REPORT_SHARE'));
      `);
    },
    down: async (client) => {
      await client.query(`
        DELETE FROM secure_links WHERE purpose='REPORT_SHARE';
        ALTER TABLE secure_links DROP CONSTRAINT IF EXISTS secure_links_purpose_check;
        ALTER TABLE secure_links ADD CONSTRAINT secure_links_purpose_check CHECK (purpose IN ('CONTRACT_SIGN','CONTRACT_VIEW','FISCAL_DOCUMENT'));
      `);
    }
  },
  {
    id: '055_garage_email_alerts',
    name: 'Garagem: aviso por e-mail de lembrete perto de vencer e vencido (uma vez por etapa, com opção de desligar)',
    up: async (client) => {
      await client.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS garage_email_alerts boolean NOT NULL DEFAULT true;
        ALTER TABLE garage_items ADD COLUMN IF NOT EXISTS alert_soon_at timestamptz;
        ALTER TABLE garage_items ADD COLUMN IF NOT EXISTS alert_overdue_at timestamptz;
      `);
    },
    down: async (client) => {
      await client.query(`
        ALTER TABLE garage_items DROP COLUMN IF EXISTS alert_overdue_at;
        ALTER TABLE garage_items DROP COLUMN IF EXISTS alert_soon_at;
        ALTER TABLE users DROP COLUMN IF EXISTS garage_email_alerts;
      `);
    }
  },
  {
    id: '056_faq_owner_data_visible',
    name: 'FAQ de privacidade: dados do proprietário e do veículo aparecem completos (só troca o texto original, nunca um texto editado)',
    up: async (client) => {
      await client.query(`UPDATE faqs SET answer=$2, updated_at=now() WHERE question='Dados pessoais do proprietário aparecem?' AND answer=$1`, ['Não de forma aberta. Nome e documentos são protegidos conforme a LGPD, e identificadores sensíveis aparecem parcialmente mascarados no relatório.', 'Sim. O relatório é feito para uso profissional (análise de crédito, avaliação de veículo e comércio), por isso nome, CPF/CNPJ e identificadores do veículo aparecem completos, sem máscara, nos pacotes que incluem proprietário. O acesso é protegido por login e o uso dos dados deve seguir a LGPD.']);
    },
    down: async (client) => {
      await client.query(`UPDATE faqs SET answer=$1, updated_at=now() WHERE question='Dados pessoais do proprietário aparecem?' AND answer=$2`, ['Não de forma aberta. Nome e documentos são protegidos conforme a LGPD, e identificadores sensíveis aparecem parcialmente mascarados no relatório.', 'Sim. O relatório é feito para uso profissional (análise de crédito, avaliação de veículo e comércio), por isso nome, CPF/CNPJ e identificadores do veículo aparecem completos, sem máscara, nos pacotes que incluem proprietário. O acesso é protegido por login e o uso dos dados deve seguir a LGPD.']);
    }
  },
  {
    id: '057_plate_watches',
    name: 'Monitoramento de placa: reconsulta periódica paga pelo saldo do cliente, com histórico e aviso quando algo piora',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS plate_watches (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          plate text NOT NULL,
          product_id text NOT NULL REFERENCES query_products(id),
          interval_days integer NOT NULL CHECK (interval_days IN (7,15,30)),
          status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED')),
          pause_reason text,
          baseline_query_id uuid REFERENCES vehicle_queries(id) ON DELETE SET NULL,
          pending_query_id uuid REFERENCES vehicle_queries(id) ON DELETE SET NULL,
          last_checked_at timestamptz,
          next_check_at timestamptz NOT NULL DEFAULT now(),
          failures integer NOT NULL DEFAULT 0,
          runs integer NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uq_plate_watches_user_plate_product ON plate_watches(user_id, plate, product_id);
        CREATE INDEX IF NOT EXISTS idx_plate_watches_due ON plate_watches(next_check_at) WHERE status='ACTIVE';
        CREATE TABLE IF NOT EXISTS plate_watch_events (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          watch_id uuid NOT NULL REFERENCES plate_watches(id) ON DELETE CASCADE,
          kind text NOT NULL CHECK (kind IN ('BASELINE','NO_CHANGE','CHANGED','FAILED','PAUSED')),
          query_id uuid REFERENCES vehicle_queries(id) ON DELETE SET NULL,
          summary jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_plate_watch_events_watch ON plate_watch_events(watch_id, created_at DESC);
      `);
    },
    down: async (client) => {
      await client.query(`
        DROP TABLE IF EXISTS plate_watch_events;
        DROP TABLE IF EXISTS plate_watches;
      `);
    }
  },
  {
    id: '058_user_profiles_usage',
    name: 'Perfil de uso da conta (cliente, lojista, afiliado): guarda o perfil escolhido e mapeia as contas que já existem',
    up: async (client) => {
      await client.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS active_profile text NOT NULL DEFAULT 'CLIENTE';
        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_active_profile_check;
        ALTER TABLE users ADD CONSTRAINT users_active_profile_check CHECK (active_profile IN ('CLIENTE','LOJISTA','AFILIADO'));
        UPDATE users u SET active_profile='LOJISTA'
          WHERE u.role='CLIENTE' AND u.active_profile='CLIENTE'
            AND EXISTS (SELECT 1 FROM dealership_members m WHERE m.user_id=u.id AND m.active);
      `);
    },
    down: async (client) => {
      await client.query(`
        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_active_profile_check;
        ALTER TABLE users DROP COLUMN IF EXISTS active_profile;
      `);
    }
  },
  {
    id: '059_preco_competitivo',
    name: 'Preços mais baixos nas consultas (Básica R$ 29,90). Só muda quem ainda está no preço inicial e respeita o piso de margem',
    up: async (client) => {
      const novos: Array<[string, number, number, number]> = [
        ['COMPLETE', 6160, 5490, 5790],
        ['BASIC', 4360, 2990, 3150],
        ['AUCTION', 3310, 2790, 2950],
        ['LIEN', 1410, 1190, 1250],
        ['CADASTRAL', 1320, 990, 1050]
      ];
      for (const [id, antigo, novo, referencia] of novos) {
        const r = await client.query(
          `UPDATE query_products SET price_cents=$3::int, reference_price_cents=$4::int, credit_cost=GREATEST(1, CEIL($3::numeric/100))::int, price_version=price_version+1, price_updated_at=now(), updated_at=now()
            WHERE id=$1 AND price_cents=$2 AND (floor_price_cents IS NULL OR floor_price_cents <= $3::int)
            RETURNING price_version, floor_price_cents, margin_locked`,
          [id, antigo, novo, referencia]
        );
        if (r.rows[0]) {
          await client.query(
            `INSERT INTO product_price_history(product_id,version,old_price_cents,new_price_cents,reference_price_cents,floor_price_cents,margin_locked,reason) VALUES($1,$2,$3,$4,$5,$6,$7,'Revisão de preços do catálogo')`,
            [id, r.rows[0].price_version, antigo, novo, referencia, r.rows[0].floor_price_cents, Boolean(r.rows[0].margin_locked)]
          );
        }
      }
    },
    down: async (client) => {
      const antigos: Array<[string, number, number, number]> = [
        ['COMPLETE', 5490, 6160, 6490],
        ['BASIC', 2990, 4360, 4590],
        ['AUCTION', 2790, 3310, 3490],
        ['LIEN', 1190, 1410, 1490],
        ['CADASTRAL', 990, 1320, 1390]
      ];
      for (const [id, atual, antigo, referencia] of antigos) {
        await client.query(`UPDATE query_products SET price_cents=$3::int, reference_price_cents=$4::int, credit_cost=GREATEST(1, CEIL($3::numeric/100))::int, updated_at=now() WHERE id=$1 AND price_cents=$2`, [id, atual, antigo, referencia]);
      }
    }
  },
  {
    id: '060_cache_placa_preco_completa',
    name: 'Cache criptografado de respostas por placa e pacote; Completa a R$ 31,99 (só se ainda estiver no preço da revisão anterior e respeitando o piso de margem)',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS provider_cache (
          plate text NOT NULL,
          product_id text NOT NULL,
          provider text NOT NULL,
          payload text NOT NULL,
          provider_query_id text,
          created_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (plate, product_id, provider)
        );
        CREATE INDEX IF NOT EXISTS idx_provider_cache_created ON provider_cache(created_at);
      `);
      const r = await client.query(
        `UPDATE query_products SET price_cents=3199, reference_price_cents=3399, credit_cost=32, price_version=price_version+1, price_updated_at=now(), updated_at=now()
          WHERE id='COMPLETE' AND price_cents=5490 AND (floor_price_cents IS NULL OR floor_price_cents <= 3199)
          RETURNING price_version, floor_price_cents, margin_locked`
      );
      if (r.rows[0]) {
        await client.query(
          `INSERT INTO product_price_history(product_id,version,old_price_cents,new_price_cents,reference_price_cents,floor_price_cents,margin_locked,reason) VALUES('COMPLETE',$1,5490,3199,3399,$2,$3,'Completa em camadas: novo preço do catálogo')`,
          [r.rows[0].price_version, r.rows[0].floor_price_cents, Boolean(r.rows[0].margin_locked)]
        );
      }
    },
    down: async (client) => {
      await client.query(`UPDATE query_products SET price_cents=5490, reference_price_cents=5790, credit_cost=55, updated_at=now() WHERE id='COMPLETE' AND price_cents=3199`);
      await client.query(`DROP TABLE IF EXISTS provider_cache`);
    }
  },
  {
    id: '061_fontes_de_dados_por_produto',
    name: 'Fontes de dados (APIs) escolhidas por produto; vazio mantém o comportamento padrão',
    up: async (client) => {
      await client.query(`ALTER TABLE query_products ADD COLUMN IF NOT EXISTS data_sources text[]`);
    },
    down: async (client) => {
      await client.query(`ALTER TABLE query_products DROP COLUMN IF EXISTS data_sources`);
    }
  },
  {
    id: '062_linha_completa_e_premium',
    name: 'Nova linha: Consulta Completa (relatório no padrão MTix, Veículo Total, R$ 32,99), Consulta Premium (camadas + gravame e Renajud detalhados). Preço só muda se ainda estiver no valor anterior e respeita o piso de margem',
    up: async (client) => {
      const features = (list: string[]) => JSON.stringify(list);
      // ── Consulta Completa (id COMPLETE): passa a comprar o pacote Veículo Total inteiro (sinistro, roubo/furto, leilão, recall, proprietários, base nacional e FIPE).
      const renamed = await client.query(
        `UPDATE query_products SET
            tagline=$1, description=$2, long_description=$3, coverage=$4, features=$5::jsonb, badge='Mais vendida', featured=true, display_order=10,
            data_sources = COALESCE(data_sources, ARRAY['TOTAL']::text[]), updated_at=now()
          WHERE id='COMPLETE' AND name='Consulta Completa' RETURNING id`,
        [
          'O relatório completo do veículo, pronto para decidir.',
          'Cadastro, débitos, multas, restrições, financiamento, indício de sinistro, roubo/furto, leilão, recall, proprietários e FIPE em um só relatório.',
          'A checagem completa antes de comprar, vender ou financiar. Reúne cadastro, débitos, multas e restrições e acrescenta indício de sinistro, histórico de roubo e furto, passagem por leilão, recall, histórico de proprietários, base nacional e valor FIPE com histórico, com resumo em semáforo e PDF com código de validação.',
          'Cadastro, débitos, restrições, financiamento, sinistro, roubo/furto, leilão, recall, proprietários e FIPE',
          features([
            'Resumo da checagem em semáforo: débitos, restrições, alienação, sinistro, roubo/furto e leilão',
            'Dados do veículo, chassi, motor e características',
            'Débitos: IPVA, licenciamento, multas e DPVAT',
            'Restrições: furto/roubo, judicial, administrativa, tributária e base nacional',
            'Indício de sinistro e histórico de roubo/furto',
            'Passagem por leilão',
            'Alienação fiduciária (financiamento)',
            'Recall e inspeção veicular',
            'Quantidade de proprietários anteriores',
            'Valor FIPE, preço médio, variação em 12 e 24 meses e projeção',
            'Decodificador de chassi e quilometragem de referência (estimativa)',
            'Relatório em PDF com código de validação'
          ])
        ]
      );
      const priceRow = async (id: string, from: number | null, to: number, ref: number, reason: string) => {
        const before = Number((await client.query('SELECT price_cents FROM query_products WHERE id=$1', [id])).rows[0]?.price_cents ?? to);
        const r = await client.query(
          `UPDATE query_products SET price_cents=GREATEST($3::int, COALESCE(floor_price_cents,0)), reference_price_cents=$4::int,
              credit_cost=GREATEST(1, CEIL(GREATEST($3::int, COALESCE(floor_price_cents,0))::numeric/100))::int, price_version=price_version+1, price_updated_at=now(), updated_at=now()
            WHERE id=$1 AND ($2::int IS NULL OR price_cents=$2::int)
            RETURNING price_version, price_cents, floor_price_cents, margin_locked`,
          [id, from, to, ref]
        );
        const row = r.rows[0];
        if (row) {
          await client.query(
            `INSERT INTO product_price_history(product_id,version,old_price_cents,new_price_cents,reference_price_cents,floor_price_cents,margin_locked,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
            [id, row.price_version, before, row.price_cents, ref, row.floor_price_cents, Boolean(row.margin_locked), reason]
          );
        }
      };
      if (renamed.rowCount) await priceRow('COMPLETE', 3199, 3299, 3499, 'Nova Consulta Completa (padrão MTix): R$ 32,99');

      // ── Consulta Premium (id PREMIUM): o que era a Completa em camadas, com gravame e Renajud detalhados.
      const premium = await client.query(
        `UPDATE query_products SET
            name='Consulta Premium', tagline=$1, description=$2, long_description=$3, coverage=$4, features=$5::jsonb, badge='Cobertura máxima', featured=false,
            display_order=15, active=true, is_free=false, commercial_status='ACTIVE', show_on_home=true, pricing_mode='MANUAL', data_sources=NULL,
            report_sections=ARRAY['IDENTIFICACAO','CARACTERISTICAS','REGISTRO','DEBITOS','RESTRICOES','HISTORICO','GRAVAME','INSPECAO_RECALL','FIPE','ANALISES','PROPRIETARIO'],
            updated_at=now()
          WHERE id='PREMIUM' RETURNING id`,
        [
          'Tudo da Completa, com financiamento e restrições judiciais em detalhe.',
          'Relatório máximo: tudo da Consulta Completa, com gravame detalhado (banco, contrato e datas), restrições judiciais (Renajud) e leilão passagem a passagem.',
          'Para negócios de valor alto ou veículo financiado. Reúne tudo da Consulta Completa e acrescenta o gravame detalhado (banco, contrato, prazo e valores), as restrições judiciais com tribunal, processo e data (Renajud), a base nacional completa e o leilão com o detalhe de cada passagem.',
          'Tudo da Completa, gravame detalhado, restrições judiciais e leilão detalhado',
          features([
            'Tudo da Consulta Completa',
            'Gravame detalhado: banco, contrato, datas, prazo e valores',
            'Restrições judiciais (Renajud): tribunal, processo e data',
            'Leilão com o detalhe de cada passagem',
            'Base nacional completa: restrições 01 a 04, situação do chassi e importação',
            'Relatório em PDF com código de validação'
          ])
        ]
      );
      if (premium.rowCount) {
        await priceRow('PREMIUM', null, 4490, 4790, 'Nova Consulta Premium: R$ 44,90');
        await client.query(`DELETE FROM query_source_rules WHERE product_id='PREMIUM'`);
        await client.query(`INSERT INTO query_source_rules(product_id,source_type,provider,active,priority,coverage) VALUES('PREMIUM','IDENTITY','contracted',true,10,'Cadastro, débitos, restrições, histórico, gravame e restrições judiciais detalhados, recall e FIPE (fonte contratada)')`);
      }

      // A Básica (BASIC) continua ativa: clientes da API pública e links antigos ainda compram por esse id. Para tirá-la da vitrine, desative no painel.

      // ── Comparação: recursos novos e leilão incluso na Completa e na Premium.
      const novos: Array<[string, string, string, number]> = [
        ['renajud', 'Restrições judiciais detalhadas (Renajud)', 'Tribunal, processo e data da restrição judicial.', 52],
        ['gravame-detalhado', 'Gravame detalhado', 'Banco, contrato, datas, prazo e valores do financiamento.', 62],
        ['historico-ocorrencias', 'Sinistro, roubo e furto', 'Indício de sinistro e histórico de roubo ou furto.', 72],
        ['fipe', 'Valor FIPE e histórico', 'Preço FIPE, preço médio de mercado, variação e projeção.', 74],
        ['proprietarios', 'Histórico de proprietários', 'Quantidade de proprietários anteriores.', 76]
      ];
      for (const [key, label, description, order] of novos) {
        await client.query(`INSERT INTO catalog_features(key,label,description,display_order) VALUES($1,$2,$3,$4) ON CONFLICT (key) DO NOTHING`, [key, label, description, order]);
      }
      const matrix: Record<string, Record<string, 'INCLUDED' | 'NOT_INCLUDED'>> = {
        COMPLETE: { 'dados-veiculo': 'INCLUDED', registro: 'INCLUDED', identificadores: 'INCLUDED', debitos: 'INCLUDED', restricoes: 'INCLUDED', gravame: 'INCLUDED', 'recall-inspecao': 'INCLUDED', leilao: 'INCLUDED', 'historico-ocorrencias': 'INCLUDED', fipe: 'INCLUDED', proprietarios: 'INCLUDED', 'gravame-detalhado': 'NOT_INCLUDED', renajud: 'NOT_INCLUDED', pdf: 'INCLUDED' },
        PREMIUM: { 'dados-veiculo': 'INCLUDED', registro: 'INCLUDED', identificadores: 'INCLUDED', debitos: 'INCLUDED', restricoes: 'INCLUDED', gravame: 'INCLUDED', 'recall-inspecao': 'INCLUDED', leilao: 'INCLUDED', 'historico-ocorrencias': 'INCLUDED', fipe: 'INCLUDED', proprietarios: 'INCLUDED', 'gravame-detalhado': 'INCLUDED', renajud: 'INCLUDED', pdf: 'INCLUDED' }
      };
      for (const [productId, map] of Object.entries(matrix)) {
        for (const [key, status] of Object.entries(map)) {
          await client.query(`INSERT INTO product_catalog_features(product_id,feature_id,status) SELECT $1,id,$3 FROM catalog_features WHERE key=$2 ON CONFLICT DO NOTHING`, [productId, key, status]);
        }
        await client.query(`UPDATE product_catalog_features SET status='INCLUDED' WHERE product_id=$1 AND status='SOON' AND feature_id=(SELECT id FROM catalog_features WHERE key='leilao')`, [productId]);
      }

      // ── Perguntas frequentes que citavam a Básica e o leilão "em breve" (só se ainda estiverem como no texto original).
      const faq = (question: string) => SEED_FAQS.find((f) => f.question === question)?.answer;
      const choose = faq('Qual consulta devo escolher?');
      if (choose) await client.query(`UPDATE faqs SET answer=$2, updated_at=now() WHERE question='Qual consulta devo escolher?' AND answer=$1`, [choose, 'Para conferir se o veículo é o que o anúncio diz, a Cadastral resolve. Se você vai comprar, a Completa reúne débitos, multas, restrições, financiamento, indício de sinistro, roubo/furto, leilão, recall e FIPE em um só relatório. Se o negócio é de valor alto ou o veículo está financiado, a Premium acrescenta o gravame detalhado (banco, contrato e datas) e as restrições judiciais. Na página de planos há um comparador que monta a combinação mais barata para o que você precisa.']);
      const auction = faq('A consulta de leilão já está disponível?');
      if (auction) await client.query(`UPDATE faqs SET answer=$2, updated_at=now() WHERE question='A consulta de leilão já está disponível?' AND answer=$1`, [auction, 'Sim. A passagem por leilão já vem dentro das consultas Completa e Premium. A consulta avulsa de leilão ainda aparece como “em breve”. Nada é cobrado por informação que não possa ser entregue.']);
    },
    down: async (client) => {
      await client.query(`UPDATE query_products SET price_cents=3199, reference_price_cents=3399, credit_cost=32, data_sources=NULL, badge='Mais completa', updated_at=now() WHERE id='COMPLETE' AND price_cents=3299`);
      await client.query(`UPDATE query_products SET data_sources=NULL WHERE id='COMPLETE' AND data_sources=ARRAY['TOTAL']::text[]`);
      await client.query(`UPDATE query_products SET active=false, featured=false, show_on_home=false, updated_at=now() WHERE id='PREMIUM'`);
      await client.query(`DELETE FROM query_source_rules WHERE product_id='PREMIUM'`);
    }
  },
  {
    id: '063_completa_em_camadas_padrao_mtix',
    name: 'Consulta Completa passa a ser montada em camadas (base de débitos + sinistro + base nacional + leilão conjugado; roubo/furto e recall quando o cadastro indica), sem o pacote fechado. Só troca se ainda estiver na fonte da 062',
    up: async (client) => {
      const layers = ['SINISTRO', 'NATIONAL', 'THEFT', 'RECALL', 'AUCTION'];
      const done = await client.query(
        `UPDATE query_products SET data_sources=$1::text[], features=(
            SELECT COALESCE(jsonb_agg(f), '[]'::jsonb) FROM jsonb_array_elements(features) f WHERE f <> to_jsonb('Quantidade de proprietários anteriores'::text)
          ), updated_at=now()
          WHERE id='COMPLETE' AND data_sources=ARRAY['TOTAL']::text[] RETURNING id`,
        [layers]
      );
      if (done.rowCount) {
        // O histórico de proprietários só vem no pacote fechado; não prometemos o que a montagem em camadas não entrega.
        await client.query(`UPDATE product_catalog_features SET status='NOT_INCLUDED' WHERE product_id IN ('COMPLETE','PREMIUM') AND status='INCLUDED' AND feature_id=(SELECT id FROM catalog_features WHERE key='proprietarios')`);
      }
    },
    down: async (client) => {
      await client.query(`UPDATE query_products SET data_sources=ARRAY['TOTAL']::text[] WHERE id='COMPLETE' AND data_sources=ARRAY['SINISTRO','NATIONAL','THEFT','RECALL','AUCTION']::text[]`);
    }
  },
  {
    id: '064_textos_e_fontes_completa_premium',
    name: 'Ajusta os textos da vitrine da Completa e da Premium ao que cada uma entrega de fato e fixa as fontes da Premium (camadas + gravame e Renajud quando o cadastro indica). Só mexe nos textos que ainda estão como na 062',
    up: async (client) => {
      await client.query(
        `UPDATE query_products SET description=$1, long_description=$2, coverage=$3, features=$4::jsonb, updated_at=now()
          WHERE id='COMPLETE' AND tagline='O relatório completo do veículo, pronto para decidir.'`,
        [
          'Cadastro, débitos, multas, restrições, financiamento, indício de sinistro, roubo/furto, leilão, recall e FIPE em um só relatório.',
          'A checagem completa antes de comprar, vender ou financiar. Reúne cadastro, débitos, multas e restrições e acrescenta indício de sinistro, histórico de roubo e furto, passagem por leilão, recall, base nacional e valor FIPE com histórico, com resumo em semáforo e PDF com código de validação.',
          'Cadastro, débitos, restrições, financiamento, sinistro, roubo/furto, leilão, recall e FIPE',
          JSON.stringify([
            'Resumo da checagem em semáforo: débitos, restrições, alienação, sinistro, roubo/furto e leilão',
            'Dados do veículo, chassi, motor e características',
            'Débitos: IPVA, licenciamento, multas e DPVAT',
            'Restrições: furto/roubo, judicial, administrativa, tributária e base nacional',
            'Indício de sinistro e histórico de roubo/furto',
            'Passagem por leilão: data, leiloeiro, lote e condição do veículo',
            'Alienação fiduciária (financiamento)',
            'Recall e inspeção veicular',
            'Valor FIPE, preço médio, variação em 12 e 24 meses e projeção',
            'Fabricante, origem e ano pelo chassi e quilometragem de referência (estimativa)',
            'Relatório em PDF com código de validação'
          ])
        ]
      );
      await client.query(
        `UPDATE query_products SET description=$1, long_description=$2, coverage=$3, features=$4::jsonb, updated_at=now()
          WHERE id='PREMIUM' AND tagline='Tudo da Completa, com financiamento e restrições judiciais em detalhe.'`,
        [
          'Tudo da Consulta Completa, mais o gravame detalhado (banco, contrato e datas) e as restrições judiciais (Renajud).',
          'Para negócios de valor alto ou veículo financiado. Reúne tudo da Consulta Completa e acrescenta o gravame detalhado (banco, contrato, prazo e valores) e as restrições judiciais com tribunal, processo e data (Renajud), quando o cadastro indica alienação ou restrição.',
          'Tudo da Completa, gravame detalhado e restrições judiciais',
          JSON.stringify([
            'Tudo da Consulta Completa',
            'Gravame detalhado: banco, contrato, datas, prazo e valores (quando há alienação)',
            'Restrições judiciais (Renajud): tribunal, processo e data (quando há restrição)',
            'Relatório em PDF com código de validação'
          ])
        ]
      );
      // Fontes fixas: a Premium não depende de variável de ambiente para trazer gravame e Renajud.
      await client.query(`UPDATE query_products SET data_sources=ARRAY['SINISTRO','NATIONAL','THEFT','RECALL','AUCTION','GRAVAME','RENAJUD']::text[] WHERE id='PREMIUM' AND data_sources IS NULL`);
    },
    down: async (client) => {
      await client.query(`UPDATE query_products SET data_sources=NULL WHERE id='PREMIUM' AND data_sources=ARRAY['SINISTRO','NATIONAL','THEFT','RECALL','AUCTION','GRAVAME','RENAJUD']::text[]`);
    }
  },
  {
    id: '065_premium_com_historico_de_proprietarios',
    name: 'Consulta Premium passa a trazer também o histórico de proprietários (consulta própria da Credify). Só muda se a Premium ainda estiver nas fontes da 064 e com os textos da 064',
    up: async (client) => {
      const done = await client.query(
        `UPDATE query_products SET data_sources=ARRAY['SINISTRO','NATIONAL','THEFT','RECALL','AUCTION','GRAVAME','RENAJUD','OWNERS']::text[],
            description=$1, long_description=$2, coverage=$3, features=$4::jsonb, updated_at=now()
          WHERE id='PREMIUM' AND data_sources=ARRAY['SINISTRO','NATIONAL','THEFT','RECALL','AUCTION','GRAVAME','RENAJUD']::text[]
            AND tagline='Tudo da Completa, com financiamento e restrições judiciais em detalhe.' RETURNING id`,
        [
          'Tudo da Consulta Completa, mais gravame detalhado, restrições judiciais (Renajud) e histórico de proprietários.',
          'Para negócios de valor alto ou veículo financiado. Reúne tudo da Consulta Completa e acrescenta o gravame detalhado (banco, contrato, prazo e valores), as restrições judiciais com tribunal, processo e data (Renajud), quando o cadastro indica, e o histórico de proprietários do veículo.',
          'Tudo da Completa, gravame detalhado, restrições judiciais e histórico de proprietários',
          JSON.stringify([
            'Tudo da Consulta Completa',
            'Gravame detalhado: banco, contrato, datas, prazo e valores (quando há alienação)',
            'Restrições judiciais (Renajud): tribunal, processo e data (quando há restrição)',
            'Histórico de proprietários: quantidade e linha do tempo',
            'Relatório em PDF com código de validação'
          ])
        ]
      );
      if (done.rowCount) {
        await client.query(`UPDATE product_catalog_features SET status='INCLUDED' WHERE product_id='PREMIUM' AND feature_id=(SELECT id FROM catalog_features WHERE key='proprietarios')`);
      }
    },
    down: async (client) => {
      await client.query(`UPDATE query_products SET data_sources=ARRAY['SINISTRO','NATIONAL','THEFT','RECALL','AUCTION','GRAVAME','RENAJUD']::text[] WHERE id='PREMIUM' AND data_sources=ARRAY['SINISTRO','NATIONAL','THEFT','RECALL','AUCTION','GRAVAME','RENAJUD','OWNERS']::text[]`);
    }
  },
  {
    id: '066_gravame_sem_promessa_de_valores',
    name: 'Textos do gravame detalhado: as bases não informam saldo devedor nem parcelas, então a vitrine deixa de prometer "valores". Só troca onde o texto ainda é o das migrações anteriores',
    up: async (client) => {
      await client.query(`UPDATE query_products SET
          description=replace(replace(description,'(banco, contrato, prazo e valores)','(banco, contrato, datas e prazo do contrato)'),'banco, contrato, datas, prazo e valores','banco, contrato, datas e prazo do contrato'),
          long_description=replace(replace(long_description,'(banco, contrato, prazo e valores)','(banco, contrato, datas e prazo do contrato)'),'(banco, contrato, datas, prazo e valores)','(banco, contrato, datas e prazo do contrato)'),
          features=replace(features::text,'datas, prazo e valores','datas e prazo do contrato')::jsonb,
          updated_at=now()
        WHERE id='PREMIUM' AND (description LIKE '%prazo e valores%' OR long_description LIKE '%prazo e valores%' OR features::text LIKE '%prazo e valores%')`);
      await client.query(`UPDATE catalog_features SET description='Banco, contrato, datas e prazo do contrato. As bases oficiais não informam saldo devedor nem parcelas.' WHERE key='gravame-detalhado' AND description='Banco, contrato, datas, prazo e valores do financiamento.'`);
    },
    down: async (client) => {
      await client.query(`UPDATE catalog_features SET description='Banco, contrato, datas, prazo e valores do financiamento.' WHERE key='gravame-detalhado' AND description='Banco, contrato, datas e prazo do contrato. As bases oficiais não informam saldo devedor nem parcelas.'`);
    }
  },
  {
    id: '067_fipe_alteracoes_e_multas_detalhadas',
    name: 'Completa e Premium: FIPE pela placa e comparação de alterações entre bases; Premium: multas detalhadas por infração (RENAINF). Só muda onde as fontes ainda são as das migrações anteriores',
    up: async (client) => {
      const alteracoes = 'Alterações de características: chassi, motor, câmbio, cor e combustível comparados entre as bases';
      const pdf = '"Relatório em PDF com código de validação"';
      const completa = await client.query(
        `UPDATE query_products SET data_sources=ARRAY['SINISTRO','NATIONAL','THEFT','RECALL','AUCTION','FIPE']::text[],
            features=CASE WHEN features::text LIKE '%Alterações de características%' THEN features ELSE replace(features::text, $1, to_jsonb($2::text)::text || ',' || $1)::jsonb END, updated_at=now()
          WHERE id='COMPLETE' AND data_sources=ARRAY['SINISTRO','NATIONAL','THEFT','RECALL','AUCTION']::text[] RETURNING id`,
        [pdf, alteracoes]
      );
      await client.query(
        `UPDATE query_products SET data_sources=ARRAY['SINISTRO','NATIONAL','THEFT','RECALL','AUCTION','GRAVAME','RENAJUD','OWNERS','FIPE','RENAINF']::text[],
            features=CASE WHEN features::text LIKE '%Multas detalhadas%' THEN features ELSE replace(features::text, $1, to_jsonb($2::text)::text || ',' || $1)::jsonb END, updated_at=now()
          WHERE id='PREMIUM' AND data_sources=ARRAY['SINISTRO','NATIONAL','THEFT','RECALL','AUCTION','GRAVAME','RENAJUD','OWNERS']::text[] RETURNING id`,
        [pdf, 'Multas detalhadas: cada infração com descrição, vencimento e valor (RENAINF)']
      );
      await client.query(`INSERT INTO catalog_features(key,label,description,display_order) VALUES('alteracoes','Alterações de características','Compara chassi, motor, câmbio, cor e combustível entre o cadastro estadual, a base nacional e o registro de leilão.',56) ON CONFLICT (key) DO NOTHING`);
      await client.query(`INSERT INTO catalog_features(key,label,description,display_order) VALUES('multas-detalhadas','Multas detalhadas por infração','Cada multa com descrição, vencimento e valor (RENAINF).',57) ON CONFLICT (key) DO NOTHING`);
      for (const [productId, key] of [['COMPLETE', 'alteracoes'], ['PREMIUM', 'alteracoes'], ['PREMIUM', 'multas-detalhadas']] as const) {
        await client.query(`INSERT INTO product_catalog_features(product_id,feature_id,status) SELECT $1,id,'INCLUDED' FROM catalog_features WHERE key=$2 ON CONFLICT DO NOTHING`, [productId, key]);
      }
    },
    down: async (client) => {
      await client.query(`UPDATE query_products SET data_sources=ARRAY['SINISTRO','NATIONAL','THEFT','RECALL','AUCTION']::text[] WHERE id='COMPLETE' AND data_sources=ARRAY['SINISTRO','NATIONAL','THEFT','RECALL','AUCTION','FIPE']::text[]`);
      await client.query(`UPDATE query_products SET data_sources=ARRAY['SINISTRO','NATIONAL','THEFT','RECALL','AUCTION','GRAVAME','RENAJUD','OWNERS']::text[] WHERE id='PREMIUM' AND data_sources=ARRAY['SINISTRO','NATIONAL','THEFT','RECALL','AUCTION','GRAVAME','RENAJUD','OWNERS','FIPE','RENAINF']::text[]`);
    }
  },
  {
    id: '068_precos_premium_e_completa',
    name: 'Preços definidos pelo responsável: Premium (equivalente ao Veículo Completo+) R$ 62,90 e Completa (equivalente ao MTix) R$ 34,59. Premium vira a "Mais completa" e passa à frente na vitrine',
    up: async (client) => {
      const definir = async (id: string, novo: number, motivo: string) => {
        const atual = await client.query('SELECT price_cents, floor_price_cents FROM query_products WHERE id=$1', [id]);
        if (!atual.rowCount) return;
        const antes = Number(atual.rows[0].price_cents);
        // Preço escolhido pelo responsável. Se o piso gravado for maior (custo antigo), ele é limpo e volta a ser calculado ao salvar os custos em Financeiro.
        const r = await client.query(
          `UPDATE query_products SET price_cents=$2::int, pricing_mode='MANUAL', credit_cost=GREATEST(1, CEIL($2::numeric/100))::int,
              floor_price_cents=CASE WHEN floor_price_cents > $2::int THEN NULL ELSE floor_price_cents END, margin_locked=false,
              list_price_cents=CASE WHEN list_price_cents IS NOT NULL AND list_price_cents <= $2::int THEN NULL ELSE list_price_cents END,
              price_version=price_version+CASE WHEN price_cents<>$2::int THEN 1 ELSE 0 END,
              price_updated_at=CASE WHEN price_cents<>$2::int THEN now() ELSE price_updated_at END, updated_at=now()
            WHERE id=$1 RETURNING price_version, floor_price_cents`,
          [id, novo]
        );
        if (antes !== novo && r.rows[0]) {
          await client.query(
            `INSERT INTO product_price_history(product_id,version,old_price_cents,new_price_cents,reference_price_cents,floor_price_cents,margin_locked,reason) VALUES($1,$2,$3,$4,NULL,$5,false,$6)`,
            [id, r.rows[0].price_version, antes, novo, r.rows[0].floor_price_cents, motivo]
          );
        }
      };
      await definir('PREMIUM', 6290, 'Consulta Premium (padrão Veículo Completo+): R$ 62,90');
      await definir('COMPLETE', 3459, 'Consulta Completa (padrão MTix): R$ 34,59');
      // Premium é a "Mais completa" (faixa da página de planos) e vem primeiro; a Completa segue como a mais vendida.
      await client.query(`UPDATE query_products SET featured=true, badge='Mais completa', display_order=8, updated_at=now() WHERE id='PREMIUM' AND active=true`);
      await client.query(`UPDATE query_products SET featured=false, badge='Mais vendida', display_order=10, updated_at=now() WHERE id='COMPLETE' AND active=true`);
    },
    down: async (client) => {
      await client.query(`UPDATE query_products SET featured=false, badge='Cobertura máxima', display_order=15, updated_at=now() WHERE id='PREMIUM'`);
      await client.query(`UPDATE query_products SET featured=true, updated_at=now() WHERE id='COMPLETE'`);
    }
  },
  {
    id: '069_basica_com_gravame_e_leilao_ativo',
    name: 'Básica passa a incluir o gravame (banco, contrato e datas), sem leilão e sem proprietários; consulta Leilão passa a ficar ativa à venda. Só muda onde ainda está como antes',
    up: async (client) => {
      // ── Básica: base de cadastro/débitos/restrições + gravame completo (buscado quando o cadastro indica alienação).
      const basica = await client.query(
        `UPDATE query_products SET data_sources=ARRAY['GRAVAME']::text[],
            report_sections=CASE WHEN report_sections IS NULL THEN NULL WHEN 'GRAVAME'=ANY(report_sections) THEN report_sections ELSE array_append(report_sections,'GRAVAME') END,
            updated_at=now()
          WHERE id='BASIC' AND data_sources IS NULL RETURNING id`
      );
      if (basica.rowCount) {
        await client.query(`UPDATE query_products SET tagline='Cadastro, débitos, restrições e financiamento.' WHERE id='BASIC' AND tagline='Cadastro, débitos e restrições.'`);
        await client.query(`UPDATE query_products SET description='Dados do veículo, débitos, multas, restrições e financiamento (gravame) para comprar com mais segurança.' WHERE id='BASIC' AND description='Dados do veículo, débitos, multas e restrições para comprar com mais segurança.'`);
        await client.query(`UPDATE query_products SET coverage='Cadastro, débitos, restrições e gravame' WHERE id='BASIC' AND coverage='Cadastro, débitos e restrições'`);
        await client.query(
          `UPDATE query_products SET long_description='O essencial para fechar uma compra com tranquilidade: confere se o veículo é o do anúncio e se há débitos, multas, restrições ou financiamento ativo. Quando o veículo é financiado, mostra o banco, o contrato e as datas do gravame.'
            WHERE id='BASIC' AND long_description='O essencial para fechar uma compra com tranquilidade: confere se o veículo é o do anúncio e se há débitos, multas ou restrições registradas.'`
        );
        const pdf = '"Relatório em PDF com código de validação"';
        await client.query(
          `UPDATE query_products SET features=replace(features::text, $1, to_jsonb($2::text)::text || ',' || $1)::jsonb
            WHERE id='BASIC' AND features::text NOT LIKE '%Financiamento%' AND features::text LIKE '%' || $1 || '%'`,
          [pdf, 'Financiamento: gravame com banco, contrato e datas, quando houver']
        );
        for (const key of ['gravame', 'gravame-detalhado']) {
          await client.query(`INSERT INTO product_catalog_features(product_id,feature_id,status) SELECT 'BASIC',id,'INCLUDED' FROM catalog_features WHERE key=$1 ON CONFLICT (product_id,feature_id) DO UPDATE SET status='INCLUDED'`, [key]);
        }
      }

      // ── Leilão: sai de "em breve" e passa a ser vendido (base de cadastro + leilão conjugado). Preço não muda.
      const leilao = await client.query(`UPDATE query_products SET active=true, commercial_status='ACTIVE', updated_at=now() WHERE id='AUCTION' AND commercial_status='SOON' RETURNING id`);
      if (leilao.rowCount) {
        await client.query(`UPDATE query_products SET description='Veja se o veículo já passou por leilão: registros com data, leiloeiro, lote e condição, quando houver.' WHERE id='AUCTION' AND description LIKE 'Histórico de passagem por leilão.%'`);
        await client.query(`UPDATE query_products SET long_description='Saiba se o veículo já passou por leilão, informação importante para avaliação, seguro e revenda. O relatório traz os dados do veículo e cada registro de leilão encontrado.' WHERE id='AUCTION' AND long_description LIKE 'Saiba se o veículo já passou por leilão%Ainda não está disponível%'`);
        await client.query(`UPDATE query_products SET coverage='Dados do veículo e histórico de leilão' WHERE id='AUCTION' AND coverage='Histórico de leilão (em breve)'`);
        await client.query(`UPDATE query_products SET report_sections=ARRAY['IDENTIFICACAO','CARACTERISTICAS','HISTORICO']::text[] WHERE id='AUCTION' AND report_sections IS NULL`);
        const regra = await client.query(`SELECT 1 FROM query_source_rules WHERE product_id='AUCTION'`);
        if (!regra.rowCount) {
          await client.query(`INSERT INTO query_source_rules(product_id,source_type,provider,active,priority,coverage) VALUES('AUCTION','IDENTITY','contracted',true,10,'Dados do veículo e histórico de leilão (fonte contratada)')`);
        } else {
          await client.query(`UPDATE query_source_rules SET active=true WHERE product_id='AUCTION'`);
        }
        // Modelo de campos publicado: o relatório de leilão mostra só a identificação, as características e o que vem da consulta de leilão
        // (sem sinistro, roubo/furto ou recall, que esta consulta não compra).
        const existente = await client.query(`SELECT 1 FROM report_templates WHERE product_id='AUCTION' AND config->>'model'='CATALOG_V1'`);
        if (!existente.rowCount) {
          const campos = (section: string, tier: number) => FIELD_CATALOG.filter((f) => f.section === section && f.tier <= tier && f.sensitivity === 'PUBLIC').map((f) => ({ key: f.key, visible: true }));
          const config = {
            model: 'CATALOG_V1',
            sections: [
              { key: 'IDENTIFICACAO', order: 10, visible: true, fields: campos('IDENTIFICACAO', 2) },
              { key: 'CARACTERISTICAS', order: 20, visible: true, fields: campos('CARACTERISTICAS', 2) },
              { key: 'HISTORICO', order: 55, visible: true, fields: ['VT_LEILAO', 'VT_LEILAO_DETALHES', 'AU_LEILAO', 'AU_LEILAO_DETALHES'].map((key) => ({ key, visible: true })) }
            ]
          };
          const versao = Number((await client.query(`SELECT COALESCE(MAX(version),0)+1 AS v FROM report_templates WHERE product_id='AUCTION'`)).rows[0].v);
          const tpl = await client.query(`INSERT INTO report_templates(product_id,version,name,status,config) VALUES('AUCTION',$1,'Consulta Leilão — dados do veículo e leilão','DRAFT',$2::jsonb) RETURNING id`, [versao, JSON.stringify(config)]);
          const id = String(tpl.rows[0].id);
          await client.query(`UPDATE report_template_publications SET superseded_at=now() WHERE product_id='AUCTION' AND superseded_at IS NULL`);
          await client.query(`UPDATE report_templates SET status='DRAFT' WHERE product_id='AUCTION' AND status='PUBLISHED'`);
          await client.query(`UPDATE report_templates SET status='PUBLISHED' WHERE id=$1`, [id]);
          await client.query(`INSERT INTO report_template_publications(product_id,template_id) VALUES('AUCTION',$1)`, [id]);
          await client.query(`INSERT INTO product_report_configs(product_id,template_id,mode,formats) VALUES('AUCTION',$1,'SNAPSHOT',ARRAY['JSON','HTML','PDF']) ON CONFLICT(product_id) DO UPDATE SET template_id=EXCLUDED.template_id, updated_at=now()`, [id]);
        }
        for (const key of ['leilao', 'dados-veiculo']) {
          await client.query(`INSERT INTO product_catalog_features(product_id,feature_id,status) SELECT 'AUCTION',id,'INCLUDED' FROM catalog_features WHERE key=$1 ON CONFLICT (product_id,feature_id) DO UPDATE SET status='INCLUDED'`, [key]);
        }
        await client.query(`UPDATE catalog_features SET description='Passagem por leilão, com data, leiloeiro, lote e condição quando houver.' WHERE key='leilao' AND description='Passagem por leilão. Disponível assim que a fonte for ativada.'`);
        await client.query(
          `UPDATE faqs SET answer='Sim. A consulta de leilão está ativa e a passagem por leilão também vem dentro das consultas Completa e Premium. Nada é cobrado por informação que não possa ser entregue.', updated_at=now()
            WHERE question='A consulta de leilão já está disponível?' AND answer LIKE 'Sim. A passagem por leilão já vem dentro das consultas Completa e Premium.%'`
        );
      }
    },
    down: async (client) => {
      await client.query(`UPDATE query_products SET data_sources=NULL, report_sections=array_remove(report_sections,'GRAVAME'), updated_at=now() WHERE id='BASIC' AND data_sources=ARRAY['GRAVAME']::text[]`);
      await client.query(`UPDATE query_products SET commercial_status='SOON', updated_at=now() WHERE id='AUCTION' AND commercial_status='ACTIVE'`);
      // O modelo publicado fica no histórico (consultas já feitas apontam para ele); só deixa de valer.
      const nome = 'Consulta Leilão — dados do veículo e leilão';
      await client.query(`UPDATE report_template_publications SET superseded_at=now() WHERE product_id='AUCTION' AND superseded_at IS NULL AND template_id IN (SELECT id FROM report_templates WHERE product_id='AUCTION' AND name=$1)`, [nome]);
      await client.query(`UPDATE report_templates SET status='DRAFT' WHERE product_id='AUCTION' AND name=$1`, [nome]);
      await client.query(`UPDATE report_templates SET status='PUBLISHED' WHERE id=(SELECT id FROM report_templates WHERE product_id='AUCTION' AND name<>$1 ORDER BY version LIMIT 1)`, [nome]);
      await client.query(`UPDATE product_report_configs SET template_id=(SELECT id FROM report_templates WHERE product_id='AUCTION' AND name<>$1 ORDER BY version LIMIT 1), updated_at=now() WHERE product_id='AUCTION' AND template_id IN (SELECT id FROM report_templates WHERE product_id='AUCTION' AND name=$1) AND EXISTS (SELECT 1 FROM report_templates WHERE product_id='AUCTION' AND name<>$1)`, [nome]);
    }
  }
  ,{
    id: '070_convites_de_parceiro',
    name: 'Convites de parceiro: link de cadastro enviado pelo painel, com comissão pré-definida, validade e uso único',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS partner_invites (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          token text NOT NULL UNIQUE,
          name text,
          email text,
          code text,
          partner_type text NOT NULL DEFAULT 'AFFILIATE' CHECK (partner_type IN ('AFFILIATE','INFLUENCER','SELLER','ORGANIZATION')),
          commission_bps integer NOT NULL DEFAULT 1000 CHECK (commission_bps >= 0 AND commission_bps <= 5000),
          commission_base text CHECK (commission_base IS NULL OR commission_base IN ('GROSS','NET','MARGIN')),
          note text,
          expires_at timestamptz NOT NULL,
          created_by uuid REFERENCES users(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          used_at timestamptz,
          used_by uuid REFERENCES users(id) ON DELETE SET NULL,
          affiliate_id uuid REFERENCES affiliates(id) ON DELETE SET NULL,
          revoked_at timestamptz
        );
        CREATE INDEX IF NOT EXISTS idx_partner_invites_created ON partner_invites(created_at DESC);
      `);
    },
    down: async (client) => {
      await client.query(`DROP TABLE IF EXISTS partner_invites`);
    }
  }

  ,{
    id: '071_custos_por_consulta',
    name: 'Custo de cada consulta na Credify (tabela do contrato) e preço mínimo calculado com as taxas e impostos configurados. Só preenche o que está vazio; não mexe em preço de venda',
    up: async (client) => {
      // Custo unitário (centavos) = soma das chamadas pagas que cada consulta faz em condição normal.
      //   Cadastral  = base 487 (2,15)
      //   Financ.    = base + gravame 533 (1,37)
      //   Básica     = base + gravame (o gravame só é comprado quando o cadastro indica alienação; aqui o pior caso)
      //   Leilão     = base + leilão conjugado 448 (16,76)
      //   Completa   = base + sinistro 450 (1,33) + nacional 369 (1,17) + leilão (16,76) + FIPE 454 (0,11)
      //   Premium    = Completa + gravame (1,37) + RENAJUD (1,60) + proprietários 458 (8,00) + Renainf 536 (0,64)
      // Roubo/furto (7,31) e recall (1,97) só são comprados quando a base não traz o sinal limpo; ficam FORA do custo normal
      // e são tratados como reserva no controle financeiro (docs/SISTEMA.md).
      const custos: Array<[string, number]> = [['CADASTRAL', 215], ['LIEN', 352], ['BASIC', 352], ['AUCTION', 1891], ['COMPLETE', 2152], ['PREMIUM', 3313]];
      const preenchidos: string[] = [];
      for (const [id, custo] of custos) {
        const u = await client.query(`UPDATE query_products SET provider_cost_cents=$2, updated_at=now() WHERE id=$1 AND COALESCE(provider_cost_cents,0)=0 RETURNING id`, [id, custo]);
        if (u.rowCount) preenchidos.push(id);
      }
      const cfg = await client.query('SELECT 1 FROM payment_settings WHERE id=1');
      if (!cfg.rowCount) return;
      const settings = await loadPaymentSettings(client);
      const rows = await client.query(`SELECT id,name,price_cents,provider_cost_cents,supplier_cost_cents FROM query_products WHERE id = ANY($1::text[]) AND (floor_price_cents IS NULL OR id = ANY($2::text[])) AND COALESCE(provider_cost_cents,0) > 0`, [custos.map(([id]) => id), preenchidos]);
      for (const r of rows.rows) {
        const { floorCents } = floorPriceFor(settings, { id: String(r.id), name: String(r.name), providerCostCents: Number(r.provider_cost_cents), supplierCostCents: Number(r.supplier_cost_cents ?? 0) });
        // Piso acima do preço de venda atual não é gravado: bloquearia o salvamento no painel. O alerta aparece em Financeiro → Produtos.
        // Piso antigo de produto cujo custo acabou de ser preenchido vinha de outro custo: é substituído (ou limpo, se passar do preço).
        await client.query(`UPDATE query_products SET floor_price_cents=$2 WHERE id=$1`, [r.id, floorCents > 0 && floorCents <= Number(r.price_cents) ? floorCents : null]);
      }
    },
    down: async (client) => {
      const custos: Array<[string, number]> = [['CADASTRAL', 215], ['LIEN', 352], ['BASIC', 352], ['AUCTION', 1891], ['COMPLETE', 2152], ['PREMIUM', 3313]];
      for (const [id, custo] of custos) {
        await client.query(`UPDATE query_products SET provider_cost_cents=NULL, floor_price_cents=NULL WHERE id=$1 AND provider_cost_cents=$2`, [id, custo]);
      }
    }
  }

  ,{
    id: '072_guia_mais_veiculos',
    name: 'Guia de veículos: mais marcas, modelos e versões para consulta e comparação (ficha técnica com fonte). Não altera o que a equipe já cadastrou ou editou',
    up: async (client) => {
      for (const model of EXTRA_VEHICLE_SEED) {
        const inserted = await client.query(
          `INSERT INTO vehicle_models(slug,brand,name,vehicle_type,body_type,year_from,summary,status,spec_source)
           VALUES($1,$2,$3,$4,$5,$6,$7,'PUBLISHED',$8) ON CONFLICT (slug) DO NOTHING RETURNING id`,
          [model.slug, model.brand, model.name, model.vehicleType, model.bodyType, model.yearFrom ?? null, `${model.brand} ${model.name}: ficha técnica de referência, sem opiniões ainda. Seja o primeiro a avaliar.`, EXTRA_SEED_SOURCE]
        );
        const modelId = inserted.rows[0]?.id as string | undefined;
        if (!modelId) continue;
        let order = 0;
        for (const v of model.versions) {
          await client.query(
            `INSERT INTO vehicle_versions(model_id,name,year_model,fuel,specs,display_order) VALUES($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT DO NOTHING`,
            [modelId, v.name, v.yearModel, v.fuel, JSON.stringify(v.specs), order++]
          );
        }
      }
      // Liga os novos modelos à frota publicada (Senatran) pelo nome, como na carga anterior.
      await rematchCatalog(client);
    },
    down: async (client) => {
      // Remove só os modelos desta carga que ainda não receberam opinião, dica ou observação de consumo.
      await client.query(
        `DELETE FROM vehicle_models m WHERE m.slug = ANY($1::text[]) AND m.spec_source=$2
           AND NOT EXISTS (SELECT 1 FROM vehicle_opinions o WHERE o.model_id=m.id)
           AND NOT EXISTS (SELECT 1 FROM vehicle_tips t WHERE t.model_id=m.id)
           AND NOT EXISTS (SELECT 1 FROM vehicle_consumption_obs c WHERE c.model_id=m.id)`,
        [EXTRA_VEHICLE_SEED.map((x) => x.slug), EXTRA_SEED_SOURCE]
      );
    }
  }

  ,{
    id: '073_convite_por_usuario',
    name: 'Convite por usuário: cada pessoa (cliente, operador ou administrador) tem o seu código e link; fica gravado quem convidou quem, por qual caminho e quando',
    up: async (client) => {
      await client.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_code text;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES users(id) ON DELETE SET NULL;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_at timestamptz;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_via text;
        CREATE UNIQUE INDEX IF NOT EXISTS uq_users_invite_code ON users(invite_code) WHERE invite_code IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_users_invited_by ON users(invited_by, invited_at DESC) WHERE invited_by IS NOT NULL;
        CREATE TABLE IF NOT EXISTS invite_events (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          inviter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          kind text NOT NULL CHECK (kind IN ('CLICK','SIGNUP')),
          via text NOT NULL DEFAULT 'LINK' CHECK (via IN ('LINK','REPORT')),
          invitee_id uuid REFERENCES users(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_invite_events_inviter ON invite_events(inviter_id, kind, created_at DESC);
      `);
    },
    down: async (client) => {
      await client.query(`
        DROP TABLE IF EXISTS invite_events;
        DROP INDEX IF EXISTS idx_users_invited_by;
        DROP INDEX IF EXISTS uq_users_invite_code;
        ALTER TABLE users DROP COLUMN IF EXISTS invited_via;
        ALTER TABLE users DROP COLUMN IF EXISTS invited_at;
        ALTER TABLE users DROP COLUMN IF EXISTS invited_by;
        ALTER TABLE users DROP COLUMN IF EXISTS invite_code;
      `);
    }
  }

  ,{
    id: '074_escada_essencial_e_leilao_com_dados',
    name: 'Escada de consultas: Básica vira Segura (cadastro, débitos, restrições, sinistro e leilão) e Leilão vira Leilão e Dados do Veículo, ambas com nível de risco de leilão e aceitação em seguro; Completa e Premium ganham a matriz nova. Só muda onde ainda está como antes',
    up: async (client) => {
      await client.query(`CREATE TABLE IF NOT EXISTS migration_074_prev (product_id text PRIMARY KEY, data jsonb NOT NULL)`);
      const novosCampos = ['AN_SCORE_LEILAO', 'AN_DESVALORIZACAO', 'AN_CSV_INMETRO', 'AN_SEGURO'];
      const leilaoCampos = ['VT_LEILAO', 'VT_LEILAO_DETALHES', 'AU_LEILAO', 'AU_LEILAO_DETALHES'];
      // Campos públicos de uma seção: catálogo base (nível 1 e 2) e, quando o produto compra a base nacional, os da base nacional.
      const campos = (section: string, nacional: boolean) => [
        ...FIELD_CATALOG.filter((f) => f.section === section && f.tier <= 2 && f.sensitivity === 'PUBLIC').map((f) => f.key),
        ...(nacional ? VT_CATALOG.filter((f) => f.section === section && /^(VN_|AL_)/.test(f.key) && f.sensitivity === 'PUBLIC').map((f) => f.key) : [])
      ];
      const publicarModelo = async (productId: string, nome: string, secoes: Array<{ key: string; order: number; fields: string[] }>) => {
        const config = { model: 'CATALOG_V1', sections: secoes.filter((s) => s.fields.length).map((s) => ({ key: s.key, order: s.order, visible: true, fields: s.fields.map((key) => ({ key, visible: true })) })) };
        const versao = Number((await client.query(`SELECT COALESCE(MAX(version),0)+1 AS v FROM report_templates WHERE product_id=$1`, [productId])).rows[0].v);
        const tpl = await client.query(`INSERT INTO report_templates(product_id,version,name,status,config) VALUES($1,$2,$3,'DRAFT',$4::jsonb) RETURNING id`, [productId, versao, nome, JSON.stringify(config)]);
        const id = String(tpl.rows[0].id);
        await client.query(`UPDATE report_template_publications SET superseded_at=now() WHERE product_id=$1 AND superseded_at IS NULL`, [productId]);
        await client.query(`UPDATE report_templates SET status='DRAFT' WHERE product_id=$1 AND status='PUBLISHED'`, [productId]);
        await client.query(`UPDATE report_templates SET status='PUBLISHED' WHERE id=$1`, [id]);
        await client.query(`INSERT INTO report_template_publications(product_id,template_id) VALUES($1,$2)`, [productId, id]);
        await client.query(`INSERT INTO product_report_configs(product_id,template_id,mode,formats) VALUES($1,$2,'SNAPSHOT',ARRAY['JSON','HTML','PDF']) ON CONFLICT(product_id) DO UPDATE SET template_id=EXCLUDED.template_id, updated_at=now()`, [productId, id]);
      };
      const guardar = async (id: string) => {
        await client.query(
          `INSERT INTO migration_074_prev(product_id,data) SELECT id, to_jsonb(query_products.*) FROM query_products WHERE id=$1 ON CONFLICT (product_id) DO NOTHING`, [id]
        );
      };
      const definirPreco = async (id: string, novo: number, custo: number, motivo: string) => {
        const atual = await client.query(`SELECT price_cents FROM query_products WHERE id=$1`, [id]);
        if (!atual.rowCount) return;
        const antes = Number(atual.rows[0].price_cents);
        const r = await client.query(
          `UPDATE query_products SET price_cents=$2::int, provider_cost_cents=$3::int, pricing_mode='MANUAL', credit_cost=GREATEST(1, CEIL($2::numeric/100))::int,
              floor_price_cents=NULL, margin_locked=false,
              list_price_cents=CASE WHEN list_price_cents IS NOT NULL AND list_price_cents <= $2::int THEN NULL ELSE list_price_cents END,
              price_version=price_version+CASE WHEN price_cents<>$2::int THEN 1 ELSE 0 END,
              price_updated_at=CASE WHEN price_cents<>$2::int THEN now() ELSE price_updated_at END, updated_at=now()
            WHERE id=$1 RETURNING price_version, name, supplier_cost_cents`,
          [id, novo, custo]
        );
        // Piso calculado com as taxas e impostos configurados; só é gravado quando cabe no preço (senão o painel bloquearia o salvamento).
        let piso: number | null = null;
        const cfg = await client.query('SELECT 1 FROM payment_settings WHERE id=1');
        if (cfg.rowCount) {
          const settings = await loadPaymentSettings(client);
          const { floorCents } = floorPriceFor(settings, { id, name: String(r.rows[0].name), providerCostCents: custo, supplierCostCents: Number(r.rows[0].supplier_cost_cents ?? 0) });
          piso = floorCents > 0 && floorCents <= novo ? floorCents : null;
          await client.query(`UPDATE query_products SET floor_price_cents=$2 WHERE id=$1`, [id, piso]);
        }
        if (antes !== novo) {
          await client.query(`INSERT INTO product_price_history(product_id,version,old_price_cents,new_price_cents,reference_price_cents,floor_price_cents,provider_cost_cents,margin_locked,reason) VALUES($1,$2,$3,$4,NULL,$5,$6,false,$7)`, [id, r.rows[0].price_version, antes, novo, piso, custo, motivo]);
        }
      };
      const recurso = async (key: string, label: string, description: string, order: number) => {
        await client.query(`INSERT INTO catalog_features(key,label,description,display_order) VALUES($1,$2,$3,$4) ON CONFLICT (key) DO NOTHING`, [key, label, description, order]);
      };
      const matriz = async (productId: string, key: string, status: string) => {
        await client.query(`INSERT INTO product_catalog_features(product_id,feature_id,status) SELECT $1,id,$3 FROM catalog_features WHERE key=$2 ON CONFLICT (product_id,feature_id) DO UPDATE SET status=EXCLUDED.status`, [productId, key, status]);
      };
      await recurso('score-leilao', 'Nível de risco de leilão e desvalorização', 'Classificação do risco de leilão (Muito baixo, Baixo, Razoável ou Alto), possível desvalorização e CSV do Inmetro, calculados com os dados da consulta.', 82);
      await recurso('seguro-revenda', 'Aceitação em seguro e risco de revenda', 'Parecer sobre recusa de seguradoras e dificuldade de revenda a partir do histórico encontrado.', 84);
      const pdf = 'Relatório em PDF com código de validação';

      // ── Básica → Segura (o essencial para comprar com segurança)
      const segura = await client.query(`SELECT id FROM query_products WHERE id='BASIC' AND name='Consulta Básica'`);
      if (segura.rowCount) {
        await guardar('BASIC');
        const features = ['Dados cadastrais do estado e da base nacional', 'Débitos, multas e restrições', 'Indício de sinistro (batidas)', 'Passagem por leilão: data, leiloeiro, lote e condição', 'Nível de risco de leilão e possível desvalorização', 'Aceitação em seguro e risco de revenda', pdf];
        await client.query(
          `UPDATE query_products SET name='Consulta Segura', tagline='Cadastro, débitos, restrições, sinistro e leilão.', description='Dados do veículo, débitos, multas, restrições, indício de sinistro e passagem por leilão, com nível de risco e aceitação em seguro.',
              coverage='Cadastro, débitos, restrições, sinistro e leilão', badge='Essencial', features=$1::jsonb,
              long_description='O essencial para comprar com segurança: confere o cadastro nas bases do estado e nacional, débitos, multas e restrições, e mostra se o veículo tem indício de sinistro ou passagem por leilão. O relatório traz o nível de risco de leilão, a possível desvalorização e se pode haver recusa de seguro, tudo calculado só com o que a consulta encontrou.',
              data_sources=ARRAY['SINISTRO','NATIONAL','AUCTION']::text[],
              report_sections=ARRAY['IDENTIFICACAO','CARACTERISTICAS','REGISTRO','DEBITOS','RESTRICOES','GRAVAME','HISTORICO','ANALISES']::text[], updated_at=now()
            WHERE id='BASIC'`, [JSON.stringify(features)]
        );
        await publicarModelo('BASIC', 'Consulta Segura — cadastro, débitos, restrições, sinistro e leilão', [
          { key: 'IDENTIFICACAO', order: 10, fields: campos('IDENTIFICACAO', true) },
          { key: 'CARACTERISTICAS', order: 20, fields: campos('CARACTERISTICAS', true) },
          { key: 'REGISTRO', order: 30, fields: campos('REGISTRO', true) },
          { key: 'DEBITOS', order: 40, fields: campos('DEBITOS', false) },
          { key: 'RESTRICOES', order: 50, fields: campos('RESTRICOES', true) },
          { key: 'GRAVAME', order: 60, fields: [...campos('GRAVAME', false), 'GR_SITUACAO'] },
          { key: 'HISTORICO', order: 55, fields: ['VT_SINISTRO', ...leilaoCampos] },
          { key: 'ANALISES', order: 76, fields: novosCampos }
        ]);
        await definirPreco('BASIC', 3290, 2141, 'Consulta Segura (padrão Essencial do mercado): R$ 32,90');
        for (const [key, status] of [['leilao', 'INCLUDED'], ['historico-ocorrencias', 'INCLUDED'], ['score-leilao', 'INCLUDED'], ['seguro-revenda', 'INCLUDED'], ['gravame-detalhado', 'NOT_INCLUDED']] as const) await matriz('BASIC', key, status);
      }

      // ── Leilão → Leilão e Dados do Veículo
      const leilao = await client.query(`SELECT id FROM query_products WHERE id='AUCTION' AND name='Consulta Leilão'`);
      if (leilao.rowCount) {
        await guardar('AUCTION');
        const features = ['Dados do veículo e cadastro da base nacional', 'Restrições', 'Passagem por leilão: data, leiloeiro, lote e condição', 'Nível de risco de leilão', 'Possível desvalorização e CSV do Inmetro', 'Aceitação em seguro e risco de revenda', pdf];
        await client.query(
          `UPDATE query_products SET name='Leilão e Dados do Veículo', tagline='Leilão, nível de risco e dados do veículo.', description='Passagem por leilão com nível de risco, possível desvalorização e aceitação em seguro, mais os dados do veículo e as restrições.',
              coverage='Dados do veículo, restrições e leilão', features=$1::jsonb,
              long_description='Saiba se o veículo passou por leilão e o quanto isso pesa. O relatório traz cada registro de leilão (data, leiloeiro, lote e condição), o nível de risco de leilão, a possível desvalorização, o CSV do Inmetro e se pode haver recusa de seguro, junto com os dados do veículo da base do estado e da base nacional e as restrições.',
              data_sources=ARRAY['NATIONAL','AUCTION']::text[],
              report_sections=ARRAY['IDENTIFICACAO','CARACTERISTICAS','REGISTRO','RESTRICOES','HISTORICO','ANALISES']::text[], updated_at=now()
            WHERE id='AUCTION'`, [JSON.stringify(features)]
        );
        await publicarModelo('AUCTION', 'Leilão e Dados do Veículo — leilão, análises e cadastro', [
          { key: 'IDENTIFICACAO', order: 10, fields: campos('IDENTIFICACAO', true) },
          { key: 'CARACTERISTICAS', order: 20, fields: campos('CARACTERISTICAS', true) },
          { key: 'REGISTRO', order: 30, fields: campos('REGISTRO', true) },
          { key: 'RESTRICOES', order: 50, fields: campos('RESTRICOES', true) },
          { key: 'HISTORICO', order: 55, fields: leilaoCampos },
          { key: 'ANALISES', order: 76, fields: novosCampos }
        ]);
        await definirPreco('AUCTION', 2990, 2008, 'Leilão e Dados do Veículo: R$ 29,90 (cadastro nacional entra no custo)');
        for (const [key, status] of [['registro', 'INCLUDED'], ['restricoes', 'INCLUDED'], ['score-leilao', 'INCLUDED'], ['seguro-revenda', 'INCLUDED']] as const) await matriz('AUCTION', key, status);
      }

      // ── Completa e Premium já calculam as análises (seção de análises); só a matriz de comparação passa a mostrar.
      for (const id of ['COMPLETE', 'PREMIUM']) for (const key of ['score-leilao', 'seguro-revenda']) await matriz(id, key, 'INCLUDED');

      await client.query(
        `UPDATE faqs SET answer='Para conferir se o veículo é o que o anúncio diz, a Cadastral resolve. Para comprar com segurança, a Segura soma débitos, multas, restrições, sinistro e leilão. Se você quer o histórico de leilão em detalhe, a Leilão e Dados do Veículo mostra o nível de risco e a possível desvalorização. A Completa acrescenta roubo e furto, recall, FIPE e a comparação de características entre as bases, e a Premium traz também proprietários, gravame detalhado e restrições judiciais. Na página de planos há um comparador que monta a combinação mais barata para o que você precisa.', updated_at=now()
          WHERE question='Qual consulta devo escolher?' AND answer LIKE 'Para conferir se o veículo é o que o anúncio diz, a Cadastral resolve. Se você vai comprar, a Completa reúne%'`
      );
    },
    down: async (client) => {
      const prev = await client.query(`SELECT to_regclass('migration_074_prev') AS t`);
      if (!prev.rows[0].t) return;
      for (const id of ['BASIC', 'AUCTION']) {
        const r = await client.query(`SELECT data FROM migration_074_prev WHERE product_id=$1`, [id]);
        if (!r.rowCount) continue;
        const d = r.rows[0].data as Record<string, unknown>;
        await client.query(
          `UPDATE query_products SET name=$2, tagline=$3, description=$4, coverage=$5, badge=$6, features=$7::jsonb, long_description=$8, data_sources=$9::text[], report_sections=$10::text[],
              price_cents=$11, provider_cost_cents=$12, floor_price_cents=$13, credit_cost=$14, updated_at=now() WHERE id=$1`,
          [id, d.name, d.tagline, d.description, d.coverage, d.badge, JSON.stringify(d.features ?? []), d.long_description, d.data_sources ?? null, d.report_sections ?? null, d.price_cents, d.provider_cost_cents ?? null, d.floor_price_cents ?? null, d.credit_cost]
        );
        // O modelo novo fica no histórico (consultas já feitas apontam para ele); só deixa de valer e volta o anterior.
        await client.query(`UPDATE report_template_publications SET superseded_at=now() WHERE product_id=$1 AND superseded_at IS NULL AND template_id IN (SELECT id FROM report_templates WHERE product_id=$1 AND name IN ('Consulta Segura — cadastro, débitos, restrições, sinistro e leilão','Leilão e Dados do Veículo — leilão, análises e cadastro'))`, [id]);
        await client.query(`UPDATE report_templates SET status='DRAFT' WHERE product_id=$1 AND name IN ('Consulta Segura — cadastro, débitos, restrições, sinistro e leilão','Leilão e Dados do Veículo — leilão, análises e cadastro')`, [id]);
        const anterior = await client.query(`SELECT id FROM report_templates WHERE product_id=$1 AND name NOT IN ('Consulta Segura — cadastro, débitos, restrições, sinistro e leilão','Leilão e Dados do Veículo — leilão, análises e cadastro') AND NOT EXISTS (SELECT 1 FROM report_template_publications p WHERE p.template_id=report_templates.id) ORDER BY version DESC LIMIT 1`, [id]);
        const alvo = anterior.rowCount ? anterior : await client.query(`SELECT id FROM report_templates WHERE product_id=$1 AND name NOT IN ('Consulta Segura — cadastro, débitos, restrições, sinistro e leilão','Leilão e Dados do Veículo — leilão, análises e cadastro') ORDER BY version DESC LIMIT 1`, [id]);
        if (alvo.rowCount) {
          await client.query(`UPDATE report_templates SET status='PUBLISHED' WHERE id=$1`, [alvo.rows[0].id]);
          await client.query(`INSERT INTO report_template_publications(product_id,template_id) VALUES($1,$2)`, [id, alvo.rows[0].id]);
          await client.query(`UPDATE product_report_configs SET template_id=$2, updated_at=now() WHERE product_id=$1`, [id, alvo.rows[0].id]);
        }
      }
      await client.query(`DELETE FROM product_catalog_features WHERE feature_id IN (SELECT id FROM catalog_features WHERE key IN ('score-leilao','seguro-revenda'))`);
      await client.query(`DELETE FROM catalog_features WHERE key IN ('score-leilao','seguro-revenda')`);
      await client.query(`UPDATE product_catalog_features SET status='INCLUDED' WHERE product_id='BASIC' AND feature_id=(SELECT id FROM catalog_features WHERE key='gravame-detalhado')`);
      await client.query(`DELETE FROM product_catalog_features WHERE product_id='BASIC' AND feature_id IN (SELECT id FROM catalog_features WHERE key IN ('leilao','historico-ocorrencias'))`);
      await client.query(`DELETE FROM product_catalog_features WHERE product_id='AUCTION' AND feature_id IN (SELECT id FROM catalog_features WHERE key IN ('registro','restricoes'))`);
      await client.query(`DROP TABLE IF EXISTS migration_074_prev`);
    }
  }

  ,{
    id: '075_consulta_avancada_acima_da_completa',
    name: 'A consulta que era Segura vira Avançada: tudo da Completa mais gravame detalhado, restrições judiciais e multas por infração (Premium sem proprietários), com preço acima da Completa e abaixo do teto de mercado. Só muda onde ainda está como a 074 deixou',
    up: async (client) => {
      const atual = await client.query(`SELECT price_cents FROM query_products WHERE id='BASIC' AND name='Consulta Segura' AND price_cents=3290`);
      if (!atual.rowCount) return;
      await client.query(`CREATE TABLE IF NOT EXISTS migration_075_prev (product_id text PRIMARY KEY, data jsonb NOT NULL)`);
      await client.query(`INSERT INTO migration_075_prev(product_id,data) SELECT id, to_jsonb(query_products.*) FROM query_products WHERE id='BASIC' ON CONFLICT (product_id) DO NOTHING`);
      const pdf = 'Relatório em PDF com código de validação';
      const features = [
        'Tudo da Completa: sinistro, roubo e furto, leilão, recall, FIPE e comparação entre bases',
        'Gravame detalhado: banco, contrato e datas do financiamento',
        'Restrições judiciais detalhadas (Renajud): tribunal, processo e data',
        'Multas detalhadas por infração: descrição, vencimento e valor',
        'Nível de risco de leilão, possível desvalorização e CSV do Inmetro',
        'Aceitação em seguro e risco de revenda',
        pdf
      ];
      await client.query(
        `UPDATE query_products SET name='Consulta Avançada', tagline='Tudo da Completa, com gravame, Renajud e multas detalhadas.',
            description='A Completa mais o gravame detalhado, as restrições judiciais (Renajud) e as multas por infração, com nível de risco de leilão e aceitação em seguro.',
            coverage='Completa, gravame, Renajud e multas detalhadas', badge=NULL, features=$1::jsonb, display_order=9, featured=false,
            long_description='Para quem vai fechar um negócio de valor mais alto. Reúne tudo da Completa (débitos, restrições, sinistro, roubo e furto, leilão, recall e FIPE) e acrescenta o financiamento em detalhe (banco, contrato e datas), as restrições judiciais com tribunal e processo e cada multa por infração. O relatório mostra o nível de risco de leilão, a possível desvalorização e se pode haver recusa de seguro. Não inclui o histórico de proprietários, que fica na Premium.',
            data_sources=ARRAY['SINISTRO','NATIONAL','THEFT','RECALL','AUCTION','GRAVAME','RENAJUD','FIPE','RENAINF']::text[],
            report_sections=ARRAY['IDENTIFICACAO','CARACTERISTICAS','REGISTRO','DEBITOS','RESTRICOES','HISTORICO','GRAVAME','INSPECAO_RECALL','FIPE','ANALISES']::text[], updated_at=now()
          WHERE id='BASIC'`, [JSON.stringify(features)]
      );
      // Mesmo escopo de seções da Completa/Premium (sem proprietários): o modelo de campos da 074 deixa de valer.
      await client.query(`UPDATE report_template_publications SET superseded_at=now() WHERE product_id='BASIC' AND superseded_at IS NULL AND template_id IN (SELECT id FROM report_templates WHERE product_id='BASIC' AND name='Consulta Segura — cadastro, débitos, restrições, sinistro e leilão')`);
      await client.query(`UPDATE report_templates SET status='DRAFT' WHERE product_id='BASIC' AND name='Consulta Segura — cadastro, débitos, restrições, sinistro e leilão'`);

      // Custo normal: base 2,15 + sinistro 1,33 + nacional 1,17 + leilão 16,76 + FIPE 0,11 + gravame 1,37 + Renajud 1,60 + Renainf 0,64 = 25,13.
      // Roubo/furto (7,31) e recall (1,97) só são comprados quando a base não traz o sinal limpo (reserva, como na Completa).
      const custo = 2513; const novo = 4190;
      const ant = Number((await client.query(`SELECT price_cents FROM query_products WHERE id='BASIC'`)).rows[0].price_cents);
      const r = await client.query(
        `UPDATE query_products SET price_cents=$1::int, provider_cost_cents=$2::int, pricing_mode='MANUAL', credit_cost=GREATEST(1, CEIL($1::numeric/100))::int, floor_price_cents=NULL, margin_locked=false,
            price_version=price_version+1, price_updated_at=now(), updated_at=now() WHERE id='BASIC' RETURNING price_version, name, supplier_cost_cents`, [novo, custo]
      );
      let piso: number | null = null;
      if ((await client.query('SELECT 1 FROM payment_settings WHERE id=1')).rowCount) {
        const settings = await loadPaymentSettings(client);
        const { floorCents } = floorPriceFor(settings, { id: 'BASIC', name: String(r.rows[0].name), providerCostCents: custo, supplierCostCents: Number(r.rows[0].supplier_cost_cents ?? 0) });
        piso = floorCents > 0 && floorCents <= novo ? floorCents : null;
        await client.query(`UPDATE query_products SET floor_price_cents=$1 WHERE id='BASIC'`, [piso]);
      }
      await client.query(`INSERT INTO product_price_history(product_id,version,old_price_cents,new_price_cents,reference_price_cents,floor_price_cents,provider_cost_cents,margin_locked,reason) VALUES('BASIC',$1,$2,$3,NULL,$4,$5,false,'Consulta Avançada (acima da Completa e abaixo do teto de mercado): R$ 41,90')`, [r.rows[0].price_version, ant, novo, piso, custo]);

      // Matriz de comparação: o que a Premium tem, menos proprietários.
      await client.query(
        `INSERT INTO product_catalog_features(product_id,feature_id,status)
           SELECT 'BASIC', feature_id, CASE WHEN feature_id=(SELECT id FROM catalog_features WHERE key='proprietarios') THEN 'NOT_INCLUDED' ELSE status END
             FROM product_catalog_features WHERE product_id='PREMIUM'
         ON CONFLICT (product_id,feature_id) DO UPDATE SET status=EXCLUDED.status`
      );
      await client.query(
        `UPDATE faqs SET answer='Para conferir se o veículo é o que o anúncio diz, a Cadastral resolve. Se você quer saber do leilão e do cadastro, a Leilão e Dados do Veículo mostra o nível de risco e a possível desvalorização. A Completa reúne débitos, restrições, sinistro, roubo e furto, leilão, recall e FIPE. A Avançada soma a isso o gravame detalhado, o Renajud e as multas por infração, e a Premium traz também o histórico de proprietários. Na página de planos há um comparador que monta a combinação mais barata para o que você precisa.', updated_at=now()
          WHERE question='Qual consulta devo escolher?' AND answer LIKE 'Para conferir se o veículo é o que o anúncio diz, a Cadastral resolve. Para comprar com segurança, a Segura soma%'`
      );
    },
    down: async (client) => {
      if (!(await client.query(`SELECT to_regclass('migration_075_prev') AS t`)).rows[0].t) return;
      const r = await client.query(`SELECT data FROM migration_075_prev WHERE product_id='BASIC'`);
      if (r.rowCount) {
        const d = r.rows[0].data as Record<string, unknown>;
        await client.query(
          `UPDATE query_products SET name=$2, tagline=$3, description=$4, coverage=$5, badge=$6, features=$7::jsonb, long_description=$8, data_sources=$9::text[], report_sections=$10::text[],
              price_cents=$11, provider_cost_cents=$12, floor_price_cents=$13, credit_cost=$14, display_order=$15, featured=$16, updated_at=now() WHERE id=$1`,
          ['BASIC', d.name, d.tagline, d.description, d.coverage, d.badge, JSON.stringify(d.features ?? []), d.long_description, d.data_sources ?? null, d.report_sections ?? null, d.price_cents, d.provider_cost_cents ?? null, d.floor_price_cents ?? null, d.credit_cost, d.display_order, d.featured]
        );
        const nome = 'Consulta Segura — cadastro, débitos, restrições, sinistro e leilão';
        const tpl = await client.query(`SELECT id FROM report_templates WHERE product_id='BASIC' AND name=$1`, [nome]);
        if (tpl.rowCount) {
          await client.query(`UPDATE report_templates SET status='PUBLISHED' WHERE id=$1`, [tpl.rows[0].id]);
          await client.query(`INSERT INTO report_template_publications(product_id,template_id) VALUES('BASIC',$1)`, [tpl.rows[0].id]);
        }
        // Matriz: volta ao que a 074 deixou (só as linhas que ela criou ficam).
        await client.query(`DELETE FROM product_catalog_features WHERE product_id='BASIC' AND feature_id IN (SELECT id FROM catalog_features WHERE key IN ('renajud','alteracoes','multas-detalhadas','recall-inspecao','fipe','proprietarios'))`);
        await client.query(`UPDATE product_catalog_features SET status='NOT_INCLUDED' WHERE product_id='BASIC' AND feature_id=(SELECT id FROM catalog_features WHERE key='gravame-detalhado')`);
      }
      await client.query(`DROP TABLE IF EXISTS migration_075_prev`);
    }
  },
  {
    id: '076_crm_leads_e_links_de_consulta',
    name: 'CRM de leads do site, histórico de contatos e links de consulta enviados pelo painel',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS site_leads (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          name text,
          email text,
          phone text,
          kind text NOT NULL DEFAULT 'CLIENTE' CHECK (kind IN ('CLIENTE','LOJISTA')),
          stage text NOT NULL DEFAULT 'NOVO' CHECK (stage IN ('NOVO','CONTATADO','INTERESSADO','CADASTRADO','CLIENTE','PERDIDO')),
          source text NOT NULL DEFAULT 'SITE',
          interest text,
          utm jsonb NOT NULL DEFAULT '{}'::jsonb,
          session_key text,
          user_id uuid REFERENCES users(id) ON DELETE SET NULL,
          owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
          tags text[] NOT NULL DEFAULT '{}',
          notes text,
          marketing_consent boolean NOT NULL DEFAULT false,
          consent_at timestamptz,
          consent_text text,
          consent_ip_hash text,
          unsubscribed_at timestamptz,
          first_seen_at timestamptz NOT NULL DEFAULT now(),
          last_seen_at timestamptz NOT NULL DEFAULT now(),
          last_contact_at timestamptz,
          next_contact_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CHECK (email IS NOT NULL OR phone IS NOT NULL OR user_id IS NOT NULL)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uq_site_leads_email ON site_leads(lower(email)) WHERE email IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS uq_site_leads_user ON site_leads(user_id) WHERE user_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_site_leads_phone ON site_leads(phone) WHERE phone IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_site_leads_stage ON site_leads(stage, last_seen_at DESC);
        CREATE INDEX IF NOT EXISTS idx_site_leads_session ON site_leads(session_key) WHERE session_key IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_site_leads_followup ON site_leads(next_contact_at) WHERE next_contact_at IS NOT NULL AND stage NOT IN ('CLIENTE','PERDIDO');

        CREATE TABLE IF NOT EXISTS site_lead_events (
          id bigserial PRIMARY KEY,
          lead_id uuid NOT NULL REFERENCES site_leads(id) ON DELETE CASCADE,
          kind text NOT NULL,
          detail jsonb NOT NULL DEFAULT '{}'::jsonb,
          actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_site_lead_events ON site_lead_events(lead_id, id DESC);

        CREATE TABLE IF NOT EXISTS lead_links (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          code text NOT NULL UNIQUE,
          lead_id uuid REFERENCES site_leads(id) ON DELETE SET NULL,
          created_by uuid REFERENCES users(id) ON DELETE SET NULL,
          kind text NOT NULL DEFAULT 'CLIENTE' CHECK (kind IN ('CLIENTE','LOJISTA')),
          recipient_name text,
          product_id text,
          plate text,
          channel text NOT NULL DEFAULT 'COPIA' CHECK (channel IN ('COPIA','WHATSAPP','EMAIL')),
          expires_at timestamptz NOT NULL,
          revoked_at timestamptz,
          clicks integer NOT NULL DEFAULT 0,
          first_click_at timestamptz,
          last_click_at timestamptz,
          registered_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
          registered_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_lead_links_lead ON lead_links(lead_id);
        CREATE INDEX IF NOT EXISTS idx_lead_links_created ON lead_links(created_at DESC);
      `);
    },
    down: async (client) => {
      await client.query(`
        DROP TABLE IF EXISTS lead_links;
        DROP TABLE IF EXISTS site_lead_events;
        DROP TABLE IF EXISTS site_leads;
      `);
    }
  },
  {
    id: '077_chave_pix_do_cliente',
    name: 'Chave PIX do cliente (reembolso, cashback e comissão do Indique e Ganhe)',
    up: async (client) => {
      await client.query(`
        ALTER TABLE user_profiles
          ADD COLUMN IF NOT EXISTS pix_key text,
          ADD COLUMN IF NOT EXISTS pix_key_type text CHECK (pix_key_type IS NULL OR pix_key_type IN ('CPF','CNPJ','EMAIL','TELEFONE','ALEATORIA')),
          ADD COLUMN IF NOT EXISTS pix_key_updated_at timestamptz;
      `);
    },
    down: async (client) => {
      await client.query(`
        ALTER TABLE user_profiles
          DROP COLUMN IF EXISTS pix_key_updated_at,
          DROP COLUMN IF EXISTS pix_key_type,
          DROP COLUMN IF EXISTS pix_key;
      `);
    }
  }
  ,
  {
    id: '078_seo_leilao_faq_ativa',
    name: 'SEO: a pergunta sobre leilão na página de consulta deixa de dizer que a fonte ainda será ativada (só se o texto ainda for o de fábrica)',
    up: async (client) => {
      const antigo = 'Em algumas consultas a passagem por leilão aparece como indício. A consulta avulsa de leilão será liberada quando a fonte de dados for ativada.';
      const novo = 'Sim. A consulta Leilão e Dados do Veículo está ativa e mostra a passagem por leilão, com nível de risco quando a fonte informa. A passagem por leilão também vem dentro das consultas Completa e Premium. Nada é cobrado por informação que não possa ser entregue.';
      await client.query(
        `UPDATE seo_pages SET faq=(
           SELECT jsonb_agg(CASE WHEN e->>'q'='A consulta de leilão já está disponível?' AND e->>'a'=$1 THEN jsonb_set(e,'{a}',to_jsonb($2::text)) ELSE e END ORDER BY ord)
             FROM jsonb_array_elements(faq) WITH ORDINALITY AS t(e,ord)), updated_at=now()
          WHERE path='/consultar-leilao-veiculo'
            AND EXISTS (SELECT 1 FROM jsonb_array_elements(faq) AS x(e) WHERE x.e->>'q'='A consulta de leilão já está disponível?' AND x.e->>'a'=$1)`,
        [antigo, novo]
      );
    },
    down: async () => { /* só ajuste de texto; nada a desfazer */ }
  }
  ,
  {
    id: '079_seo_imagens',
    name: 'SEO: imagem de cada página (miniatura para Google, WhatsApp e redes), guardada no banco',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS seo_images (
          path text PRIMARY KEY,
          mime text NOT NULL CHECK (mime IN ('image/png','image/jpeg','image/webp')),
          size_bytes integer NOT NULL,
          width integer,
          height integer,
          sha256 text NOT NULL,
          data bytea NOT NULL,
          updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
      `);
    },
    down: async (client) => { await client.query('DROP TABLE IF EXISTS seo_images;'); }
  }
  ,
  {
    id: '080_seo_imagens_iniciais',
    name: 'SEO: imagem inicial das páginas Consulta veicular (Completa) e Gravame, sem sobrescrever o que a equipe já enviou',
    up: async (client) => {
      const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web');
      const inicial: Array<[string, string]> = [['/consulta-veicular', 'consulta-completa.jpg'], ['/consultar-gravame', 'consulta-gravame.jpg']];
      for (const [pagina, arquivo] of inicial) {
        const file = [path.join(dir, 'dist/brand/produtos', arquivo), path.join(dir, 'public/brand/produtos', arquivo)].find((f) => existsSync(f));
        if (!file) continue; // build do front ausente neste ambiente: a equipe envia pelo painel
        const data = readFileSync(file);
        const info = readImageInfo(data);
        if (!info) continue;
        await client.query(
          `INSERT INTO seo_images(path,mime,size_bytes,width,height,sha256,data) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (path) DO NOTHING`,
          [pagina, info.mime, data.length, info.width, info.height, createHash('sha256').update(data).digest('hex'), data]);
      }
    },
    down: async (client) => { await client.query(`DELETE FROM seo_images WHERE path IN ('/consulta-veicular','/consultar-gravame') AND updated_by IS NULL`); }
  }
  ,
  {
    id: '081_seo_capas_das_paginas',
    name: 'SEO: capas 1200×630 (WebP) de 29 páginas; troca só imagem que veio de fábrica, nunca a enviada pela equipe',
    up: async (client) => {
      const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web');
      const paginas = ['/', '/fipe', '/consulta-placa', '/consulta-veicular', '/consultar-gravame', '/consultar-sinistro-veiculo', '/consultar-leilao-veiculo', '/consultar-debitos-veiculo', '/consultar-multas-veiculo', '/consultar-recall', '/historico-veicular', '/planos', '/para-lojistas', '/para-concessionarias', '/sobre', '/instalar', '/contato', '/veiculos', '/veiculos/mais-economicos', '/combustivel', '/simulador', '/simulador/carro', '/simulador/moto', '/simulador/caminhao', '/simulador/utilitario', '/comparar', '/blog', '/termos', '/privacidade'];
      for (const pagina of paginas) {
        const nome = (pagina === '/' ? 'inicio' : pagina.replace(/^\//, '').replace(/\//g, '-')) + '.webp';
        const file = [path.join(dir, 'dist/brand/capas', nome), path.join(dir, 'public/brand/capas', nome)].find((f) => existsSync(f));
        if (!file) continue; // build do front ausente neste ambiente: a equipe envia pelo painel
        const data = readFileSync(file);
        const info = readImageInfo(data);
        if (!info) continue;
        await client.query(
          `INSERT INTO seo_images(path,mime,size_bytes,width,height,sha256,data) VALUES($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (path) DO UPDATE SET mime=EXCLUDED.mime,size_bytes=EXCLUDED.size_bytes,width=EXCLUDED.width,height=EXCLUDED.height,sha256=EXCLUDED.sha256,data=EXCLUDED.data,updated_at=now()
             WHERE seo_images.updated_by IS NULL`,
          [pagina, info.mime, data.length, info.width, info.height, createHash('sha256').update(data).digest('hex'), data]);
      }
    },
    down: async () => { /* só ajuste de conteúdo; as imagens podem ser trocadas ou removidas pelo painel */ }
  }
  ,
  {
    id: '082_seo_simulador_texto',
    name: 'SEO: título, descrição e 3 perguntas novas do /simulador; só troca o que ainda é o texto de fábrica',
    up: async (client) => {
      const campos: Array<[string, string, string]> = [
        ['title', 'Simulador de financiamento de veículo | Placa na Mão', 'Simulador de financiamento de veículos grátis | Placa na Mão'],
        ['description', 'Use o simulador de financiamento para ver parcela, CET e custo total em CDC ou leasing, com a taxa média do Banco Central e o IOF. Grátis, em segundos.', 'Use o simulador de financiamento de veículos grátis. Ajuste entrada, prazo e juros para estimar parcelas, CET e custo total de carros e motos.']
      ];
      for (const [col, antigo, novo] of campos) {
        await client.query(`UPDATE seo_pages SET ${col}=$2, updated_at=now() WHERE path='/simulador' AND ${col}=$1`, [antigo, novo]);
      }
      const novas = [
        { q: 'O simulador é gratuito?', a: 'Sim. Você simula quantas vezes quiser, sem pagar e sem precisar criar conta. Para baixar o PDF da simulação é preciso entrar na sua conta.' },
        { q: 'Posso usar a taxa da proposta do meu banco?', a: 'Pode. Informe a taxa de juros da proposta que você recebeu e o simulador recalcula a parcela, o CET e o custo total com ela.' },
        { q: 'A simulação consulta ofertas de todos os bancos?', a: 'Não. O simulador calcula cenários com os dados informados e não consulta nem garante ofertas de todos os bancos. Você pode inserir a taxa de uma proposta recebida para estimar seus custos.' }
      ];
      for (const f of novas) {
        await client.query(
          `UPDATE seo_pages SET faq=COALESCE(faq,'[]'::jsonb) || $2::jsonb, updated_at=now()
            WHERE path='/simulador' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(faq,'[]'::jsonb)) AS x(e) WHERE x.e->>'q'=$1)`,
          [f.q, JSON.stringify([f])]);
      }
    },
    down: async () => { /* só ajuste de texto; nada a desfazer */ }
  }
  ,
  {
    id: '083_pacotes_calculados',
    name: 'Pacotes de saldo calculados pelos preços das consultas e pela margem; só troca se ainda estiverem com os valores de fábrica',
    up: async (client) => {
      const fabrica: Record<string, [number, number]> = { essencial: [60, 6000], completo: [130, 12000], profissional: [350, 30000] };
      const atuais = (await client.query(`SELECT slug,credits,price_cents FROM credit_packages WHERE slug = ANY($1)`, [Object.keys(fabrica)])).rows as Array<{ slug: string; credits: number; price_cents: number }>;
      if (atuais.length !== 3 || atuais.some((p) => fabrica[p.slug]![0] !== Number(p.credits) || fabrica[p.slug]![1] !== Number(p.price_cents))) return;
      const produtos = (await client.query(`SELECT id,name,price_cents,provider_cost_cents FROM query_products WHERE active=true AND COALESCE(is_free,false)=false AND price_cents>0`)).rows
        .map((p: { id: string; name: string; price_cents: number; provider_cost_cents: number | null }) => ({ id: p.id, name: p.name, priceCents: Number(p.price_cents), providerCostCents: Number(p.provider_cost_cents ?? 0) }));
      const plano = planPackages(await loadPaymentSettings(client), produtos);
      if (plano.tiers.length !== 3 || plano.tiers.some((t) => t.priceCents <= 0 || t.faceCredits <= 0)) return;
      for (const t of plano.tiers) {
        await client.query(`UPDATE credit_packages SET credits=$2, price_cents=$3, highlights=$4::jsonb, updated_at=now() WHERE slug=$1`, [t.slug, t.faceCredits, t.priceCents, JSON.stringify(t.highlights)]);
      }
    },
    down: async () => { /* valores de pacote são dado comercial; nada a desfazer */ }
  },
  {
    id: '084_seo_revisao_editorial',
    name: 'SEO: revisão editorial (sem promessa sem prova, textos de home, Sobre, Planos e Gravame) com histórico dos valores anteriores',
    up: async (client) => { await reviewSeoRows(client, 'revisao_editorial_1_55'); },
    down: async () => { /* o histórico fica guardado em seo_pages_history */ }
  },
  {
    id: '085_seo_textos_das_consultas',
    name: 'SEO: textos das páginas de consulta e de lojistas e concessionárias, com histórico dos valores anteriores',
    up: async (client) => { await reviewSeoRows(client, 'revisao_editorial_1_56'); },
    down: async () => { /* o histórico fica guardado em seo_pages_history */ }
  },
  {
    id: '086_acessos_por_conta',
    name: 'Acessos por conta: o administrador liga ou desliga recursos (garagem, monitoramento) para cada cliente; vazio = tudo liberado como antes',
    up: async (client) => { await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS access_overrides jsonb NOT NULL DEFAULT '{}'::jsonb`); },
    down: async (client) => { await client.query('ALTER TABLE users DROP COLUMN IF EXISTS access_overrides'); }
  },
  {
    id: '087_limite_fipe_por_usuario',
    name: 'Limite diário de FIPE grátis por usuário: valor próprio de cada conta (vazio = usa o padrão do sistema)',
    up: async (client) => { await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS fipe_daily_limit integer CHECK (fipe_daily_limit IS NULL OR (fipe_daily_limit >= 1 AND fipe_daily_limit <= 100000))'); },
    down: async (client) => { await client.query('ALTER TABLE users DROP COLUMN IF EXISTS fipe_daily_limit'); }
  }

];
