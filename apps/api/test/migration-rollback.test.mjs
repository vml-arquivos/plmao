import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import { TEST_DATABASE_URL, integration } from './helpers/db.mjs';

// Banco descartável próprio: nunca toca no banco de testes compartilhado.
const NEW_TABLES = ['report_template_publications', 'email_outbox', 'email_events', 'secure_links', 'cnpj_cache', 'contract_templates', 'contract_template_versions', 'contracts', 'contract_signers', 'contract_events', 'payment_refunds', 'fiscal_jobs', 'fiscal_events', 'support_conversations', 'support_messages', 'support_attachments', 'support_events', 'testimonials', 'testimonial_events'];
const FIRST = '027_report_scope_publications';

describe('migrações 027–034: aplicar, reverter e reaplicar', integration, () => {
  let admin; let url; const name = `plmao_rb_${Date.now().toString(36)}`;
  const cli = (...args) => execFileSync('node', ['apps/api/dist/cli.js', ...args], { env: { ...process.env, DATABASE_URL: url, NODE_ENV: 'test', JWT_SECRET: 'test-jwt-secret-test-jwt-secret-test-jwt-secret-0001', ADMIN_JWT_SECRET: 'test-admin-jwt-secret-test-admin-jwt-secret-0002', DATA_ENCRYPTION_KEY: 'test-data-encryption-key-0123456789abcdef' }, encoding: 'utf8' });
  const tables = async () => { const c = new pg.Client({ connectionString: url }); await c.connect(); const r = await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`); const m = await c.query('SELECT id FROM schema_migrations ORDER BY id'); await c.end(); return { tables: new Set(r.rows.map((x) => x.table_name)), ids: m.rows.map((x) => x.id) }; };
  before(async () => {
    admin = new pg.Client({ connectionString: TEST_DATABASE_URL }); await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    const u = new URL(TEST_DATABASE_URL); u.pathname = `/${name}`; url = u.toString();
  });
  after(async () => { await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await admin.end(); });

  it('migrate cria todas as tabelas novas', async () => {
    cli('migrate');
    const s = await tables();
    for (const t of NEW_TABLES) assert.ok(s.tables.has(t), `faltou ${t}`);
    assert.ok(s.ids.includes('034_testimonials'));
  });

  it('rollback das 8 últimas remove só o que elas criaram e mantém o restante íntegro', async () => {
    const before = await tables();
    const n = before.ids.length - before.ids.indexOf(FIRST);
    assert.equal(n, 8, 'esperadas 027 a 034');
    const out = JSON.parse(cli('rollback', String(n)).trim().split('\n').pop());
    assert.equal(out.reverted.length, 8);
    const s = await tables();
    for (const t of NEW_TABLES) assert.ok(!s.tables.has(t), `sobrou ${t}`);
    assert.ok(!s.ids.some((id) => id >= FIRST));
    for (const t of ['users', 'vehicle_queries', 'payment_orders', 'faqs', 'schema_migrations']) assert.ok(s.tables.has(t), `perdeu ${t}`);
    assert.throws(() => cli('verify'), /MIGRATIONS_PENDING|Command failed/, 'após reverter, o verify precisa acusar migrações pendentes');
  });

  it('reaplicar funciona (idempotente) e a verificação passa', async () => {
    cli('migrate');
    const s = await tables();
    for (const t of NEW_TABLES) assert.ok(s.tables.has(t), `faltou ${t}`);
    cli('migrate');
    cli('verify');
  });
});
