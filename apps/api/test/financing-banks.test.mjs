import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

useTestEnv();
const bank = (o = {}) => ({ id: 'b1', name: 'Banco X', bcbMatch: 'BRADESCO', cdcPfPct: null, cdcPjPct: null, leasingPjPct: null, fees: { cadastroCents: null, avaliacaoCents: null, registroCents: null }, notes: '', active: true, displayOrder: 0, updatedAt: '', ...o });
const rate = (o = {}) => ({ segment: 'PF', modality: 'CDC', institution: 'BCO BRADESCO FINANC. S.A.', monthlyPct: 1.8, annualPct: 23.8, position: 5, period: '2026-10-05', ...o });

describe('bancos: casamento de nomes e escolha da taxa', () => {
  it('normaliza acento e pontuação e exige palavras inteiras', async () => {
    const { normalizeName, matchInstitution } = await import('../dist/lib/bankRates.js');
    assert.equal(normalizeName('BCO SANTANDER (BRASIL) S.A.'), 'BCO SANTANDER BRASIL S A');
    assert.equal(normalizeName('Itaú Unibanco'), 'ITAU UNIBANCO');
    assert.ok(matchInstitution('itaú', 'ITAÚ UNIBANCO S.A.'));
    assert.ok(matchInstitution('DO BRASIL', 'BCO DO BRASIL S.A.'));
    assert.ok(!matchInstitution('PAN', 'BANCO PANAMBY S.A.'));
    assert.ok(matchInstitution('PAN', 'BANCO PAN S.A.'));
    assert.ok(!matchInstitution('', 'QUALQUER'));
  });

  it('a taxa informada pela equipe vence a do Banco Central; sem nenhuma, o banco não tem taxa', async () => {
    const { pickBankRate } = await import('../dist/lib/bankRates.js');
    const rates = [rate(), rate({ institution: 'BRADESCO S.A.', monthlyPct: 2.5, position: 1 }), rate({ segment: 'PJ', monthlyPct: 1.2 }), rate({ modality: 'LEASING', segment: 'PJ', monthlyPct: 1.4 })];
    const a = pickBankRate(bank(), 'CDC', 'PF', rates);
    assert.equal(a.source, 'bcb'); assert.equal(a.pct, 2.5); assert.equal(a.institution, 'BRADESCO S.A.'); // menor posição
    assert.equal(pickBankRate(bank(), 'CDC', 'PJ', rates).pct, 1.2);
    assert.equal(pickBankRate(bank(), 'LEASING', 'PJ', rates).pct, 1.4);
    assert.equal(pickBankRate(bank(), 'LEASING', 'PF', rates), null); // leasing PF não existe
    const m = pickBankRate(bank({ cdcPfPct: 1.5 }), 'CDC', 'PF', rates);
    assert.deepEqual([m.source, m.pct], ['manual', 1.5]);
    assert.equal(pickBankRate(bank({ bcbMatch: 'ITAU' }), 'CDC', 'PF', rates), null);
  });
});

