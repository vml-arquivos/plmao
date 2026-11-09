import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, useTestEnv } from './helpers/db.mjs';
import { hostRequest, startServer } from './helpers/server.mjs';

useTestEnv();
const { ratesProvenance, SOURCE_INTERNAL, refreshRatesFromBcb, loadFinancingSettings, chooseRates, marketAveragesFromBankRows, syncBanksFromRates, bankDisplayName, AUTO_BANK_NOTE } = await import('../dist/financingSettings.js');
const base = { rates: { cdcPf: 1.97, cdcPj: 1.45, leasingPf: null, leasingPj: 1.37 }, referenceMonth: '2026-08', source: 'Banco Central do Brasil (SGS 25471, 25447, 25450)', autoRefresh: true, refreshedAt: null, refreshError: null, banksRefreshedAt: null, banksRefreshError: null, fees: {}, iof: {}, updatedAt: '' };
const NOW = new Date('2026-11-09T12:00:00Z');

describe('origem e idade da taxa de referência do simulador', () => {
  it('sem coleta do Banco Central, a taxa é interna (estimativa) e nunca "do Banco Central"', () => {
    assert.equal(ratesProvenance(base, NOW).origin, 'INTERNAL');
    assert.equal(ratesProvenance({ ...base, refreshedAt: '2026-11-08T10:00:00Z' }, NOW).origin, 'BCB');
    assert.equal(ratesProvenance({ ...base, source: 'Informado pela equipe' }, NOW).origin, 'MANUAL');
  });
  it('4 meses ou mais atrás = atrasada; o mês de referência e a data de coleta ficam separados', () => {
    const fresh = ratesProvenance({ ...base, referenceMonth: '2026-09', refreshedAt: '2026-11-08T10:00:00Z' }, NOW);
    assert.deepEqual([fresh.monthsBehind, fresh.stale, fresh.collectedAt], [2, false, '2026-11-08T10:00:00Z']);
    const old = ratesProvenance({ ...base, referenceMonth: '2026-02', refreshedAt: '2026-02-20T10:00:00Z', refreshError: 'BCB_HTTP_503' }, NOW);
    assert.deepEqual([old.monthsBehind, old.stale, old.refreshFailed], [9, true, true]);
  });
});

const row = (segment, modality, institution, monthlyPct, period = '2026-11-02') => ({ segment, modality, institution, monthlyPct, annualPct: null, position: 1, period });
const pt = (date, value) => ({ date, value });

describe('taxa atual: série mensal parada x taxas por instituição do Banco Central', () => {
  it('média das instituições do período mais recente; menos de 3 instituições não vira média de mercado', () => {
    const avg = marketAveragesFromBankRows([
      row('PF', 'CDC', 'A', 1.8), row('PF', 'CDC', 'B', 2.0), row('PF', 'CDC', 'C', 2.2), row('PF', 'CDC', 'D', 9, '2026-10-05'),
      row('PJ', 'CDC', 'A', 1.5), row('PJ', 'CDC', 'B', 1.6),
      row('PJ', 'LEASING', 'A', 1.3), row('PJ', 'LEASING', 'B', 1.4), row('PJ', 'LEASING', 'C', 1.5)
    ]);
    assert.deepEqual(avg.cdcPf, { date: '2026-11', value: 2 });
    assert.equal(avg.cdcPj, undefined);
    assert.deepEqual(avg.leasingPj, { date: '2026-11', value: 1.4 });
  });
  it('série oficial parada em 02/2026: usa a média das instituições e o mês de referência fica atual', () => {
    const c = chooseRates(
      { cdcPf: pt('2026-02', 1.9), cdcPj: pt('2026-02', 1.4), leasingPj: pt('2026-02', 1.3), leasingPf: pt('2026-02', 1.8) },
      { cdcPf: pt('2026-11', 2.05), cdcPj: pt('2026-11', 1.55), leasingPj: pt('2026-11', 1.35) });
    assert.deepEqual([c.cdcPf, c.cdcPj, c.leasingPj, c.month], [2.05, 1.55, 1.35, '2026-11']);
    assert.equal(c.leasingPf, null, 'leasing PF parado não é reaproveitado');
    assert.match(c.source, /instituição/);
  });
  it('série oficial em dia continua sendo a escolhida; sem nenhum dado, não inventa', () => {
    const c = chooseRates(
      { cdcPf: pt('2026-09', 1.97), cdcPj: pt('2026-09', 1.45), leasingPj: pt('2026-09', 1.37), leasingPf: null },
      { cdcPf: pt('2026-11', 2.05), cdcPj: pt('2026-11', 1.55), leasingPj: pt('2026-11', 1.35) });
    assert.deepEqual([c.cdcPf, c.month, c.source], [1.97, '2026-09', 'Banco Central do Brasil (SGS 25471, 25447, 25450)']);
    assert.equal(chooseRates({ cdcPf: null, cdcPj: null, leasingPj: null, leasingPf: null }, {}), null);
  });
});

describe('todas as instituições do Banco Central entram na comparação', () => {
  it('nomes para exibir', () => {
    assert.equal(bankDisplayName('BCO C6 S.A.'), 'C6 Bank');
    assert.equal(bankDisplayName('BV FINANCEIRA S.A. CFI'), 'BV Financeira');
    assert.equal(bankDisplayName('BCO DAYCOVAL S.A.'), 'Banco Daycoval');
  });
});

