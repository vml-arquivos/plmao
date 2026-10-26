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

  it('avisa quando faltam dados da empresa para o contrato de compra e canais de atendimento', async () => {
    const saved = (await pool.query('SELECT legal_name,cnpj FROM fiscal_settings WHERE id=1')).rows[0];
    try {
      await pool.query(`UPDATE fiscal_settings SET legal_name=NULL,cnpj=NULL WHERE id=1`);
      let byKey = Object.fromEntries((await sa.call('/api/admin/finance/setup-checklist')).json.items.map((i) => [i.key, i]));
      assert.equal(byKey['purchase-contract-company'].ok, false); assert.equal(byKey['purchase-contract-company'].severity, 'BLOCKER');
      assert.equal(byKey['purchase-contract-email'].severity, 'WARNING');
      assert.equal(byKey['support-channels'].ok, false); assert.equal(byKey['raw-retention'].severity, 'WARNING');
      await pool.query(`UPDATE fiscal_settings SET legal_name='EMPRESA TESTE LTDA',cnpj='11222333000181' WHERE id=1`);
      byKey = Object.fromEntries((await sa.call('/api/admin/finance/setup-checklist')).json.items.map((i) => [i.key, i]));
      assert.equal(byKey['purchase-contract-company'].ok, true);
    } finally {
      await pool.query('UPDATE fiscal_settings SET legal_name=$1,cnpj=$2 WHERE id=1', [saved?.legal_name ?? null, saved?.cnpj ?? null]);
    }
  });
});