describe('bancos: leitura do Banco Central (Olinda) e comparação', () => {
  it('descobre a modalidade de veículos nos parâmetros e fica com o período mais recente, uma linha por instituição', async () => {
    const { pickBankTargets, latestBankRows } = await import('../dist/financingSettings.js');
    const targets = pickBankTargets([
      { segmento: 'PESSOA FÍSICA', modalidade: 'Cheque especial - Prefixado' },
      { segmento: 'PESSOA FÍSICA', modalidade: 'Aquisição de veículos - Prefixado' },
      { segmento: 'PESSOA FÍSICA', modalidade: 'Arrendamento mercantil de veículos - Prefixado' },
      { segmento: 'PESSOA JURÍDICA', modalidade: 'Aquisição de veículos - Prefixado' },
      { segmento: 'PESSOA JURÍDICA', modalidade: 'Aquisição de veículos - Pós-fixado referenciado em juros flutuantes' }
    ]);
    assert.deepEqual(targets.map((t) => `${t.segment}/${t.modality}`), ['PF/CDC', 'PF/LEASING', 'PJ/CDC']);
    assert.equal(targets[0].modalidade, 'Aquisição de veículos - Prefixado');
    const rows = latestBankRows([
      { InicioPeriodo: '2026-09-28', InstituicaoFinanceira: 'BCO A', TaxaJurosAoMes: 1.9, Posicao: 3 },
      { InicioPeriodo: '2026-10-05', InstituicaoFinanceira: 'BCO A', TaxaJurosAoMes: 1.7, Posicao: 2 },
      { InicioPeriodo: '2026-10-05', InstituicaoFinanceira: 'BCO A', TaxaJurosAoMes: 1.8, Posicao: 9 },
      { InicioPeriodo: '2026-10-05', InstituicaoFinanceira: 'BCO B', TaxaJurosAoMes: 0, Posicao: 1 },
      { InicioPeriodo: '2026-10-05', InstituicaoFinanceira: 'BCO C', TaxaJurosAoMes: '2,10', TaxaJurosAoAno: 28.3, Posicao: 4 }
    ], 'PF', 'CDC');
    assert.deepEqual(rows.map((r) => [r.institution, r.monthlyPct, r.period]), [['BCO A', 1.7, '2026-10-05'], ['BCO C', 2.1, '2026-10-05']]);
  });

  it('runBankComparison: ordena pelo menor CET, usa tarifas do banco e deixa de fora banco sem taxa', async () => {
    const { runBankComparison, simulationBody } = await import('../dist/simulator/service.js');
    const settings = { rates: { cdcPf: 1.97, cdcPj: 1.45, leasingPf: null, leasingPj: 1.37 }, fees: { cadastroCents: 60_000, avaliacaoCents: 40_000, registroCents: 25_000 }, iof: { pfDailyPct: 0.0082, pjDailyPct: 0.0041, additionalPct: 0.38, capDays: 365 } };
    const body = simulationBody.parse({ vehicleValueCents: 8_000_000, downPaymentCents: 2_000_000, months: 48, condition: 'USED' });
    const banks = [
      bank({ id: 'a', name: 'Caro', bcbMatch: '', cdcPfPct: 2.4 }),
      bank({ id: 'b', name: 'Barato', bcbMatch: '', cdcPfPct: 1.5, fees: { cadastroCents: 0, avaliacaoCents: 0, registroCents: 0 } }),
      bank({ id: 'c', name: 'Sem taxa', bcbMatch: 'NADA' })
    ];
    const offers = runBankComparison(body, settings, banks, []);
    assert.deepEqual(offers.map((o) => o.name), ['Barato', 'Caro']);
    assert.equal(offers[0].ownFees, true);
    assert.equal(offers[0].feesTotalCents, 0);
    assert.ok(offers[1].feesTotalCents > 0); // tarifas de referência
    assert.ok(offers[0].installmentCents < offers[1].installmentCents);
    // cliente que digita a própria tarifa manda mais que a do banco
    const forced = runBankComparison(simulationBody.parse({ ...body, fees: { cadastroCents: 10_000, avaliacaoCents: 0, registroCents: 0 } }), settings, banks, []);
    assert.equal(forced.find((o) => o.name === 'Barato').feesTotalCents, 10_000);
    // leasing PF: banco só com taxa de CDC não aparece; prazo fora do limite também não
    assert.equal(runBankComparison(simulationBody.parse({ ...body, modality: 'LEASING' }), settings, banks, []).length, 0);
    assert.equal(runBankComparison(simulationBody.parse({ ...body, months: 12 , modality: 'BOTH' }), settings, banks, []).length, 2);
  });
});

