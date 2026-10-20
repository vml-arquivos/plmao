import assert from 'node:assert/strict';
import test, { describe, it } from 'node:test';
import { calculatePricing, compoundInterestCents, getDiagnostic, isPricingError, psychologicalPriceCents } from '../dist/pricing/engine.js';

// Fixture em centavos / bps (porte do PermuPay: custo 500,00 · margem 20% · Simples 6%)
const base = {
  productName: 'Consulta Teste',
  costPriceCents: 50000,
  otherCostsCents: 4500, // 10 + 20 + 15 reais
  desiredMarginBps: 2000,
  taxRegime: 'SIMPLES_NACIONAL',
  taxRates: { cash: 600, boleto: 600, debit: 600, creditCash: 600, creditInstallment: 600 },
  boleto: { months: 3, monthlyInterestBps: 200, fixedFeeCents: 350, defaultRiskBps: 300, customerPaysInterest: false },
  card: { debitFeeBps: 150, creditCashFeeBps: 250, creditInstallmentFeeBps: 350, installments: 6, anticipationBps: 150, monthlyInterestBps: 199, customerPaysInterest: false }
};
const calc = (input = base) => { const r = calculatePricing(input); assert.equal(isPricingError(r), false); return r; };
const pick = (r, m) => r.results.find((x) => x.method === m);

describe('Pix / À vista', () => {
  it('preço sugerido com imposto e margem', () => {
    const pix = pick(calc(), 'PIX');
    assert.ok(Math.abs(pix.suggestedPriceCents - 63830) <= 1, String(pix.suggestedPriceCents));
    assert.equal(pix.installments, 1);
    assert.equal(pix.totalInterestCents, 0);
    assert.equal(pix.totalFeesCents, 0);
  });
  it('imposto total = preço × 6%', () => {
    const pix = pick(calc(), 'PIX');
    assert.ok(Math.abs(pix.totalTaxCents - pix.suggestedPriceCents * 0.06) <= 1);
  });
  it('diagnóstico coerente e lucro positivo', () => {
    const pix = pick(calc(), 'PIX');
    assert.ok(['SAUDAVEL', 'EXCELENTE', 'ATENCAO', 'RISCO'].includes(pix.diagnostic));
    assert.ok(pix.netProfitCents > 0);
  });
  it('markup sobre o custo', () => {
    const pix = pick(calc(), 'PIX');
    const expected = ((pix.suggestedPriceCents - 50000) / 50000) * 10000;
    assert.ok(Math.abs(pix.markupOnCostBps - expected) <= 1);
  });
  it('taxa percentual e fixa do Pix entram no preço (extensão Placa na Mão)', () => {
    const r = calc({ ...base, pix: { feeBps: 99, fixedFeeCents: 0 } });
    const pix = pick(r, 'PIX');
    assert.ok(pix.suggestedPriceCents > 63830);
    assert.ok(Math.abs(pix.totalFeesCents - pix.suggestedPriceCents * 0.0099) <= 1);
  });
});

describe('Boleto bancário', () => {
  it('juros compostos embutidos no preço', () => {
    const b = pick(calc(), 'BOLETO');
    assert.ok(b.totalInterestCents > 0 && b.suggestedPriceCents > 0);
  });
  it('parcela mensal', () => {
    const b = pick(calc(), 'BOLETO');
    assert.equal(b.installments, 3);
    assert.ok(Math.abs(b.installmentValueCents - b.suggestedPriceCents / 3) <= 1);
  });
  it('taxa fixa de emissão incluída', () => {
    const b = pick(calc(), 'BOLETO');
    assert.ok(b.totalFeesCents >= 350);
  });
  it('risco de inadimplência nas taxas', () => {
    const b = pick(calc(), 'BOLETO');
    assert.ok(b.totalFeesCents > 350);
  });
  it('cliente paga juros: preço não embute juros', () => {
    const paid = pick(calc({ ...base, boleto: { ...base.boleto, customerPaysInterest: true } }), 'BOLETO');
    const absorbed = pick(calc(), 'BOLETO');
    assert.ok(paid.suggestedPriceCents < absorbed.suggestedPriceCents);
  });
});

describe('Cartão de débito', () => {
  it('preço com taxa de débito', () => {
    const d = pick(calc(), 'DEBITO');
    assert.ok(Math.abs(d.suggestedPriceCents - 64865) <= 1, String(d.suggestedPriceCents));
    assert.ok(Math.abs(d.totalFeesCents - d.suggestedPriceCents * 0.015) <= 1);
    assert.equal(d.totalInterestCents, 0);
    assert.equal(d.installments, 1);
  });
  it('taxa maior que zero', () => assert.ok(pick(calc(), 'DEBITO').totalFeesCents > 0));
});

