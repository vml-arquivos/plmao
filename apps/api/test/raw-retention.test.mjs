import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { hostRequest, startServer } from './helpers/server.mjs';

describe('retenção do dado bruto do fornecedor', integration, () => {
  let pool; let server; let purge; let userId; const ids = {};
  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    ({ purgeExpiredRaw: purge } = await import('../dist/lib/rawRetention.js'));
    server = await startServer();
    const reg = await hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { name: 'Cliente Bruto', email: `${uid('rr')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    userId = reg.json.user.id;
    for (const [tag, age] of [['old', 120], ['recent', 5]]) {
      const q = await pool.query(`INSERT INTO vehicle_queries(user_id,plate,product_id,status,credits_cost,provider,price_cents,completed_at) VALUES($1,$2,'COMPLETE','SUCCESS',0,'mock',1500,now()) RETURNING id`, [userId, tag === 'old' ? 'RET1A11' : 'RET2B22']);
      await pool.query(`INSERT INTO vehicle_query_results(query_id,normalized,raw_response,raw_enc,created_at) VALUES($1,'{"identification":{"plate":"X"}}'::jsonb,'{}'::jsonb,'cifrado',now() - make_interval(days => $2::int))`, [q.rows[0].id, age]);
      ids[tag] = q.rows[0].id;
    }
  });
  after(async () => { await server.stop(); await pool.end(); });
  const raw = async (id) => (await pool.query('SELECT raw_enc,normalized FROM vehicle_query_results WHERE query_id=$1', [id])).rows[0];

  it('prazo 0 não apaga nada', async () => {
    assert.equal(await purge(0), 0);
    assert.equal((await raw(ids.old)).raw_enc, 'cifrado');
  });

  it('apaga só o bruto vencido e mantém o relatório do cliente', async () => {
    assert.ok(await purge(90) >= 1);
    const old = await raw(ids.old);
    assert.equal(old.raw_enc, null); assert.equal(old.normalized.identification.plate, 'X');
    assert.equal((await raw(ids.recent)).raw_enc, 'cifrado', 'dentro do prazo continua guardado');
    assert.equal(await purge(90), 0, 'repetir não faz nada');
  });
});
