import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

const IOF = { pfDailyPct: 0.0082, pjDailyPct: 0.0041, additionalPct: 0.38, capDays: 365 };
const baseInput = () => ({
  modality: 'CDC', personType: 'PF', vehicleKind: 'CAR', condition: 'USED', vehicleValueCents: 8_000_000, downPaymentCents: 2_000_000, months: 48,
  monthlyRatePct: 1.97, residualPct: 0, fees: { cadastroCents: 0, avaliacaoCents: 0, registroCents: 0, insuranceCents: 0 }, financeFees: true,
  firstInstallmentDays: 30, iof: IOF, startDate: new Date('2026-10-20T12:00:00Z')
});

describe('simulador de financiamento: cálculo', () => {
  it('parcela Price sem tarifas e sem IOF bate com a fórmula fechada', async () => {
    const { simulate } = await import('../dist/lib/financing.js');
    const r = simulate({ ...baseInput(), iof: { ...IOF, pfDailyPct: 0, additionalPct: 0 } });
    const i = 0.0197; const P = 6_000_000;
    const expected = Math.round((P * i) / (1 - Math.pow(1 + i, -48)));
    assert.equal(r.iofCents, 0);
    assert.equal(r.installmentCents, expected);
    assert.equal(r.schedule.length, 48);
    assert.equal(r.schedule.at(-1).balanceCents, 0);
    assert.equal(r.schedule[0].dueDate, '2026-11-19');
    // CET sem tarifas nem IOF é igual à taxa contratada
    assert.ok(Math.abs(r.cetMonthlyPct - 1.97) < 0.01);
  });

  it('IOF é financiado por dentro, respeita o teto de 365 dias e o CET fica acima da taxa', async () => {
    const { simulate } = await import('../dist/lib/financing.js');
    const r = simulate(baseInput());
    // a soma das amortizações é o principal; o principal inclui o próprio IOF
    assert.equal(r.principalCents, r.loanNetCents + r.iofCents);
    // teto: nenhum IOF poderia passar de 0,38% + 2,993% do principal
    assert.ok(r.iofCents <= Math.round(r.principalCents * (0.0038 + 0.0082 * 365 / 100)) + 1);
    assert.ok(r.iofCents > r.principalCents * 0.0038);
    assert.ok(r.cetMonthlyPct > 1.97);
    assert.ok(r.totalPaidCents > r.vehicleValueCents);
    assert.equal(r.totalPaidCents, r.downPaymentCents + r.installmentsTotalCents);
  });

  it('PJ paga metade da alíquota diária de IOF', async () => {
    const { simulate } = await import('../dist/lib/financing.js');
    const pf = simulate(baseInput()); const pj = simulate({ ...baseInput(), personType: 'PJ' });
    assert.ok(pj.iofCents < pf.iofCents);
  });

  it('tarifas financiadas aumentam o principal; pagas à vista entram no total e no CET', async () => {
    const { simulate } = await import('../dist/lib/financing.js');
    const fees = { cadastroCents: 60_000, avaliacaoCents: 40_000, registroCents: 25_000, insuranceCents: 0 };
    const none = simulate(baseInput());
    const fin = simulate({ ...baseInput(), fees });
    const upfront = simulate({ ...baseInput(), fees, financeFees: false });
    assert.equal(fin.feesTotalCents, 125_000);
    assert.ok(fin.principalCents > none.principalCents + 125_000 - 1);
    assert.equal(upfront.feesUpfrontCents, 125_000);
    assert.equal(upfront.totalPaidCents, upfront.downPaymentCents + 125_000 + upfront.installmentsTotalCents);
    assert.ok(upfront.installmentCents < fin.installmentCents);
    assert.ok(upfront.cetMonthlyPct > none.cetMonthlyPct);
  });

  it('leasing: residual no fim, parcela menor que um CDC de mesma taxa e saldo final igual ao residual', async () => {
    const { simulate } = await import('../dist/lib/financing.js');
    const cdc = simulate(baseInput());
    const lease = simulate({ ...baseInput(), modality: 'LEASING', residualPct: 20 });
    assert.equal(lease.residualCents, 1_600_000);
    assert.ok(lease.installmentCents < cdc.installmentCents);
    assert.equal(lease.schedule.at(-1).balanceCents, 1_600_000);
    assert.equal(lease.totalPaidCents, lease.downPaymentCents + lease.installmentsTotalCents + 1_600_000);
  });

  it('carência: 1ª parcela em 60 dias capitaliza juros do mês extra e aumenta a parcela', async () => {
    const { simulate } = await import('../dist/lib/financing.js');
    const a = simulate(baseInput());
    const b = simulate({ ...baseInput(), firstInstallmentDays: 60 });
    assert.ok(b.installmentCents > a.installmentCents);
    assert.ok(Math.abs(b.installmentCents / a.installmentCents - 1.0197) < 0.003);
    assert.equal(b.schedule[0].dueDate, '2026-12-19');
    assert.equal(b.schedule.at(-1).balanceCents, 0);
    assert.ok(b.cetMonthlyPct > 1.97);
    assert.throws(() => simulate({ ...baseInput(), firstInstallmentDays: 20 }), /30 e 120/);
  });

  it('valida entrada, prazo, taxa e valor do veículo com mensagens claras', async () => {
    const { simulate, FinancingError } = await import('../dist/lib/financing.js');
    const bad = (patch, code) => assert.throws(() => simulate({ ...baseInput(), ...patch }), (e) => e instanceof FinancingError && e.code === code);
    bad({ vehicleValueCents: 100 }, 'SIM_VEHICLE_VALUE');
    bad({ downPaymentCents: 7_900_000 }, 'SIM_DOWN_PAYMENT');
    bad({ months: 3 }, 'SIM_MONTHS');
    bad({ months: 90 }, 'SIM_MONTHS');
    bad({ modality: 'LEASING', months: 12, residualPct: 10 }, 'SIM_MONTHS');
    bad({ monthlyRatePct: 0 }, 'SIM_RATE');
    bad({ modality: 'LEASING', residualPct: 80 }, 'SIM_RESIDUAL');
  });

  it('taxa de mercado: leasing PF cai para a média de leasing PJ com aviso', async () => {
    useTestEnv();
    const { marketRate } = await import('../dist/financingSettings.js');
    const s = { rates: { cdcPf: 1.97, cdcPj: 1.45, leasingPf: null, leasingPj: 1.37 } };
    assert.deepEqual(marketRate(s, 'CDC', 'PF'), { pct: 1.97, note: null });
    assert.equal(marketRate(s, 'LEASING', 'PJ').pct, 1.37);
    const pf = marketRate(s, 'LEASING', 'PF');
    assert.equal(pf.pct, 1.37); assert.match(pf.note, /pouco|raro/i);
  });
});

