import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

useTestEnv();

describe('prontidão e checklist de implantação', integration, () => {
  let server, pool, adm;
  before(async () => { ({ pool } = await loadCore()); server = await startServer(); adm = await adminSession({ server, pool, role: 'ADMIN' }); });
  after(async () => { await server.stop(); await pool.end(); });

  it('/ready confirma banco e migrações sem expor configuração; /health segue simples', async () => {
    const r = await hostRequest(server.base, '/ready');
    assert.equal(r.status, 200); assert.equal(r.json.ok, true); assert.equal(r.json.database, 'ok');
    assert.equal(r.json.migrationsApplied, r.json.migrationsExpected);
    assert.deepEqual(Object.keys(r.json).sort(), ['database', 'migrationsApplied', 'migrationsExpected', 'ok']);
    assert.equal((await hostRequest(server.base, '/health')).status, 200);
  });

  it('/ready devolve 503 se faltar migração', async () => {
    const row = (await pool.query(`SELECT id,name FROM schema_migrations WHERE id='034_testimonials'`)).rows[0];
    await pool.query(`DELETE FROM schema_migrations WHERE id='034_testimonials'`);
    try { assert.equal((await hostRequest(server.base, '/ready')).status, 503); }
    finally { await pool.query('INSERT INTO schema_migrations(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING', [row.id, row.name]); }
    assert.equal((await hostRequest(server.base, '/ready')).status, 200);
  });

  it('/ready compara os identificadores: uma migração extra não compensa a que falta', async () => {
    const row = (await pool.query(`SELECT id,name FROM schema_migrations WHERE id='034_testimonials'`)).rows[0];
    await pool.query(`DELETE FROM schema_migrations WHERE id='034_testimonials'`);
    await pool.query(`INSERT INTO schema_migrations(id,name) VALUES('999_extra','extra') ON CONFLICT DO NOTHING`);
    try {
      const r = await hostRequest(server.base, '/ready');
      assert.equal(r.status, 503); assert.deepEqual(r.json.migrationsMissing, ['034_testimonials']);
    } finally {
      await pool.query(`DELETE FROM schema_migrations WHERE id='999_extra'`);
      await pool.query('INSERT INTO schema_migrations(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING', [row.id, row.name]);
    }
  });

  it('checklist inclui contratos, e-mail, fiscal, Mercado Pago, e-assinatura, MFA e taxas, sem segredos', async () => {
    const r = await adm.call('/api/admin/finance/setup-checklist');
    assert.equal(r.status, 200);
    const keys = r.json.items.map((i) => i.key);
    for (const k of ['mfa', 'email', 'email-webhook', 'contract-legal', 'esign', 'fiscal-provider', 'mercadopago', 'vehicle-api', 'cnpj', 'faq', 'sim-rates']) assert.ok(keys.includes(k), k);
    assert.ok(r.json.items.every((i) => i.severity === 'BLOCKER' || i.severity === 'WARNING'));
    assert.doesNotMatch(JSON.stringify(r.json), /Bearer |postgres:\/\//i);
  });
});