describe('simulador: referência de taxa na API pública', integration, () => {
  let server, pool;
  before(async () => { ({ pool } = await loadCore()); server = await startServer(); });
  after(async () => {
    await pool.query(`UPDATE financing_settings SET cdc_pf_pct=1.97, cdc_pj_pct=1.45, leasing_pj_pct=1.37, leasing_pf_pct=NULL, rates_reference_month='2026-08', rates_source='Banco Central do Brasil (SGS 25471, 25447, 25450)', rates_refreshed_at=NULL, rates_refresh_error=NULL WHERE id=1`);
    await server.stop(); await pool.end();
  });
  const config = async () => (await hostRequest(server.base, '/api/simulator/config')).json;

  it('taxa de fábrica aparece como referência interna; coleta com sucesso vira Banco Central com a data da coleta', async () => {
    await pool.query(`UPDATE financing_settings SET rates_reference_month='2026-02', rates_source='Banco Central do Brasil (SGS 25471, 25447, 25450)', rates_refreshed_at=NULL, rates_refresh_error=NULL WHERE id=1`);
    let c = await config();
    assert.equal(c.ratesStatus.origin, 'INTERNAL');
    assert.equal(c.source, SOURCE_INTERNAL);
    assert.equal(c.referenceMonth, '2026-02');
    const fake = async (url) => {
      const code = Number(String(url).match(/sgs\.(\d+)/)[1]);
      return new Response(JSON.stringify([{ data: '01/09/2026', valor: { 25471: '2.01', 25447: '1.5', 25450: '1.4', 25474: '0.00' }[code] }]), { status: 200 });
    };
    assert.equal((await refreshRatesFromBcb(fake)).ok, true);
    c = await config();
    assert.equal(c.ratesStatus.origin, 'BCB');
    assert.equal(c.referenceMonth, '2026-09');
    assert.ok(c.ratesStatus.collectedAt);
    assert.match(c.source, /^Banco Central/);
  });

  it('coleta com a série oficial parada usa as taxas por instituição e o mês de referência fica atual', async () => {
    await new Promise((r) => setTimeout(r, 20));
    const json = (value) => new Response(JSON.stringify({ value }), { status: 200 });
    const fake = async (url) => {
      const u = decodeURIComponent(String(url));
      if (u.includes('sgs.')) return new Response(JSON.stringify([{ data: '01/02/2026', valor: '1.90' }]), { status: 200 });
      if (u.includes('ParametrosConsulta')) return json([
        { segmento: 'PESSOA FÍSICA', modalidade: 'Aquisição de veículos - Prefixado' },
        { segmento: 'PESSOA JURÍDICA', modalidade: 'Aquisição de veículos - Prefixado' },
        { segmento: 'PESSOA JURÍDICA', modalidade: 'Arrendamento mercantil de veículos - Prefixado' }]);
      const v = /PESSOA JURÍDICA/.test(u) ? (/Arrendamento/.test(u) ? [1.3, 1.4, 1.5] : [1.5, 1.6, 1.7]) : [1.9, 2.0, 2.1];
      return json(v.map((x, i) => ({ InicioPeriodo: '2026-11-02', InstituicaoFinanceira: `BANCO ${i}`, TaxaJurosAoMes: x, TaxaJurosAoAno: 20, Posicao: i + 1 })));
    };
    assert.equal((await refreshRatesFromBcb(fake)).ok, true);
    const c = await config();
    assert.equal(c.referenceMonth, '2026-11');
    assert.equal(c.rates.cdc.PF.pct, 2);
    assert.match(c.source, /^Banco Central/);
  });

  it('instituição nova do Banco Central vira banco da comparação (C6 Bank) sem duplicar as já cadastradas', async () => {
    const mk = (institution) => ({ segment: 'PF', modality: 'CDC', institution, monthlyPct: 1.9, annualPct: 25, position: 1, period: '2026-11-02' });
    const rows = [mk('BCO C6 S.A.'), mk('BV FINANCEIRA S.A. CFI'), mk('BCO SANTANDER (BRASIL) S.A.')];
    try {
      assert.equal(await syncBanksFromRates(rows), 1);
      const c6 = (await pool.query(`SELECT name, active, notes FROM financing_banks WHERE name='C6 Bank'`)).rows[0];
      assert.deepEqual([c6.active, c6.notes], [true, AUTO_BANK_NOTE]);
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM financing_banks WHERE name ILIKE '%BV%' OR name ILIKE '%Santander%'`)).rows[0].n, 2, 'BV e Santander já existiam');
      assert.equal(await syncBanksFromRates(rows), 0, 'segunda coleta não duplica');
    } finally { await pool.query(`DELETE FROM financing_banks WHERE name='C6 Bank'`); }
  });

  it('falha do Banco Central preserva a última taxa e o período real, avisa sem expor o motivo e não inventa data', async () => {
    const before = await config();
    await new Promise((r) => setTimeout(r, 20));
    const down = await refreshRatesFromBcb(async () => new Response('erro interno com detalhe secreto', { status: 503 }));
    assert.equal(down.ok, false);
    const after = await config();
    assert.equal(after.referenceMonth, before.referenceMonth, 'mantém o período real');
    assert.deepEqual(after.rates, before.rates, 'mantém as taxas');
    assert.equal(after.ratesStatus.refreshFailed, true);
    assert.ok(!JSON.stringify(after).includes('BCB_HTTP_503') && !JSON.stringify(after).includes('secreto'), 'motivo técnico não vai para o público');
    assert.equal((await loadFinancingSettings()).refreshError, 'BCB_HTTP_503', 'o motivo fica registrado para o painel');
  });
});
