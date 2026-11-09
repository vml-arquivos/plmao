import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

useTestEnv();
const { planPackages, ceilToEnding, safeDiscountCap, DEFAULT_TIERS } = await import('../dist/pricing/packagePlanner.js');

const settings = {
  packageDiscountBps: 0, taxRegime: 'SIMPLES_NACIONAL', taxRates: { cash: 600, boleto: 600, debit: 600, creditCash: 600, creditInstallment: 600 },
  pix: { feeBps: 99, fixedFeeCents: 0 }, boleto: { months: 1, monthlyInterestBps: 0, fixedFeeCents: 350, defaultRiskBps: 300, customerPaysInterest: true },
  card: { debitFeeBps: 150, creditCashFeeBps: 449, creditInstallmentFeeBps: 549, installments: 3, anticipationBps: 150, monthlyInterestBps: 0, customerPaysInterest: true },
  enabledMethods: ['PIX', 'CREDITO_A_VISTA'], operationalCostCents: 0, desiredMarginBps: 3000, minMarginBps: 1000, marginBase: 'TOTAL_COST'
};
// custos fictícios, só para provar a conta
const products = [
  { id: 'COMPLETE', name: 'Consulta Completa', priceCents: 3459, providerCostCents: 2000 },
  { id: 'AUCTION', name: 'Leilão', priceCents: 2990, providerCostCents: 2000 },
  { id: 'BASIC', name: 'Básica', priceCents: 990, providerCostCents: 200 }
];

describe('calculadora de pacotes (conta pura)', () => {
  it('valor termina em ,90 e nunca fica abaixo do calculado', () => {
    assert.equal(ceilToEnding(10061), 10090); assert.equal(ceilToEnding(10090), 10090); assert.equal(ceilToEnding(10091), 10190); assert.equal(ceilToEnding(10000), 10090);
  });
  it('cada pacote cobre as consultas prometidas, dá desconto real sem passar do pedido e respeita a margem do pior produto', () => {
    const plan = planPackages(settings, products, { marginFloorBps: 1500 });
    assert.equal(plan.tiers.length, DEFAULT_TIERS.length);
    for (const t of plan.tiers) {
      assert.ok(t.faceCredits * 100 >= t.units * 3459, 'o saldo paga todas as consultas');
      assert.ok(t.faceCredits * 100 < (t.units + 1) * 3459 + 100, 'sem saldo de sobra além de 1 real de arredondamento');
      assert.equal(t.priceCents % 100, 90);
      assert.ok(t.priceCents < t.faceCredits * 100);
      assert.ok(t.effectiveDiscountBps <= t.requestedDiscountBps + 0 && t.effectiveDiscountBps <= plan.capBps);
      assert.ok(t.worstMarginBps >= plan.marginFloorBps, `margem ${t.worstMarginBps} abaixo do piso`);
      assert.equal(t.savingsCents, t.faceCredits * 100 - t.priceCents);
    }
    assert.ok(plan.tiers[0].effectiveDiscountBps <= plan.tiers[2].effectiveDiscountBps + 400);
  });
  it('desconto pedido acima do limite é reduzido e avisado; margem do piso alto zera o desconto', () => {
    const plan = planPackages(settings, products, { marginFloorBps: 1500, tiers: [{ slug: 'x', units: 10, discountBps: 4000 }] });
    assert.equal(plan.tiers[0].capped, true); assert.ok(plan.tiers[0].effectiveDiscountBps <= plan.capBps); assert.match(plan.warnings.join(' '), /limite seguro/);
    assert.ok(plan.tiers[0].worstMarginBps >= 1500);
    assert.equal(safeDiscountCap(settings, products, 9000).capBps, 0);
    assert.match(planPackages(settings, products, { marginFloorBps: 9000 }).warnings.join(' '), /Nenhum desconto é seguro/);
  });
  it('produto sem custo cadastrado fica fora da conta e é avisado; o resultado não traz nenhum custo', () => {
    const plan = planPackages(settings, [...products, { id: 'X', name: 'Sem custo', priceCents: 1000, providerCostCents: 0 }]);
    assert.match(plan.warnings.join(' '), /Sem custo cadastrado/);
    assert.ok(!/providerCost|costCents/i.test(JSON.stringify(plan)));
  });
});

describe('calculadora de pacotes no painel', integration, () => {
  let server, pool, adm, original;
  before(async () => {
    ({ pool } = await loadCore()); server = await startServer(); adm = await adminSession({ server, pool, role: 'ADMIN' });
    original = (await pool.query(`SELECT slug,credits,price_cents,highlights FROM credit_packages WHERE slug IN ('essencial','completo','profissional')`)).rows;
  });
  after(async () => {
    for (const r of original) await pool.query('UPDATE credit_packages SET credits=$2, price_cents=$3, highlights=$4::jsonb WHERE slug=$1', [r.slug, r.credits, r.price_cents, JSON.stringify(r.highlights)]);
    await server.stop(); await pool.end();
  });
  it('calcula com os preços do catálogo; exige login de admin e corpo válido', async () => {
    const r = await adm.call('/api/admin/content/packages/plan', { method: 'POST', body: {} });
    assert.equal(r.status, 200, r.text); assert.equal(r.json.tiers.length, 3); assert.ok(r.json.referencePriceCents > 0);
    if (r.json.capBps > 0) for (const t of r.json.tiers) assert.ok(t.worstMarginBps >= r.json.marginFloorBps);
    else assert.match(r.json.warnings.join(' '), /Nenhum desconto é seguro/);
    assert.equal((await adm.call('/api/admin/content/packages/plan', { method: 'POST', body: { tiers: [] } })).status, 400);
    assert.equal((await adm.call('/api/admin/content/packages/plan', { method: 'POST', body: { extra: 1 } })).status, 400);
    assert.equal((await hostRequest(server.base, '/api/admin/content/packages/plan', { method: 'POST', body: {} })).status, 401);
  });
  it('aplicar grava saldo, valor e destaques calculados pelo servidor e o catálogo público reflete', async () => {
    const plan = (await adm.call('/api/admin/content/packages/plan', { method: 'POST', body: { marginFloorPct: 20, tiers: [{ slug: 'essencial', units: 2, discountPct: 3 }, { slug: 'completo', units: 8, discountPct: 6 }, { slug: 'profissional', units: 25, discountPct: 9 }] } })).json;
    const ap = await adm.call('/api/admin/content/packages/plan/apply', { method: 'POST', body: { marginFloorPct: 20, tiers: [{ slug: 'essencial', units: 2, discountPct: 3 }, { slug: 'completo', units: 8, discountPct: 6 }, { slug: 'profissional', units: 25, discountPct: 9 }] } });
    assert.equal(ap.status, 200, ap.text);
    const rows = (await pool.query(`SELECT slug,credits,price_cents,highlights FROM credit_packages WHERE slug IN ('essencial','completo','profissional')`)).rows;
    for (const t of plan.tiers) {
      const row = rows.find((x) => x.slug === t.slug);
      assert.deepEqual([Number(row.credits), Number(row.price_cents)], [t.faceCredits, t.priceCents]);
      assert.equal(row.highlights[0], t.highlights[0]);
    }
    const cat = await hostRequest(server.base, '/api/catalog');
    assert.equal(cat.json.packages.find((p) => p.slug === 'completo').priceCents, plan.tiers.find((t) => t.slug === 'completo').priceCents);
    assert.equal((await adm.call('/api/admin/content/packages/plan/apply', { method: 'POST', body: { tiers: [{ slug: 'nao-existe', units: 3, discountPct: 3 }] } })).status, 404);
  });
});
