import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const IOF = { pfDailyPct: 0.0082, pjDailyPct: 0.0041, additionalPct: 0.38, capDays: 365 };
const base = () => ({
  modality: 'CDC', personType: 'PF', vehicleKind: 'CAR', condition: 'USED', vehicleValueCents: 8_000_000, downPaymentCents: 2_000_000, months: 48,
  monthlyRatePct: 1.97, residualPct: 0, fees: { cadastroCents: 0, avaliacaoCents: 0, registroCents: 0, insuranceCents: 0 }, financeFees: true,
  firstInstallmentDays: 30, iof: IOF, startDate: new Date('2026-10-20T12:00:00Z')
});

describe('parcelas fixas x decrescentes', () => {
  it('parcelas fixas: primeira = última e o resultado antigo não muda', async () => {
    const { simulate } = await import('../dist/lib/financing.js');
    const r = simulate(base());
    assert.equal(r.amortization, 'PRICE');
    assert.equal(r.firstInstallmentCents, r.installmentCents);
    assert.equal(r.lastInstallmentCents, r.installmentCents);
    assert.equal(r.installmentsTotalCents, r.installmentCents * 48);
  });

  it('SAC: a parcela cai todo mês, a primeira é maior que a fixa e a última é bem menor', async () => {
    const { simulate } = await import('../dist/lib/financing.js');
    const price = simulate(base());
    const sac = simulate({ ...base(), amortization: 'SAC' });
    assert.equal(sac.amortization, 'SAC');
    assert.ok(sac.firstInstallmentCents > price.installmentCents);
    assert.ok(sac.lastInstallmentCents < price.installmentCents / 1.5);
    for (let k = 1; k < sac.schedule.length; k++) assert.ok(sac.schedule[k].installmentCents <= sac.schedule[k - 1].installmentCents);
    assert.equal(sac.installmentCents, sac.firstInstallmentCents);
    assert.equal(sac.schedule[0].installmentCents, sac.firstInstallmentCents);
    assert.equal(sac.schedule.at(-1).installmentCents, sac.lastInstallmentCents);
    assert.equal(sac.installmentsTotalCents, sac.schedule.reduce((a, r) => a + r.installmentCents, 0));
    assert.equal(sac.schedule.at(-1).balanceCents, 0);
    // SAC paga menos juros no total que a Price com a mesma taxa
    assert.ok(sac.totalPaidCents < price.totalPaidCents);
    assert.equal(sac.totalPaidCents, sac.downPaymentCents + sac.installmentsTotalCents);
  });

  it('SAC sem tarifas nem IOF: CET igual à taxa e amortização constante', async () => {
    const { simulate } = await import('../dist/lib/financing.js');
    const r = simulate({ ...base(), amortization: 'SAC', iof: { ...IOF, pfDailyPct: 0, additionalPct: 0 } });
    assert.ok(Math.abs(r.cetMonthlyPct - 1.97) < 0.01);
    const amort = r.schedule.map((x) => x.principalCents);
    assert.ok(Math.max(...amort) - Math.min(...amort) <= 2);
    assert.equal(r.schedule[0].installmentCents, Math.round(6_000_000 / 48 + 6_000_000 * 0.0197));
  });

  it('leasing SAC: residual no fim, última parcela sem o residual e saldo final igual ao residual', async () => {
    const { simulate } = await import('../dist/lib/financing.js');
    const cdc = simulate({ ...base(), amortization: 'SAC' });
    const lease = simulate({ ...base(), modality: 'LEASING', residualPct: 20, amortization: 'SAC' });
    assert.equal(lease.residualCents, 1_600_000);
    assert.ok(lease.firstInstallmentCents < cdc.firstInstallmentCents);
    assert.ok(lease.lastInstallmentCents < lease.firstInstallmentCents);
    assert.equal(lease.totalPaidCents, lease.downPaymentCents + lease.installmentsTotalCents + 1_600_000);
    assert.ok(lease.cetAnnualPct > 0);
  });

  it('com carência, SAC continua decrescente e fecha o saldo', async () => {
    const { simulate } = await import('../dist/lib/financing.js');
    const r = simulate({ ...base(), amortization: 'SAC', firstInstallmentDays: 60 });
    assert.ok(r.firstInstallmentCents > r.lastInstallmentCents);
    assert.equal(r.schedule.at(-1).balanceCents, 0);
  });
});