describe('bancos: API, painel e PDF', integration, () => {
  let server; let pool; let fin; let user;
  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    server = await startServer();
    fin = await adminSession({ server, pool, role: 'FINANCEIRO' });
    user = { token: (await server.request('/api/auth/register', { method: 'POST', body: { name: 'Carla Dias', email: `${uid('bk')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } }).then((r) => r.json())).token };
    await pool.query('DELETE FROM financing_bank_rates');
  });
  after(async () => { await server?.stop(); await pool?.end(); });
  const pub = (path, opts) => hostRequest(server.base, path, opts);

  it('a migration cadastra os bancos comuns sem taxa própria', async () => {
    const r = await fin.call('/api/admin/simulator/banks');
    assert.equal(r.status, 200);
    const names = r.json.items.map((b) => b.name);
    for (const n of ['Banco do Brasil', 'Bradesco', 'Itaú', 'Santander']) assert.ok(names.includes(n), n);
    assert.ok(r.json.items.every((b) => b.cdcPfPct === null || typeof b.cdcPfPct === 'number'));
  });

  it('painel cria, edita e apaga banco; valida e protege por permissão', async () => {
    const nome = `Banco Teste ${uid('x')}`;
    const created = await fin.call('/api/admin/simulator/banks', { method: 'POST', body: { name: nome, bcbMatch: '', cdcPfPct: 1.55, cdcPjPct: 1.2, feeCadastroCents: 0 } });
    assert.equal(created.status, 201, created.text);
    const id = created.json.id;
    assert.equal((await fin.call('/api/admin/simulator/banks', { method: 'POST', body: { name: nome.toUpperCase() } })).status, 409);
    assert.equal((await fin.call('/api/admin/simulator/banks', { method: 'POST', body: { name: 'Ruim', cdcPfPct: 99 } })).status, 400);
    assert.equal((await fin.call('/api/admin/simulator/banks', { method: 'POST', body: { name: 'Ruim2', inventado: 1 } })).status, 400);
    const put = await fin.call(`/api/admin/simulator/banks/${id}`, { method: 'PUT', body: { cdcPfPct: 1.6, notes: 'Condição de outubro' } });
    assert.equal(put.status, 200, put.text);
    const list = await fin.call('/api/admin/simulator/banks');
    const mine = list.json.items.find((b) => b.id === id);
    assert.equal(mine.cdcPfPct, 1.6);
    assert.equal(mine.current.cdcPf.source, 'manual');
    assert.equal(mine.fees.cadastroCents, 0);
    const cont = await adminSession({ server, pool, role: 'CONTEUDO' });
    assert.equal((await cont.call('/api/admin/simulator/banks')).status, 403);
    assert.equal((await fin.call(`/api/admin/simulator/banks/${id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await fin.call(`/api/admin/simulator/banks/${id}`, { method: 'DELETE' })).status, 404);
  });

  it('o simulador devolve a comparação entre bancos; PDF inclui e reimpressão mantém', async () => {
    await pool.query(`DELETE FROM financing_banks WHERE name LIKE '% QA'`);
    await pool.query(`UPDATE financing_banks SET active=false`);
    const mk = async (name, body) => (await fin.call('/api/admin/simulator/banks', { method: 'POST', body: { name, ...body } })).json.id;
    await mk('Banco Alfa QA', { cdcPfPct: 1.6, feeCadastroCents: 0, feeAvaliacaoCents: 0, feeRegistroCents: 0 });
    await mk('Banco Beta QA', { cdcPfPct: 2.2 });
    await mk('Banco Sem Taxa QA', { bcbMatch: 'ZZZ' });
    const body = { modality: 'CDC', personType: 'PF', vehicleKind: 'CAR', condition: 'USED', vehicleValueCents: 8_000_000, downPaymentCents: 2_000_000, months: 48 };
    const calc = await pub('/api/simulator/calculate', { method: 'POST', body });
    assert.equal(calc.status, 200, calc.text);
    assert.deepEqual(calc.json.banks.map((b) => b.name), ['Banco Alfa QA', 'Banco Beta QA']);
    assert.equal(calc.json.banks[0].rateSource, 'manual');
    assert.equal(calc.json.banks[0].schedule, undefined); // sem a tabela de parcelas
    assert.ok(calc.json.banks[0].installmentCents < calc.json.banks[1].installmentCents);

    const pdf = await fetch(`${server.base}/api/simulator/pdf`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${user.token}` }, body: JSON.stringify(body) });
    assert.equal(pdf.status, 200);
    const buf = Buffer.from(await pdf.arrayBuffer());
    assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
    const code = /SIM-[A-Z0-9]{8}/.exec(pdf.headers.get('content-disposition'))[0];
    const saved = await pool.query('SELECT output FROM financing_simulations WHERE code=$1', [code]);
    assert.equal(saved.rows[0].output.banks.length, 2);
    // mudar a taxa do banco depois não altera a reimpressão
    await pool.query(`UPDATE financing_banks SET cdc_pf_pct=9 WHERE name='Banco Alfa QA'`);
    const again = await fetch(`${server.base}/api/simulator/mine/${code}/pdf`, { headers: { authorization: `Bearer ${user.token}` } });
    assert.equal(again.status, 200);
    const out = (await pool.query('SELECT output FROM financing_simulations WHERE code=$1', [code])).rows[0].output;
    assert.equal(out.banks[0].ratePct, 1.6);
  });

  it('atualização pelo Banco Central grava as taxas por banco e uma falha mantém as anteriores', async () => {
    const { refreshBankRatesFromBcb, loadFinancingSettings } = await import('../dist/financingSettings.js');
    const json = (value) => new Response(JSON.stringify({ value }), { status: 200 });
    const fake = async (url) => {
      const u = decodeURIComponent(String(url));
      if (u.includes('ParametrosConsulta')) return json([{ segmento: 'PESSOA FÍSICA', modalidade: 'Aquisição de veículos - Prefixado' }, { segmento: 'PESSOA FÍSICA', modalidade: 'Cheque especial - Prefixado' }]);
      assert.match(u, /Segmento eq 'PESSOA FÍSICA' and Modalidade eq 'Aquisição de veículos - Prefixado'/);
      return json([
        { InicioPeriodo: '2026-10-05', InstituicaoFinanceira: 'BCO BRADESCO FINANC. S.A.', TaxaJurosAoMes: 1.81, TaxaJurosAoAno: 24.0, Posicao: 6 },
        { InicioPeriodo: '2026-10-05', InstituicaoFinanceira: 'BCO SANTANDER (BRASIL) S.A.', TaxaJurosAoMes: 1.95, TaxaJurosAoAno: 26.0, Posicao: 12 }
      ]);
    };
    const ok = await refreshBankRatesFromBcb(fake);
    assert.deepEqual([ok.ok, ok.count], [true, 2]);
    assert.ok((await loadFinancingSettings()).banksRefreshedAt);
    const list = await fin.call('/api/admin/simulator/banks');
    const brad = list.json.items.find((b) => b.name === 'Bradesco');
    assert.equal(brad.current.cdcPf.pct, 1.81);
    assert.equal(brad.current.cdcPf.source, 'bcb');
    assert.equal(brad.current.cdcPf.institution, 'BCO BRADESCO FINANC. S.A.');
    assert.equal(brad.current.cdcPj, null);
    assert.equal(list.json.items.find((b) => b.name === 'Santander').current.cdcPf.pct, 1.95);
    assert.equal(list.json.bcb.institutions, 2);

    const down = await refreshBankRatesFromBcb(async () => new Response('x', { status: 503 }));
    assert.equal(down.ok, false);
    assert.match((await loadFinancingSettings()).banksRefreshError, /BCB_OLINDA_HTTP_503/);
    const after = await fin.call('/api/admin/simulator/banks');
    assert.equal(after.json.items.find((b) => b.name === 'Bradesco').current.cdcPf.pct, 1.81); // mantém
    assert.equal((await fin.call('/api/admin/simulator/banks/bcb-institutions')).json.items.length, 2);
  });
});
