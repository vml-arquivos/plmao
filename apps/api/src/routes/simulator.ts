import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { pool } from '../db.js';
import { auth } from '../auth.js';
import { appError, asyncRoute } from '../lib/http.js';
import { FinancingError } from '../lib/financing.js';
import { loadFinancingSettings, maybeRefreshInBackground } from '../financingSettings.js';
import { runBankComparison, runSimulation, simulationBody, simulatorConfig, type SimulationOutput } from '../simulator/service.js';
import { loadBanks, loadBcbBankRates } from '../financingBanks.js';
import { renderSimulationPdf } from '../simulator/pdf.js';
import { publicAppUrl } from '../config.js';

/**
 * Simulador de financiamento (CDC e leasing) para qualquer tipo de veículo.
 * Público para simular; o PDF exige conta gratuita e fica registrado (o cliente guarda o código da simulação).
 */
export const simulatorRouter = Router();

const calcLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false, message: { error: 'TOO_MANY_ATTEMPTS', message: 'Muitas simulações em pouco tempo. Aguarde um instante.' } });
const pdfLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'TOO_MANY_ATTEMPTS', message: 'Muitos PDFs em pouco tempo. Tente novamente mais tarde.' } });

const bad = (message: string, code = 'INVALID_INPUT') => appError(message, { code, http: 400, expose: true });

function parseBody(raw: unknown) {
  const parsed = simulationBody.safeParse(raw);
  if (!parsed.success) throw bad('Confira os dados da simulação.', 'INVALID_INPUT');
  return parsed.data;
}

function run(body: ReturnType<typeof parseBody>, settings: Awaited<ReturnType<typeof loadFinancingSettings>>): SimulationOutput {
  try { return runSimulation(body, settings); } catch (e) {
    if (e instanceof FinancingError) throw bad(e.message, e.code);
    throw e;
  }
}

simulatorRouter.get('/simulator/config', asyncRoute(async (_req, res) => {
  const settings = await loadFinancingSettings();
  maybeRefreshInBackground(settings);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(simulatorConfig(settings));
}));

simulatorRouter.post('/simulator/calculate', calcLimiter, asyncRoute(async (req, res) => {
  const settings = await loadFinancingSettings();
  const out = run(parseBody(req.body), settings);
  const banks = await bankOffers(out, settings);
  res.setHeader('Cache-Control', 'no-store');
  // o cronograma completo só vai no PDF e no detalhe; a tela recebe tudo para a tabela de parcelas
  res.json({ results: out.results, rates: out.rates, errors: out.errors, banks, generatedAt: out.generatedAt, referenceMonth: settings.referenceMonth, source: settings.source });
}));

/** Comparação entre bancos. Uma falha ao ler os bancos nunca derruba a simulação principal. */
async function bankOffers(out: SimulationOutput, settings: Awaited<ReturnType<typeof loadFinancingSettings>>) {
  try {
    const [banks, bcb] = await Promise.all([loadBanks(), loadBcbBankRates()]);
    return runBankComparison(out.body, settings, banks, bcb, new Date(out.generatedAt));
  } catch { return []; }
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode(): string {
  const bytes = randomBytes(8);
  return `SIM-${Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')}`;
}

async function pdfFor(out: SimulationOutput, code: string, user: { name: string; email: string }, settings: Awaited<ReturnType<typeof loadFinancingSettings>>, generatedAt: Date, ref?: { referenceMonth: string; rateSource: string }) {
  return renderSimulationPdf(out, {
    code, generatedAt, customerName: user.name, customerEmail: user.email, siteUrl: publicAppUrl(),
    referenceMonth: ref?.referenceMonth ?? settings.referenceMonth, rateSource: ref?.rateSource ?? settings.source
  });
}

function sendPdf(res: import('express').Response, pdf: Buffer, code: string) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="simulacao-financiamento-${code}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(pdf);
}

simulatorRouter.post('/simulator/pdf', auth, pdfLimiter, asyncRoute(async (req, res) => {
  const settings = await loadFinancingSettings();
  const body = parseBody(req.body);
  const out = run(body, settings);
  out.banks = await bankOffers(out, settings);
  const primary = out.results.cdc ?? out.results.leasing!;
  const code = newCode();
  const snapshot = { ...out, referenceMonth: settings.referenceMonth, rateSource: settings.source };
  await pool.query(
    `INSERT INTO financing_simulations(code,user_id,modality,vehicle_kind,person_type,vehicle_value_cents,down_payment_cents,months,monthly_rate_pct,installment_cents,total_paid_cents,cet_annual_pct,input,output)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb)`,
    [code, req.user!.id, body.modality, body.vehicleKind, body.personType, primary.vehicleValueCents, primary.downPaymentCents, primary.months, primary.monthlyRatePct, primary.installmentCents, primary.totalPaidCents, primary.cetAnnualPct, JSON.stringify(body), JSON.stringify(snapshot)]
  );
  sendPdf(res, await pdfFor(out, code, req.user!, settings, new Date(out.generatedAt)), code);
}));

/** Últimas simulações da própria pessoa (para baixar o PDF de novo). */
simulatorRouter.get('/simulator/mine', auth, asyncRoute(async (req, res) => {
  const r = await pool.query(
    `SELECT code, modality, vehicle_kind, person_type, vehicle_value_cents, down_payment_cents, months, monthly_rate_pct, installment_cents, total_paid_cents, cet_annual_pct, created_at, (input->>'vehicleLabel') AS label
     FROM financing_simulations WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20`, [req.user!.id]);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ items: r.rows.map((x) => ({
    code: x.code, modality: x.modality, vehicleKind: x.vehicle_kind, personType: x.person_type, label: x.label || null,
    vehicleValueCents: Number(x.vehicle_value_cents), downPaymentCents: Number(x.down_payment_cents), months: x.months,
    monthlyRatePct: Number(x.monthly_rate_pct), installmentCents: Number(x.installment_cents), totalPaidCents: Number(x.total_paid_cents),
    cetAnnualPct: x.cet_annual_pct == null ? null : Number(x.cet_annual_pct), createdAt: x.created_at
  })) });
}));

/** Reimpressão: o PDF sai igual ao original, com as taxas e a data daquele dia. */
simulatorRouter.get('/simulator/mine/:code/pdf', auth, pdfLimiter, asyncRoute(async (req, res) => {
  const code = String(req.params.code ?? '');
  if (!/^SIM-[A-Z0-9]{8}$/.test(code)) throw appError('SIMULATION_NOT_FOUND', { code: 'SIMULATION_NOT_FOUND', http: 404, expose: true });
  const r = await pool.query('SELECT output, created_at FROM financing_simulations WHERE code=$1 AND user_id=$2', [code, req.user!.id]);
  const row = r.rows[0];
  if (!row?.output) throw appError('SIMULATION_NOT_FOUND', { code: 'SIMULATION_NOT_FOUND', http: 404, expose: true });
  const snap = row.output as SimulationOutput & { referenceMonth: string; rateSource: string };
  const settings = await loadFinancingSettings();
  sendPdf(res, await pdfFor(snap, code, req.user!, settings, new Date(row.created_at), { referenceMonth: snap.referenceMonth, rateSource: snap.rateSource }), code);
}));
