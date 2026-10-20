import { pool } from './db.js';
import { ensureSchema } from './schema.js';
import { migrations } from './migrations.js';
async function verifyDatabase() {
    const applied = await pool.query('SELECT id,name FROM schema_migrations ORDER BY id');
    const appliedIds = new Set(applied.rows.map((row) => row.id));
    const missing = migrations.filter((migration) => !appliedIds.has(migration.id)).map((migration) => migration.id);
    if (missing.length > 0)
        throw new Error(`MIGRATIONS_PENDING:${missing.join(',')}`);
    await pool.query('SELECT 1 FROM users LIMIT 1');
    await pool.query('SELECT 1 FROM query_products LIMIT 1');
    await pool.query('SELECT 1 FROM wallets LIMIT 1');
    console.info(JSON.stringify({ ok: true, migrations: applied.rows.length, schema: 'verified' }));
}
const command = process.argv[2] ?? 'verify';
try {
    if (command === 'migrate') {
        await ensureSchema();
        const applied = await pool.query('SELECT id FROM schema_migrations ORDER BY id');
        console.info(JSON.stringify({ ok: true, migrations: applied.rows.map((row) => row.id), schema: 'migrated' }));
    }
    else if (command === 'verify') {
        await verifyDatabase();
    }
    else {
        throw new Error(`UNKNOWN_DB_COMMAND:${command}`);
    }
}
finally {
    await pool.end();
}
