import type { Migration } from './migrations.js';
import { SEED_SOURCE, VEHICLE_SEED } from './data/vehicleSeed.js';
import { CONSUMPTION_SEED, HONDA_CIVIC_OBS, COROLLA_HYBRID_VERSION, CIVIC_MODEL, INMETRO_NAME, INMETRO_PBEV_2024_URL, COLLECTED_AT, type ConsumptionSeed } from './data/consumptionSeed.js';
import { VEHICLE_PHOTOS, photoPage, photoUrl } from './data/vehiclePhotos.js';
import { readBundledSnapshot, upsertCatalog, rematchCatalog } from './lib/catalog.js';
import { SEED_ARTICLES, SEED_FAQS, SEED_FEATURES, SEED_MATRIX } from './content.seed.js';

/**
 * Migrações do produto Placa na Mão (010+): configurações de pagamento, comissões/repasses,
 * preços de referência, API pública, dados sensíveis em repouso e auditoria de revelação de PII.
 * Dinheiro: centavos inteiros · percentuais: basis points.
 */
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
        { id: 'COMPLETE', name: 'Consulta Completa', tagline: 'A checagem inteira, em um só relatório.', description: 'Identificação, débitos, multas, restrições, gravame, recall e inspeção em um único relatório.', long: 'A checagem mais completa antes de comprar, vender ou financiar. Reúne tudo da Básica e acrescenta financiamento (gravame), recall e inspeção, e costuma sair mais barata do que somar consultas avulsas.', price: 6160, ref: 6490, order: 10, featured: true, badge: 'Mais completa', features: ['Tudo da Consulta Básica', 'Financiamento e gravame', 'Recall e inspeção veicular', 'Relatório em PDF com código de validação'], sections: [...ident, 'DEBITOS', 'RESTRICOES', 'GRAVAME', 'INSPECAO_RECALL'], coverage: 'Identificação, débitos, restrições, gravame, recall e inspeção', rule: 'Identificação, débitos, restrições, gravame, recall e inspeção (fonte contratada)' },
        { id: 'BASIC', name: 'Consulta Básica', tagline: 'Cadastro, débitos, multas e restrições.', description: 'Dados do veículo, débitos, multas e restrições para uma compra com mais segurança.', long: 'O essencial para fechar uma compra com tranquilidade: confere se o veículo é o do anúncio e se há débitos, multas ou restrições registradas.', price: 4360, ref: 4590, order: 20, featured: false, badge: 'Custo-benefício', features: ['Dados do veículo e situação', 'Débitos e multas', 'Restrições (furto/roubo, judicial e outras)', 'Relatório em PDF'], sections: [...ident, 'DEBITOS', 'RESTRICOES'], coverage: 'Identificação, débitos e restrições', rule: 'Identificação, débitos e restrições (fonte contratada)' },
        { id: 'AUCTION', name: 'Consulta Leilão', tagline: 'Passagem do veículo por leilão.', description: 'Histórico de passagem por leilão. Disponível assim que a fonte de dados for ativada.', long: 'Saiba se o veículo já passou por leilão, informação importante para avaliação, seguro e revenda. Ainda não está disponível: não vendemos o que não podemos entregar.', price: 3310, ref: 3490, order: 30, featured: false, badge: null, features: ['Histórico de passagem por leilão', 'Relatório em PDF'], sections: null, coverage: 'Histórico de leilão (em breve)', rule: null },
        { id: 'LIEN', name: 'Consulta Gravame', tagline: 'Financiamento e restrição financeira.', description: 'Veja se o veículo tem gravame ou restrição financeira antes da transferência.', long: 'Verifica sinais de financiamento ativo: gravame e intenção de gravame informados pela fonte. Ideal para quem já conferiu o resto e quer fechar essa dúvida.', price: 1410, ref: 1490, order: 40, featured: false, badge: null, features: ['Gravame e restrição financeira', 'Intenção de gravame', 'Relatório em PDF'], sections: ['IDENTIFICACAO', 'GRAVAME'], coverage: 'Gravame e restrição financeira', rule: 'Gravame e restrição financeira (fonte contratada)' },
        { id: 'CADASTRAL', name: 'Consulta Cadastral', tagline: 'Confirme se o veículo é o do anúncio.', description: 'Marca, modelo, ano, cor, combustível, município e situação do veículo pela placa.', long: 'A forma mais rápida e barata de conferir se o veículo corresponde ao anúncio e ao documento: identificação, características e situação cadastral.', price: 1320, ref: 1390, order: 50, featured: false, badge: null, features: ['Marca, modelo, ano e cor', 'Combustível e categoria', 'Município, UF e situação', 'Relatório em PDF'], sections: ident, coverage: 'Identificação, características e situação cadastral', rule: 'Identificação e características (fonte contratada)' }
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
  }
];
