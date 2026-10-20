import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { integration, useTestEnv, uid } from './helpers/db.mjs';

const email = `${uid('boot')}@exemplo.com.br`;
const password = 'SenhaInicial#2026';
useTestEnv({ ADMIN_BOOTSTRAP_EMAIL: email, ADMIN_BOOTSTRAP_PASSWORD: password, ADMIN_BOOTSTRAP_NAME: 'Dono do Sistema' });

test('administrador criado por variáveis: só quando não há SUPER_ADMIN e nunca sobrescreve', integration, async () => {
  const { pool } = await import('../dist/db.js');
  const { ensureSchema } = await import('../dist/schema.js');
  await ensureSchema(); // garante o schema (e pode criar o admin se o banco estiver sem super admin)
  const others = (await pool.query(`SELECT id FROM users WHERE role='SUPER_ADMIN' AND lower(email)<>lower($1)`, [email])).rows.map((r) => r.id);
  try {
    await pool.query(`DELETE FROM users WHERE lower(email)=lower($1)`, [email]);
    await pool.query(`UPDATE users SET active=false WHERE id = ANY($1::uuid[])`, [others]);

    await ensureSchema();
    const created = (await pool.query('SELECT id,role,active,name,password_hash,password_enabled FROM users WHERE lower(email)=lower($1)', [email])).rows[0];
    assert.equal(created.role, 'SUPER_ADMIN');
    assert.equal(created.active, true);
    assert.equal(created.name, 'Dono do Sistema');
    assert.equal(created.password_enabled, true);
    assert.equal(await bcrypt.compare(password, created.password_hash), true);
    assert.equal((await pool.query('SELECT 1 FROM wallets WHERE user_id=$1', [created.id])).rowCount, 1);
    assert.equal((await pool.query(`SELECT 1 FROM audit_logs WHERE action='ENV_ADMIN_BOOTSTRAP' AND entity_id=$1`, [String(created.id)])).rowCount >= 1, true);
    assert.equal((await pool.query(`SELECT 1 FROM audit_logs WHERE metadata::text LIKE '%' || $1 || '%'`, [password])).rowCount, 0, 'a senha nunca vai para a auditoria');

    // Segunda subida: já existe SUPER_ADMIN ativo, então nada muda (mesmo que o hash tenha sido trocado depois do primeiro acesso).
    const changed = await bcrypt.hash('OutraSenhaDoUsuario#1', 10);
    await pool.query('UPDATE users SET password_hash=$2 WHERE id=$1', [created.id, changed]);
    await ensureSchema();
    assert.equal((await pool.query('SELECT password_hash FROM users WHERE id=$1', [created.id])).rows[0].password_hash, changed);
  } finally {
    await pool.query(`DELETE FROM users WHERE lower(email)=lower($1)`, [email]);
    await pool.query(`UPDATE users SET active=true WHERE id = ANY($1::uuid[])`, [others]);
  }
});