describe('simulador de financiamento: API, PDF e painel', integration, () => {
  let pool; let server; let fin; let cont; let token;
  const pub = (path, opts = {}) => hostRequest(server.base, path, opts);
  const body = (patch = {}) => ({ modality: 'CDC', personType: 'PF', vehicleKind: 'CAR', condition: 'USED', vehicleValueCents: 6_000_000, downPaymentCents: 1_500_000, months: 48, ...patch });

  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    await pool.query(`ALTER TABLE financing_simulations ADD COLUMN IF NOT EXISTS output jsonb`);
    // estado conhecido: as taxas iniciais da migration (um teste anterior pode ter mexido nelas)
    await pool.query(`UPDATE financing_settings SET cdc_pf_pct=1.97, cdc_pj_pct=1.45, leasing_pj_pct=1.37, leasing_pf_pct=NULL, rates_reference_month='2026-08', rates_source='Banco Central do Brasil (SGS 25471, 25447, 25450)', fee_cadastro_cents=60000, fee_avaliacao_cents=40000, fee_registro_cents=25000 WHERE id=1`);
    server = await startServer({ ADMIN_HOSTS: 'admin.placanamao.test' });
    fin = await adminSession({ server, pool, role: 'FINANCEIRO' });
    cont = await adminSession({ server, pool, role: 'CONTEUDO' });
    token = (await pub('/api/auth/register', { method: 'POST', body: { name: 'Carla Dias', email: `${uid('sim')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } })).json.token;
  });
  after(async () => { await server.stop(); await pool.end(); });

  it('config pública traz taxas de mercado, limites e tarifas de referência', async () => {
    const r = await pub('/api/simulator/config');
    assert.equal(r.status, 200);
    assert.ok(r.json.rates.cdc.PF.pct > 0.5 && r.json.rates.cdc.PF.pct < 6);
    assert.ok(r.json.rates.leasing.PF.note);               // PF cai para a média de PJ
    assert.equal(r.json.limits.leasingMonths.min, 24);
    assert.ok(r.json.vehicleKinds.some((k) => k.key === 'TRUCK'));
    assert.ok(r.json.referenceMonth);
  });

  it('visitante simula CDC, leasing e os dois ao mesmo tempo', async () => {
    const a = await pub('/api/simulator/calculate', { method: 'POST', body: body() });
    assert.equal(a.status, 200, a.text);
    assert.equal(a.json.results.cdc.months, 48);
    assert.equal(a.json.results.cdc.schedule.length, 48);
    assert.equal(a.json.rates.cdc.custom, false);
    assert.equal(a.json.results.leasing, undefined);

    const c = await pub('/api/simulator/calculate', { method: 'POST', body: body({ ratePct: 2.5 }) });
    assert.equal(c.json.rates.cdc.pct, 2.5); assert.equal(c.json.rates.cdc.custom, true);
    assert.ok(c.json.results.cdc.installmentCents > a.json.results.cdc.installmentCents);

    const both = await pub('/api/simulator/calculate', { method: 'POST', body: body({ modality: 'BOTH', residualPct: 25, vehicleKind: 'TRUCK', personType: 'PJ' }) });
    assert.ok(both.json.results.cdc && both.json.results.leasing);
    assert.equal(both.json.results.leasing.residualCents, 1_500_000);

    // 12 meses: CDC ok, leasing recusado, sem derrubar o resultado
    const short = await pub('/api/simulator/calculate', { method: 'POST', body: body({ modality: 'BOTH', months: 12 }) });
    assert.equal(short.status, 200);
    assert.ok(short.json.results.cdc); assert.equal(short.json.results.leasing, undefined);
    assert.match(short.json.errors.leasing, /prazo/i);
  });

  it('entrada inválida e campo desconhecido são recusados', async () => {
    const r = await pub('/api/simulator/calculate', { method: 'POST', body: body({ downPaymentCents: 6_000_000 }) });
    assert.equal(r.status, 400); assert.equal(r.json.error, 'SIM_DOWN_PAYMENT'); assert.match(r.json.message, /95%/);
    assert.equal((await pub('/api/simulator/calculate', { method: 'POST', body: { ...body(), hack: 1 } })).status, 400);
    assert.equal((await pub('/api/simulator/calculate', { method: 'POST', body: { vehicleValueCents: 'x' } })).status, 400);
  });

  it('PDF exige conta, devolve um PDF de verdade e registra a simulação', async () => {
    assert.equal((await server.request('/api/simulator/pdf', { method: 'POST', body: body() })).status, 401);
    const res = await server.request('/api/simulator/pdf', { method: 'POST', token, body: body({ modality: 'BOTH', residualPct: 20, firstInstallmentDays: 45, vehicleLabel: 'Fiat Toro Volcano 2022', notes: 'Teste de observação' }) });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/pdf/);
    assert.match(res.headers.get('content-disposition'), /simulacao-financiamento-SIM-[A-Z0-9]{8}\.pdf/);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(buf.length > 8000);
    const rows = await pool.query(`SELECT * FROM financing_simulations ORDER BY created_at DESC LIMIT 1`);
    assert.equal(rows.rows[0].modality, 'BOTH');
    assert.equal(Number(rows.rows[0].vehicle_value_cents), 6_000_000);
    assert.ok(rows.rows[0].user_id);
    // reimpressão: lista as suas simulações e baixa o mesmo PDF pelo código
    const mine = await server.request('/api/simulator/mine', { token });
    const list = await mine.json();
    assert.equal(mine.status, 200);
    assert.ok(list.items.length >= 1);
    const again = await server.request(`/api/simulator/mine/${list.items[0].code}/pdf`, { token });
    assert.equal(again.status, 200);
    assert.equal(Buffer.from(await again.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    assert.equal((await server.request('/api/simulator/mine/SIM-ZZZZZZZZ/pdf', { token })).status, 404);
    assert.equal((await server.request('/api/simulator/mine')).status, 401);
    // um PDF de 84 parcelas também fecha (várias páginas)
    const long = await server.request('/api/simulator/pdf', { method: 'POST', token, body: body({ months: 84 }) });
    assert.equal(long.status, 200);
  });

  it('salvar sem PDF, abrir na tela e excluir: só a própria pessoa enxerga', async () => {
    assert.equal((await server.request('/api/simulator/save', { method: 'POST', body: body() })).status, 401);
    const saved = await server.request('/api/simulator/save', { method: 'POST', token, body: body({ modality: 'BOTH', residualPct: 20, vehicleLabel: 'Honda Civic Hybrid 2024', notes: 'Comparar com o banco' }) });
    assert.equal(saved.status, 201);
    const { code } = await saved.json();
    assert.match(code, /^SIM-[A-Z0-9]{8}$/);
    const one = await server.request(`/api/simulator/mine/${code}`, { token });
    assert.equal(one.status, 200);
    const detail = await one.json();
    assert.equal(detail.input.vehicleLabel, 'Honda Civic Hybrid 2024');
    assert.ok(detail.results.cdc && detail.results.leasing);
    assert.ok(detail.results.cdc.schedule.length > 0);
    assert.ok(detail.referenceMonth);
    // outra pessoa não vê nem apaga
    const other = (await pub('/api/auth/register', { method: 'POST', body: { name: 'Outro Cliente', email: `${uid('sim')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } })).json.token;
    assert.equal((await server.request(`/api/simulator/mine/${code}`, { token: other })).status, 404);
    assert.equal((await server.request(`/api/simulator/mine/${code}`, { method: 'DELETE', token: other })).status, 404);
    assert.equal((await server.request(`/api/simulator/mine/${code}`, { method: 'DELETE', token })).status, 204);
    assert.equal((await server.request(`/api/simulator/mine/${code}`, { token })).status, 404);
    assert.equal((await server.request('/api/simulator/mine/invalido', { token })).status, 404);
  });

  it('painel: financeiro edita taxas e tarifas; conteúdo não mexe; atualização pelo Banco Central usa a série real', async () => {
    assert.equal((await cont.call('/api/admin/simulator/settings')).status, 403);
    const g = await fin.call('/api/admin/simulator/settings');
    assert.equal(g.status, 200);
    const put = await fin.call('/api/admin/simulator/settings', { method: 'PUT', body: { cdcPf: 2.05, fees: { cadastroCents: 50_000, avaliacaoCents: 30_000, registroCents: 20_000 } } });
    assert.equal(put.status, 200, put.text);
    assert.equal(put.json.settings.rates.cdcPf, 2.05);
    assert.equal(put.json.settings.source, 'Informado pela equipe');
    const cfg = await pub('/api/simulator/config');
    assert.equal(cfg.json.rates.cdc.PF.pct, 2.05);
    assert.equal(cfg.json.fees.cadastroCents, 50_000);
    assert.equal((await fin.call('/api/admin/simulator/settings', { method: 'PUT', body: { cdcPf: 99 } })).status, 400);

    // atualização automática com resposta simulada do BCB (sem rede)
    const { refreshRatesFromBcb, loadFinancingSettings } = await import('../dist/financingSettings.js');
    const fake = async (url) => {
      const code = Number(String(url).match(/sgs\.(\d+)/)[1]);
      const val = { 25471: '1.97', 25447: '1.45', 25450: '1.37', 25474: '0.00' }[code];
      return new Response(JSON.stringify([{ data: '01/07/2026', valor: '1.90' }, { data: '01/08/2026', valor: val }]), { status: 200 });
    };
    const ok = await refreshRatesFromBcb(fake);
    assert.equal(ok.ok, true);
    const s = await loadFinancingSettings();
    assert.equal(s.rates.cdcPf, 1.97); assert.equal(s.rates.leasingPf, 1.9); // série PF zerada em agosto: usa o último valor positivo
    assert.equal(s.referenceMonth, '2026-08');
    await new Promise((r) => setTimeout(r, 20));
    const down = await refreshRatesFromBcb(async () => new Response('x', { status: 503 }));
    assert.equal(down.ok, false);
    assert.equal((await loadFinancingSettings()).rates.cdcPf, 1.97);   // mantém o último valor
  });

  it('painel: lista as simulações dos clientes com estatísticas', async () => {
    const r = await fin.call('/api/admin/simulator/simulations');
    assert.equal(r.status, 200);
    assert.ok(r.json.stats.total >= 2);
    assert.ok(r.json.items[0].code.startsWith('SIM-'));
    assert.equal(r.json.items[0].customer.name, 'Carla Dias');
    assert.equal((await cont.call('/api/admin/simulator/simulations')).status, 403);
  });
});
