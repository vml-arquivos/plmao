import { pool } from './db.js';
import { ensureSchema } from './schema.js';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { migrations } from './migrations.js';

async function verifyDatabase(): Promise<void> {
  const applied = await pool.query<{ id: string; name: string }>('SELECT id,name FROM schema_migrations ORDER BY id');
  const appliedIds = new Set(applied.rows.map((row) => row.id));
  const missing = migrations.filter((migration) => !appliedIds.has(migration.id)).map((migration) => migration.id);
  if (missing.length > 0) throw new Error(`MIGRATIONS_PENDING:${missing.join(',')}`);
  await pool.query('SELECT 1 FROM users LIMIT 1');
  await pool.query('SELECT 1 FROM query_products LIMIT 1');
  await pool.query('SELECT 1 FROM wallets LIMIT 1');
  console.info(JSON.stringify({ ok: true, migrations: applied.rows.length, schema: 'verified' }));
}

const command = process.argv[2] ?? 'verify';
try {
  if (command === 'migrate') {
    await ensureSchema();
    const applied = await pool.query<{ id: string }>('SELECT id FROM schema_migrations ORDER BY id');
    console.info(JSON.stringify({ ok: true, migrations: applied.rows.map((row) => row.id), schema: 'migrated' }));
  } else if (command === 'verify') {
    await verifyDatabase();
  } else if (command === 'admin:create') {
    // Cria (ou promove) um SUPER_ADMIN. A senha provisória aparece UMA vez no terminal; o 2FA é cadastrado no primeiro acesso.
    await ensureSchema();
    const email = (process.argv[3] ?? '').trim().toLowerCase();
    const name = (process.argv[4] ?? 'Administrador').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('USAGE: npm run admin:create -- email@dominio.com "Nome"');
    const password = process.env.ADMIN_CREATE_PASSWORD || randomBytes(15).toString('base64url');
    if (password.length < 12) throw new Error('ADMIN_CREATE_PASSWORD_TOO_SHORT');
    const hash = await bcrypt.hash(password, 12);
    const user = await pool.query(`INSERT INTO users(email,password_hash,name,role,active) VALUES($1,$2,$3,'SUPER_ADMIN',true)
      ON CONFLICT(email) DO UPDATE SET password_hash=EXCLUDED.password_hash,role='SUPER_ADMIN',active=true RETURNING id`, [email, hash, name]);
    await pool.query('INSERT INTO wallets(user_id,balance,balance_cents) VALUES($1,0,0) ON CONFLICT(user_id) DO NOTHING', [user.rows[0].id]);
    await pool.query(`INSERT INTO audit_logs(user_id,action,entity,entity_id,metadata) VALUES(NULL,'CLI_ADMIN_CREATE','USER',$1,$2::jsonb)`, [String(user.rows[0].id), JSON.stringify({ source: 'cli' })]);
    console.info(JSON.stringify({ ok: true, email, role: 'SUPER_ADMIN', ...(process.env.ADMIN_CREATE_PASSWORD ? {} : { temporaryPassword: password }), next: 'Entre no painel administrativo e cadastre o 2FA; troque a senha em seguida.' }));
  } else if (command === 'admin:reset-2fa') {
    const email = (process.argv[3] ?? '').trim().toLowerCase();
    const user = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    if (!user.rowCount) throw new Error('USER_NOT_FOUND');
    const id = user.rows[0].id;
    await pool.query('DELETE FROM team_totp_recovery_codes WHERE user_id=$1', [id]);
    await pool.query('DELETE FROM team_totp WHERE user_id=$1', [id]);
    await pool.query('UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [id]);
    await pool.query(`INSERT INTO audit_logs(user_id,action,entity,entity_id,metadata) VALUES(NULL,'CLI_ADMIN_RESET_2FA','USER',$1,$2::jsonb)`, [String(id), JSON.stringify({ source: 'cli' })]);
    console.info(JSON.stringify({ ok: true, email, next: 'O 2FA será cadastrado novamente no próximo login.' }));
  } else {
    throw new Error(`UNKNOWN_DB_COMMAND:${command}`);
  }
} finally {
  await pool.end();
}
