import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, useTestEnv } from './helpers/db.mjs';
import { hostRequest, startServer } from './helpers/server.mjs';

useTestEnv();
const { ratesProvenance, SOURCE_INTERNAL, refreshRatesFromBcb, loadFinancingSettings } = await import('../dist/financingSettings.js');
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
