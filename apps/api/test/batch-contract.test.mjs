import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { hostRequest, startServer } from './helpers/server.mjs';

// A consulta em lote da tela chama POST /queries uma vez por placa. Aqui fica garantido o que ela usa:
// o relatório vem na própria resposta (com parecer e checklist) e repetir a mesma chave não cobra duas vezes.
describe('contrato usado pela consulta em lote', integration, () => {
  let pool; let server; let token; let userId;
  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    server = await startServer({});
    const reg = await hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { name: 'Lojista Lote', email: `${uid('lot')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    token = reg.json.token; userId = reg.json.user.id;
    await pool.query('UPDATE wallets SET balance_cents=100000 WHERE user_id=$1', [userId]);
  });
  after(async () => { await server.stop(); await pool.end(); });

  it('resposta traz o relatório com veredito, débitos e checklist; mesma chave não cobra duas vezes', async () => {
    const send = () => hostRequest(server.base, '/api/queries', { method: 'POST', token, headers: { 'Idempotency-Key': 'batch-teste-0001-DEV1B11' }, body: { searchType: 'PLATE', searchValue: 'DEV1B11', productId: 'COMPLETE' } });
    const first = await send();
    assert.equal(first.status, 201, first.text);
    const v2 = first.json.result.v2;
    assert.ok(v2.verdict.level && v2.headline && typeof v2.debts.totalCents === 'number');
    assert.ok(Array.isArray(v2.advice.checks) && v2.advice.checks.length > 0);
    const balanceAfterFirst = Number((await pool.query('SELECT balance_cents FROM wallets WHERE user_id=$1', [userId])).rows[0].balance_cents);
    const again = await send();
    assert.ok([200, 201].includes(again.status), again.text);
    assert.equal(again.json.id, first.json.id);
    assert.equal(Number((await pool.query('SELECT balance_cents FROM wallets WHERE user_id=$1', [userId])).rows[0].balance_cents), balanceAfterFirst);
    const count = Number((await pool.query(`SELECT count(*) FROM vehicle_queries WHERE user_id=$1 AND plate='DEV1B11'`, [userId])).rows[0].count);
    assert.equal(count, 1);
  });

  it('saldo insuficiente devolve INSUFFICIENT_BALANCE, que a tela usa para parar o lote', async () => {
    await pool.query('UPDATE wallets SET balance_cents=0 WHERE user_id=$1', [userId]);
    const r = await hostRequest(server.base, '/api/queries', { method: 'POST', token, body: { searchType: 'PLATE', searchValue: 'DEV2C22', productId: 'COMPLETE' } });
    assert.equal(r.status, 402, r.text);
    assert.equal(r.json.code ?? r.json.error, 'INSUFFICIENT_BALANCE');
  });
});
