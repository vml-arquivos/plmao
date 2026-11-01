import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, useTestEnv } from './helpers/db.mjs';
import { adminSession, startServer } from './helpers/server.mjs';

describe('consulta interna do painel: sem repetição e com motivo claro', integration, () => {
  let pool; let server; let adm;
  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    server = await startServer();
    adm = await adminSession({ server, pool, role: 'SUPER_ADMIN' });
  });
  after(async () => { await server.stop(); await pool.end(); });
  const lookup = (plate) => adm.call('/api/admin/lookups', { method: 'POST', body: { plate, productId: 'LIEN' } });

  it('duas consultas iguais ao mesmo tempo: só uma chega à fonte, a outra recebe 409', async () => {
    const [a, b] = await Promise.all([lookup('SLW0E00'), lookup('SLW0E00')]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 409], `${a.text} | ${b.text}`);
    const blocked = a.status === 409 ? a : b;
    assert.equal(blocked.json.error, 'QUERY_IN_PROGRESS');
    // depois que a primeira termina, a trava é solta
    const again = await lookup('SLW0E00');
    assert.equal(again.status, 200, again.text);
  });

  it('a consulta interna devolve o relatório do pacote e o PDF pronto (não só o JSON)', async () => {
    const r = await lookup('SLW0E00');
    assert.equal(r.status, 200, r.text);
    assert.ok(r.json.report, 'relatório estruturado');
    assert.ok(r.json.report.sections.length > 0);
    assert.ok(r.json.pdfBase64, 'PDF em base64');
    assert.equal(Buffer.from(r.json.pdfBase64, 'base64').subarray(0, 5).toString(), '%PDF-');
    assert.match(r.json.pdfName, /\.pdf$/);
  });

  it('PDF de uma consulta já feita, pelo painel da equipe', async () => {
    const q = await pool.query("SELECT q.id FROM vehicle_queries q JOIN vehicle_query_results r ON r.query_id=q.id WHERE q.status='SUCCESS' AND r.normalized->'v2' IS NOT NULL LIMIT 1");
    if (!q.rowCount) return;
    const res = await adm.call(`/api/admin/queries/${q.rows[0].id}/report/pdf`);
    assert.equal(res.status, 200);
  });

  it('falha da fonte aparece com mensagem específica, e não como erro genérico', async () => {
    const timeout = await lookup('TIM0E00');
    assert.equal(timeout.status, 424, timeout.text);
    assert.equal(timeout.json.error, 'PROVIDER_TIMEOUT');
    assert.match(timeout.json.message, /não repita sem conferir/);
    const missing = await lookup('ZZZ9Z99');
    assert.equal(missing.status, 404, missing.text);
    assert.match(missing.json.message, /não encontrou dados/);
  });
});
