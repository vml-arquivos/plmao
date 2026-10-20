import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, useTestEnv } from './helpers/db.mjs';
import { adminSession, startServer } from './helpers/server.mjs';

describe('checklist de implantação financeira', integration, () => {
  let pool; let server; let sa;
  before(async () => {
    useTestEnv(); ({ pool } = await loadCore());
    server = await startServer({ ADMIN_HOSTS: 'admin.placanamao.test' });
    sa = await adminSession({ server, pool, role: 'SUPER_ADMIN' });
  });
  after(async () => { await server.stop(); await pool.end(); });

  it('aponta custo de provedor ausente e ciência fiscal como bloqueios', async () => {
    await pool.query(`UPDATE payment_settings SET fiscal_acknowledged_at=NULL WHERE id=1`);
    await pool.query(`UPDATE query_products SET provider_cost_cents=NULL,supplier_cost_cents=0 WHERE id='COMPLETE'`);
    const r = await sa.call('/api/admin/finance/setup-checklist');
    assert.equal(r.status, 200);
    assert.equal(r.json.ready, false);
    const byKey = Object.fromEntries(r.json.items.map((i) => [i.key, i]));
    assert.equal(byKey.fiscal.ok, false);
    assert.equal(byKey['cost:COMPLETE'].ok, false);
    assert.equal(byKey['cost:COMPLETE'].severity, 'BLOCKER');
    assert.match(r.json.fiscalWarning, /contador/);
  });
});
