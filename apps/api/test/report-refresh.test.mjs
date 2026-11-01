import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { hostRequest, startServer } from './helpers/server.mjs';

// Relatório gravado com máscara (servidor em modo protegido) é refeito em claro a partir do bruto cifrado.
describe('relatórios antigos mascarados são refeitos em claro', integration, () => {
  let pool; let server; let token; let queryId;
  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    server = await startServer({ REPORT_SHOW_OWNER_IDENTITY: 'false' });
    const reg = await hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { name: 'Cliente Antigo', email: `${uid('rfr')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    token = reg.json.token;
    await pool.query('UPDATE wallets SET balance_cents=100000 WHERE user_id=$1', [reg.json.user.id]);
    const r = await hostRequest(server.base, '/api/queries', { method: 'POST', token, body: { plate: 'DEV1B11', productId: 'COMPLETE' } });
    assert.equal(r.status, 201, r.text);
    queryId = r.json.id;
  });
  after(async () => { await server.stop(); await pool.end(); });

  it('grava mascarado no modo protegido e, com o padrão em claro, a rotina refaz o relatório', async () => {
    const stored = async () => (await pool.query('SELECT normalized::text AS n FROM vehicle_query_results WHERE query_id=$1', [queryId])).rows[0].n;
    assert.match(await stored(), /"masked": ?true/);
    const { refreshMaskedReports } = await import('../dist/lib/reportRefresh.js');
    process.env.REPORT_SHOW_OWNER_IDENTITY = 'false';
    try { await refreshMaskedReports(); assert.match(await stored(), /"masked": ?true/, 'protegido: o relatório continua protegido'); } finally { delete process.env.REPORT_SHOW_OWNER_IDENTITY; }
    const out = await refreshMaskedReports();
    assert.ok(out.refreshed >= 1 && out.failed === 0, JSON.stringify(out));
    const after = await stored();
    assert.doesNotMatch(after, /"masked": ?true/);
    assert.match(after, /PROPRIETARIO FICTICIO/);
    assert.deepEqual(await refreshMaskedReports(), { refreshed: 0, failed: 0 }, 'rodar de novo não faz nada');
  });

  it('consulta antiga de versão anterior ganha os campos novos (busca e apreensão) a partir do bruto', async () => {
    const { refreshStaleReports } = await import('../dist/lib/reportRefresh.js');
    await pool.query("UPDATE vehicle_query_results SET normalizer_version=2, normalized=jsonb_set(normalized,'{v2,sections}','[]'::jsonb) WHERE query_id=$1", [queryId]);
    const out = await refreshStaleReports();
    assert.ok(out.refreshed >= 1 && out.failed === 0, JSON.stringify(out));
    const row = (await pool.query('SELECT normalized::text AS n, normalizer_version AS v FROM vehicle_query_results WHERE query_id=$1', [queryId])).rows[0];
    assert.equal(row.v, 3);
    assert.match(row.n, /RES_BUSCA_APREENSAO/);
    assert.match(row.n, /GR_SITUACAO/);
  });
});