describe('Crédito parcelado', () => {
  it('preço com juros e antecipação', () => {
    const c = pick(calc(), 'CREDITO_PARCELADO');
    assert.equal(c.installments, 6);
    assert.ok(c.totalFeesCents > 0 && c.suggestedPriceCents > 0);
  });
  it('valor da parcela', () => {
    const c = pick(calc(), 'CREDITO_PARCELADO');
    assert.ok(Math.abs(c.installmentValueCents - c.suggestedPriceCents / 6) <= 1);
  });
  it('antecipação nas taxas (3,5% + 1,5% = 5%)', () => {
    const c = pick(calc(), 'CREDITO_PARCELADO');
    assert.ok(Math.abs(c.totalFeesCents - c.suggestedPriceCents * 0.05) <= 2);
  });
  it('juros embutidos quando a empresa absorve', () => {
    const c = pick(calc({ ...base, card: { ...base.card, customerPaysInterest: false, monthlyInterestBps: 200 } }), 'CREDITO_PARCELADO');
    assert.ok(c.totalInterestCents > 0);
  });
});

describe('Validações', () => {
  it('soma de percentuais variáveis >= 100%', () => {
    const r = calculatePricing({ ...base, taxRates: { ...base.taxRates, cash: 10000 } });
    assert.equal(isPricingError(r), true);
    assert.equal(r.code, 'INVALID_PERCENTAGES');
  });
  it('custo negativo', () => {
    const r = calculatePricing({ ...base, costPriceCents: -10000 });
    assert.equal(r.code, 'NEGATIVE_COST');
  });
  it('margem negativa', () => {
    const r = calculatePricing({ ...base, desiredMarginBps: -500 });
    assert.equal(r.code, 'NEGATIVE_MARGIN');
  });
  it('meses do boleto < 1', () => {
    const r = calculatePricing({ ...base, boleto: { ...base.boleto, months: 0 } });
    assert.equal(r.code, 'INVALID_PERIODS');
  });
  it('parcelas < 1', () => {
    const r = calculatePricing({ ...base, card: { ...base.card, installments: 0 } });
    assert.equal(r.code, 'INVALID_PERIODS');
  });
  it('rejeita valor monetário não inteiro (proteção contra float)', () => {
    const r = calculatePricing({ ...base, costPriceCents: 500.5 });
    assert.equal(r.code, 'INVALID_NUMBER');
  });
});

describe('Diagnóstico', () => {
  it('PREJUÍZO com lucro negativo', () => assert.equal(getDiagnostic(500, -1000), 'PREJUIZO'));
  it('RISCO com margem real < 10%', () => assert.equal(getDiagnostic(800, 5000), 'RISCO'));
  it('SAUDÁVEL com margem >= desejada', () => assert.equal(getDiagnostic(2000, 10000, 1500), 'SAUDAVEL'));
  it('EXCELENTE com desejada + 10 p.p.', () => assert.equal(getDiagnostic(2600, 10000, 1500), 'EXCELENTE'));
  it('ATENÇÃO abaixo da desejada e acima de 10%', () => assert.equal(getDiagnostic(1500, 10000, 2500), 'ATENCAO'));
  it('cálculo viável com custo alto e margem baixa gera 5 resultados', () => {
    const r = calc({ ...base, costPriceCents: 100000, desiredMarginBps: 500 });
    assert.equal(r.results.length, 5);
  });
});

describe('Margem real, melhor/pior método e auxiliares', () => {
  it('margem real = lucro / preço', () => {
    const pix = pick(calc(), 'PIX');
    assert.ok(Math.abs(pix.realMarginBps - (pix.netProfitCents / pix.suggestedPriceCents) * 10000) <= 1);
  });
  it('melhor e pior forma de pagamento diferentes', () => {
    const r = calc();
    assert.notEqual(r.bestMethod, r.worstMethod);
  });
  it('juros compostos em centavos', () => assert.equal(compoundInterestCents(100000, 200, 3), 106121));
  it('taxa zero retorna a base', () => assert.equal(compoundInterestCents(100000, 0, 3), 100000));
  it('preço psicológico ,90', () => {
    assert.equal(psychologicalPriceCents(10050), 10090);
    assert.equal(psychologicalPriceCents(10100), 10190);
    assert.equal(psychologicalPriceCents(10150), 10190);
    assert.equal(psychologicalPriceCents(9991), 10090);
    assert.equal(psychologicalPriceCents(9990), 9990);
  });
  it('5 formas de pagamento e custo total', () => {
    const r = calc();
    assert.equal(r.results.length, 5);
    assert.equal(r.totalCostCents, 54500);
  });
  it('preço seguro cobre todas as formas e sempre há aviso fiscal', () => {
    const r = calc();
    assert.equal(r.safePriceCents, Math.max(...r.results.map((x) => x.suggestedPriceCents)));
    assert.match(r.fiscalWarning, /contador/);
  });
  it('base de margem TOTAL_COST aumenta o preço quando há outros custos', () => {
    const a = pick(calc(), 'PIX').suggestedPriceCents;
    const b = pick(calc({ ...base, marginBase: 'TOTAL_COST' }), 'PIX').suggestedPriceCents;
    assert.ok(b > a);
  });
  it('invariante: lucro líquido real nunca fica abaixo do esperado em Pix (sem fees)', () => {
    const pix = pick(calc(), 'PIX');
    assert.ok(pix.netProfitCents >= pix.marginValueCents - pix.otherCostsCents - 1);
  });
});
