import { env } from '../config.js';
import { pool } from '../db.js';
import { log } from './http.js';
import { configuredFiscalProvider, enqueueFiscalEmission, processFiscalJobs, type FiscalProvider } from './fiscal.js';
import { syncPaidPayments } from '../routes/adminBilling.js';

/**
 * Emissão automática: a cada poucos minutos cria o documento fiscal dos pagamentos confirmados recentemente
 * e coloca na fila de emissão, que envia ao emissor e entrega a nota ao cliente por e-mail.
 * Só roda com FISCAL_AUTO_EMIT ligado, emissor configurado e a tela Fiscal → Configurações completa.
 * Janela curta (3 dias): ligar o recurso nunca emite nota de pagamento antigo sem querer. O que ficar de fora
 * (cliente sem CPF/CNPJ ou endereço, por exemplo) continua pendente no painel para ajuste ou emissão manual.
 */
export const AUTO_WINDOW_DAYS = 3;
const REQUIRED = ['legal_name', 'cnpj', 'municipal_registration', 'service_code', 'city', 'state', 'city_ibge_code', 'tax_regime'] as const;

export interface FiscalAutoResult { skipped: string | null; created: number; queued: number; incomplete: number; failed: number }

export async function runFiscalAuto(opts: { provider?: FiscalProvider | null; windowDays?: number } = {}): Promise<FiscalAutoResult> {
  const out: FiscalAutoResult = { skipped: null, created: 0, queued: 0, incomplete: 0, failed: 0 };
  const provider = opts.provider === undefined ? configuredFiscalProvider() : opts.provider;
  if (!provider || !provider.isConfigured()) { out.skipped = 'EMISSOR_NAO_CONFIGURADO'; return out; }
  const s = (await pool.query('SELECT * FROM fiscal_settings WHERE id=1')).rows[0] ?? {};
  const missing = REQUIRED.filter((c) => !s[c]);
  if (missing.length) { out.skipped = 'CONFIGURACAO_INCOMPLETA'; return out; }
  const window = opts.windowDays ?? AUTO_WINDOW_DAYS;

  out.created = await syncPaidPayments(null, window);
  // Só documentos criados pelo sistema (sem autor humano): o que a equipe criou ou editou à mão não é emitido sozinho.
  const docs = await pool.query(`SELECT d.id,d.customer_snapshot FROM fiscal_documents d
    WHERE d.status='PENDING' AND d.created_by IS NULL AND d.payment_id IS NOT NULL AND d.kind='NFSE' AND d.created_at >= now() - make_interval(days => $1::int)
      AND EXISTS (SELECT 1 FROM payments p WHERE p.id=d.payment_id AND p.status='PAID')
      AND NOT EXISTS (SELECT 1 FROM fiscal_jobs j WHERE j.document_id=d.id)
    ORDER BY d.created_at LIMIT 100`, [window]);
  for (const d of docs.rows) {
    try { await enqueueFiscalEmission(String(d.id), null, provider); out.queued += 1; } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'FISCAL_CUSTOMER_INCOMPLETE') out.incomplete += 1;
      else { out.failed += 1; log('warn', 'fiscal_auto_enqueue_failed', { documentId: d.id, reason: e instanceof Error ? e.message.slice(0, 160) : 'unknown' }); }
    }
  }
  return out;
}

/** Estado para a tela Fiscal: se a emissão automática está ligada e o que falta. */
export async function fiscalAutoStatus(): Promise<{ provider: string; configured: boolean; autoEmit: boolean; environment: string; missing: string[]; windowDays: number }> {
  const provider = configuredFiscalProvider();
  const s = (await pool.query('SELECT * FROM fiscal_settings WHERE id=1')).rows[0] ?? {};
  return {
    provider: env.FISCAL_PROVIDER, configured: Boolean(provider && provider.isConfigured()), autoEmit: env.FISCAL_AUTO_EMIT,
    environment: String(s.environment ?? 'HOMOLOGACAO'), missing: REQUIRED.filter((c) => !s[c]), windowDays: AUTO_WINDOW_DAYS
  };
}

let timer: NodeJS.Timeout | undefined;
let running = false;
export function startFiscalAuto(): void {
  if (timer || !env.FISCAL_AUTO_EMIT || !configuredFiscalProvider()) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try { const r = await runFiscalAuto(); if (r.created || r.queued || r.failed) log('info', 'fiscal_auto', { ...r }); await processFiscalJobs(); } catch (e) { log('warn', 'fiscal_auto_failed', { reason: e instanceof Error ? e.message.slice(0, 200) : 'unknown' }); } finally { running = false; }
  };
  timer = setInterval(() => { void tick(); }, 120_000);
  timer.unref();
}
