import type { Migration } from './migrations.js';

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
          enabled_methods text[] NOT NULL DEFAULT ARRAY['PIX','CREDITO_A_VISTA','BOLETO']::text[],
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
  }
];
