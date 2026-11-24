import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';
import { SCENARIOS, jwt } from './fixtures/credify-respostas.mjs';

useTestEnv();

describe('limites da FIPE grátis: padrões do sistema', () => {
  it('padrão: 3 por dia e 15 por mês por conta', async () => {
    const { env } = await import('../dist/config.js');
    assert.equal(env.FIPE_AUTH_DAILY_LIMIT, 3);
    assert.equal(env.FIPE_AUTH_MONTHLY_LIMIT, 15);
  });
});

// Servidor real + Credify de mentira (sem custo). Mensal baixo (4) e diário alto (5) para provar o teto do mês sem depender do dia do mês.
describe('FIPE grátis com teto mensal e Cadastral grátis uma por conta', integration, () => {
  let pool; let app; let credify; let sa;
  const hits = []; const failing = new Set();
  before(async () => {
    ({ pool } = await loadCore());
    credify = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
        if (req.url === '/auth') return send(200, { Success: true, Dados: jwt() });
        hits.push(req.url);
        if (failing.has(req.url)) return send(503, { Message: 'indisponivel' });
        const body = SCENARIOS['placa limpa'][req.url];
        return body ? send(200, body) : send(404, { Message: 'sem resposta de teste' });
      });
    });
    await new Promise((r) => credify.listen(0, '127.0.0.1', r));
    app = await startServer({
      DATA_PROVIDER: 'real', VEHICLE_API_PROVIDER: 'credify', CREDIFY_BASE_URL: `http://127.0.0.1:${credify.address().port}`, CREDIFY_CLIENT_ID: 'cid', CREDIFY_CLIENT_SECRET: 'sec',
      ENRICH_FIPE_HISTORY: 'false', PLATE_CACHE_HOURS: '0', PAYMENT_PROVIDER: 'disabled',
      FEATURE_FREE_FIPE: 'true', FIPE_AUTH_DAILY_LIMIT: '5', FIPE_AUTH_MONTHLY_LIMIT: '4', FEATURE_FREE_CADASTRAL: 'true',
      FIPE_PRIMARY_BASE_URL: 'http://127.0.0.1:9', FIPE_SECONDARY_BASE_URL: 'http://127.0.0.1:9'
    });
    sa = await adminSession({ server: app, pool, role: 'SUPER_ADMIN' });
    // O painel pode ter um limite diário salvo (vale mais que o ambiente); aqui o dia fica folgado para só o mês barrar.
    assert.equal((await sa.call('/api/admin/settings', { method: 'PATCH', body: { fipeAuthDailyLimit: 5 } })).status, 200);
  });
  after(async () => { await sa?.call('/api/admin/settings', { method: 'PATCH', body: { fipeAuthDailyLimit: 3 } }).catch(() => undefined); await app?.stop(); credify?.close(); await pool?.end(); });

  async function cliente(balanceCents = 0) {
    const email = `${uid('lc')}@cliente.local`;
    const r = await hostRequest(app.base, '/api/auth/register', { method: 'POST', body: { name: 'Cliente Limite', email, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    assert.equal(r.status, 201, r.text);
    const id = String((await pool.query('SELECT id FROM users WHERE email=$1', [email])).rows[0].id);
    await pool.query('UPDATE wallets SET balance_cents=$2 WHERE user_id=$1', [id, balanceCents]);
    return { token: r.json.token, id };
  }
  const fipe = (token) => hostRequest(app.base, '/api/fipe/quote', { method: 'POST', token, body: { plate: 'AAA0A00' } });
  const cadastral = (c, plate) => hostRequest(app.base, '/api/queries', { method: 'POST', token: c.token, headers: { 'Idempotency-Key': `cad-${uid('k')}-0001` }, body: { searchType: 'PLATE', searchValue: plate, productId: 'CADASTRAL' } });
  const balance = async (c) => Number((await pool.query('SELECT balance_cents FROM wallets WHERE user_id=$1', [c.id])).rows[0].balance_cents);

  it('o convite público só aparece se o sistema entrega: /fipe/status informa a FIPE e a Cadastral grátis', async () => {
    const st = await hostRequest(app.base, '/api/fipe/status');
    assert.equal(st.json.enabled, true); assert.equal(st.json.freeCadastral, true);
  });

  describe('FIPE: teto mensal por conta', () => {
    // A FIPE pela placa usa a precificadora da Credify de mentira; só o status importa aqui.
    it('o mês barra depois do teto, mesmo com o dia livre, e a recusa não gasta cota', async () => {
      const c = await cliente();
      const ok = [];
      for (let i = 0; i < 4; i++) ok.push((await fipe(c.token)).status);
      assert.deepEqual(ok, [201, 201, 201, 201], ok.join(','));
      const over = await fipe(c.token);
      assert.equal(over.status, 429); assert.equal(over.json.error, 'FIPE_MONTHLY_LIMIT');
      const today = (await pool.query(`SELECT count FROM fipe_usage WHERE scope_key=$1 AND bucket_date=(now() AT TIME ZONE 'UTC')::date`, [`v2:user:${c.id}`])).rows[0].count;
      assert.equal(Number(today), 4, 'a tentativa recusada devolve a cota');
    });

    it('uso do mês anterior não conta; o de outra conta também não', async () => {
      const c = await cliente(); const outra = await cliente();
      await pool.query(`INSERT INTO fipe_usage(scope_key,bucket_date,count) VALUES($1,(date_trunc('month', now() AT TIME ZONE 'UTC') - interval '1 day')::date,50)`, [`v2:user:${c.id}`]);
      for (let i = 0; i < 4; i++) assert.equal((await fipe(c.token)).status, 201);
      assert.equal((await fipe(outra.token)).status, 201);
    });

    it('conta com limite próprio definido pelo painel fica fora do teto mensal', async () => {
      const c = await cliente();
      assert.equal((await sa.call(`/api/admin/customers/${c.id}/fipe-limit`, { method: 'PUT', body: { limit: 8 } })).status, 200);
      const out = []; for (let i = 0; i < 6; i++) out.push((await fipe(c.token)).status);
      assert.deepEqual(out, Array(6).fill(201));
    });
  });

  describe('Cadastral grátis: uma por conta', () => {
    it('a primeira sai grátis e sem saldo: custo zero, carteira intocada, uma única chamada à fonte', async () => {
      const c = await cliente(0);
      const me = await hostRequest(app.base, '/api/me', { token: c.token });
      assert.equal(me.json.freeCadastralAvailable, true);
      const prods = await hostRequest(app.base, '/api/query-products', { token: c.token });
      assert.equal(prods.json.find((p) => p.id === 'CADASTRAL').freeGrant, true);
      assert.equal(prods.json.find((p) => p.id === 'LIEN').freeGrant, false);
      hits.length = 0;
      const q = await cadastral(c, 'AAA0000');
      assert.equal(q.status, 201, q.text);
      assert.equal(q.json.priceCents, 0); assert.equal(q.json.chargeSource, 'FREE_GRANT');
      assert.deepEqual(hits, ['/debitosrestricoesproprietarios']);
      assert.equal(await balance(c), 0);
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM wallet_transactions WHERE user_id=$1 AND kind='QUERY'`, [c.id])).rows[0].n, 0);
      const after = await hostRequest(app.base, '/api/me', { token: c.token });
      assert.equal(after.json.freeCadastralAvailable, false);
    });

    it('a segunda cobra o preço da tabela (sem saldo, 402; com saldo, debita) e não é grátis', async () => {
      const c = await cliente(0);
      assert.equal((await cadastral(c, 'AAA0000')).status, 201);
      const semSaldo = await cadastral(c, 'BBB1B23');
      assert.equal(semSaldo.status, 402, semSaldo.text); assert.equal(semSaldo.json.error, 'INSUFFICIENT_BALANCE');
      const price = Number((await pool.query(`SELECT price_cents FROM query_products WHERE id='CADASTRAL'`)).rows[0].price_cents);
      await pool.query('UPDATE wallets SET balance_cents=$2 WHERE user_id=$1', [c.id, price + 500]);
      const paga = await cadastral(c, 'BBB1B23');
      assert.equal(paga.status, 201, paga.text); assert.equal(paga.json.chargeSource, 'WALLET_MONEY'); assert.equal(paga.json.priceCents, price);
      assert.equal(await balance(c), 500);
    });

    it('é por conta: outra conta ainda tem a sua; os outros produtos continuam pagos', async () => {
      const a = await cliente(0); const b = await cliente(0);
      assert.equal((await cadastral(a, 'AAA0000')).status, 201);
      assert.equal((await cadastral(b, 'AAA0000')).status, 201);
      const lien = await hostRequest(app.base, '/api/queries', { method: 'POST', token: (await cliente(0)).token, headers: { 'Idempotency-Key': `lie-${uid('k')}-0002` }, body: { searchType: 'PLATE', searchValue: 'AAA0000', productId: 'LIEN' } });
      assert.equal(lien.status, 402, lien.text);
    });

    it('duas consultas ao mesmo tempo na mesma conta: só uma sai grátis', async () => {
      const c = await cliente(0);
      const [x, y] = await Promise.all([cadastral(c, 'CCC1C11'), cadastral(c, 'DDD2D22')]);
      assert.deepEqual([x.status, y.status].sort(), [201, 402], `${x.text} | ${y.text}`);
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM free_query_grants WHERE user_id=$1`, [c.id])).rows[0].n, 1);
    });

    it('se a fonte falha, nada é cobrado e o direito grátis volta', async () => {
      const c = await cliente(0);
      failing.add('/debitosrestricoesproprietarios');
      let falha;
      try { falha = await cadastral(c, 'AAA0000'); } finally { failing.delete('/debitosrestricoesproprietarios'); }
      assert.notEqual(falha.status, 201, falha.text);
      assert.equal(await balance(c), 0);
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM free_query_grants WHERE user_id=$1`, [c.id])).rows[0].n, 0, 'direito devolvido');
      assert.equal((await hostRequest(app.base, '/api/me', { token: c.token })).json.freeCadastralAvailable, true);
      const de_novo = await cadastral(c, 'AAA0000');
      assert.equal(de_novo.status, 201, de_novo.text); assert.equal(de_novo.json.chargeSource, 'FREE_GRANT');
    });
  });
});
