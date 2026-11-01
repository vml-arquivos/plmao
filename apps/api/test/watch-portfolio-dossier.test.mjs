import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

describe('monitoramento de placa, meus veículos, dossiê e resultados', integration, () => {
  let pool; let server; let adm; let token; let userId; let token2; let userId2; let watchDev; let devQueryId; let plateWatch;
  const get = (t, path) => hostRequest(server.base, path, { token: t });

  /** Faz a consulta pelo mesmo caminho do cliente (cobra do saldo, mesma idempotência), como a rotina faz no servidor. */
  const runQueryFor = (tokens) => async (input) => {
    const t = tokens[input.userId];
    const r = await hostRequest(server.base, '/api/queries', { method: 'POST', token: t, headers: { 'idempotency-key': input.idempotencyKey ?? uid('idem-xxxxxxxx') }, body: { plate: input.plate, productId: input.productId } });
    return { status: r.status, body: r.json ?? {} };
  };

  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    ({ plateWatch } = { plateWatch: await import('../dist/lib/plateWatch.js') });
    const { refreshProductSections } = await import('../dist/lib/productSections.js');
    await refreshProductSections();
    server = await startServer();
    adm = await adminSession({ server, pool, role: 'SUPER_ADMIN' });
    const mk = async (name, balance) => {
      const reg = await hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { name, email: `${uid('wat')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
      assert.equal(reg.status, 201, reg.text);
      await pool.query('UPDATE wallets SET balance_cents=$2 WHERE user_id=$1', [reg.json.user.id, balance]);
      return reg.json;
    };
    const a = await mk('Cliente Monitor', 500000); token = a.token; userId = a.user.id;
    const b = await mk('Cliente Sem Saldo', 0); token2 = b.token; userId2 = b.user.id;
  });
  after(async () => { await server.stop(); await pool.end(); });

  it('compara duas consultas: só conta o que piorou', () => {
    const c = (key, status) => ({ key, label: key, status, detail: '' });
    const w = plateWatch.worsened([c('a', 'OK'), c('b', 'ATTENTION'), c('c', 'ALERT')], [c('a', 'ALERT'), c('b', 'OK'), c('c', 'ALERT'), c('d', 'ATTENTION'), c('e', 'NOT_CHECKED')]);
    assert.deepEqual(w.map((x) => [x.key, x.from, x.to]), [['a', 'OK', 'ALERT'], ['d', null, 'ATTENTION']]);
    assert.deepEqual(plateWatch.worsened([c('a', 'ALERT')], [c('a', 'OK')]), [], 'melhora não gera aviso');
  });

  it('cria o monitoramento só com confirmação de cobrança, intervalo válido e sem duplicar', async () => {
    const mkw = (body) => hostRequest(server.base, '/api/watches', { method: 'POST', token, body });
    assert.equal((await mkw({ plate: 'DEV1B11', productId: 'COMPLETE', intervalDays: 7 })).status, 400, 'sem confirmar a cobrança');
    assert.equal((await mkw({ plate: 'DEV1B11', productId: 'COMPLETE', intervalDays: 3, acceptCharge: true })).status, 400, 'intervalo inválido');
    assert.equal((await mkw({ plate: 'XX', productId: 'COMPLETE', intervalDays: 7, acceptCharge: true })).status, 400, 'placa inválida');
    assert.equal((await mkw({ plate: 'DEV1B11', productId: 'NAO_EXISTE', intervalDays: 7, acceptCharge: true })).status, 404);
    const ok = await mkw({ plate: 'dev-1b11', productId: 'COMPLETE', intervalDays: 7, acceptCharge: true });
    assert.equal(ok.status, 201, ok.text);
    assert.equal(ok.json.plate, 'DEV1B11');
    assert.equal(ok.json.status, 'ACTIVE');
    assert.ok(Date.parse(ok.json.nextCheckAt) <= Date.now() + 5000, 'sem consulta anterior, a primeira verificação é agora');
    watchDev = ok.json.id;
    assert.equal((await mkw({ plate: 'DEV1B11', productId: 'COMPLETE', intervalDays: 15, acceptCharge: true })).status, 409, 'duplicado');
    const list = await get(token, '/api/watches');
    assert.equal(list.status, 200);
    assert.equal(list.json.items.length, 1);
    assert.equal((await get(token2, '/api/watches')).json.items.length, 0, 'cada pessoa vê só os seus');
    assert.equal((await hostRequest(server.base, `/api/watches/${watchDev}`, { method: 'PATCH', token: token2, body: { status: 'PAUSED' } })).status, 404);
    assert.equal((await hostRequest(server.base, '/api/watches', { method: 'POST', body: { plate: 'DEV1B11', productId: 'COMPLETE', intervalDays: 7, acceptCharge: true } })).status, 401);
  });

  it('primeira rodada cobra uma vez e vira a base; a seguinte só vence depois do intervalo', async () => {
    const before = Number((await pool.query('SELECT balance_cents FROM wallets WHERE user_id=$1', [userId])).rows[0].balance_cents);
    const r1 = await plateWatch.runDueWatches(runQueryFor({ [userId]: token, [userId2]: token2 }));
    assert.ok(r1.started >= 1 && r1.settled >= 1, JSON.stringify(r1));
    const after1 = Number((await pool.query('SELECT balance_cents FROM wallets WHERE user_id=$1', [userId])).rows[0].balance_cents);
    assert.ok(after1 < before, 'a verificação foi cobrada do saldo');
    const row = (await pool.query('SELECT * FROM plate_watches WHERE id=$1', [watchDev])).rows[0];
    assert.equal(row.runs, 1);
    assert.ok(row.baseline_query_id);
    devQueryId = row.baseline_query_id;
    const days = (new Date(row.next_check_at) - Date.now()) / 86_400_000;
    assert.ok(days > 6.9 && days <= 7.01, `próxima em 7 dias (${days})`);
    const ev = await get(token, `/api/watches/${watchDev}/events`);
    assert.equal(ev.json[0].kind, 'BASELINE');
    const r2 = await plateWatch.runDueWatches(runQueryFor({ [userId]: token }));
    assert.equal(r2.started, 0, 'nada vencido');
    const q = await pool.query('SELECT source,price_cents FROM vehicle_queries WHERE id=$1', [devQueryId]);
    assert.ok(Number(q.rows[0].price_cents) > 0, 'é uma consulta normal do cliente, com valor');
  });

  it('rodada igual à anterior: sem mudança, sem e-mail e sem cobrança repetida no mesmo dia', async () => {
    const bal = async () => Number((await pool.query('SELECT balance_cents FROM wallets WHERE user_id=$1', [userId])).rows[0].balance_cents);
    const before = await bal();
    await pool.query('UPDATE plate_watches SET next_check_at=now() WHERE id=$1', [watchDev]);
    await plateWatch.runDueWatches(runQueryFor({ [userId]: token }));
    const ev = await get(token, `/api/watches/${watchDev}/events`);
    assert.equal(ev.json[0].kind, 'NO_CHANGE');
    assert.equal(await bal(), before, 'a mesma consulta do dia não é cobrada de novo');
    const mails = await pool.query(`SELECT count(*)::int AS n FROM email_outbox WHERE related_type='PLATE_WATCH' AND related_id=$1`, [watchDev]);
    assert.equal(mails.rows[0].n, 0);
  });

  it('quando algo piora em relação à consulta anterior, registra a mudança e avisa por e-mail', async () => {
    const c = await hostRequest(server.base, '/api/watches', { method: 'POST', token, body: { plate: 'FUR5T55', productId: 'COMPLETE', intervalDays: 15, acceptCharge: true } });
    assert.equal(c.status, 201, c.text);
    await plateWatch.runDueWatches(runQueryFor({ [userId]: token }));
    // a base passa a ser uma consulta limpa (outra placa), para simular o veículo que piorou
    await pool.query('UPDATE plate_watches SET baseline_query_id=$2,next_check_at=now() WHERE id=$1', [c.json.id, devQueryId]);
    await plateWatch.runDueWatches(runQueryFor({ [userId]: token }));
    const ev = await get(token, `/api/watches/${c.json.id}/events`);
    assert.equal(ev.json[0].kind, 'CHANGED', JSON.stringify(ev.json[0]));
    assert.ok(ev.json[0].changes.length >= 1);
    const mail = await pool.query(`SELECT payload FROM email_outbox WHERE related_type='PLATE_WATCH' AND related_id=$1`, [c.json.id]);
    assert.equal(mail.rowCount, 1);
    assert.ok(JSON.stringify(mail.rows[0].payload).includes('FUR5T55'));
    assert.ok(JSON.stringify(mail.rows[0].payload).includes('/app/consulta/'));
    const list = await get(token, '/api/watches');
    assert.equal(list.json.items.find((x) => x.id === c.json.id).lastEvent.kind, 'CHANGED');
  });

  it('sem saldo pausa e avisa; três falhas seguidas também pausam; retomar volta a verificar', async () => {
    const c = await hostRequest(server.base, '/api/watches', { method: 'POST', token: token2, body: { plate: 'DEV1B11', productId: 'COMPLETE', intervalDays: 7, acceptCharge: true } });
    assert.equal(c.status, 201, c.text);
    await plateWatch.runDueWatches(runQueryFor({ [userId]: token, [userId2]: token2 }));
    const paused = (await pool.query('SELECT status,pause_reason FROM plate_watches WHERE id=$1', [c.json.id])).rows[0];
    assert.equal(paused.status, 'PAUSED');
    assert.equal(paused.pause_reason, 'SALDO');
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM email_outbox WHERE related_type='PLATE_WATCH' AND related_id=$1`, [c.json.id])).rows[0].n, 1);
    // retomar: volta a ficar ativo e vencido (verifica na próxima rodada)
    const resumed = await hostRequest(server.base, `/api/watches/${c.json.id}`, { method: 'PATCH', token: token2, body: { status: 'ACTIVE' } });
    assert.equal(resumed.status, 200);
    assert.equal(resumed.json.status, 'ACTIVE');
    // falhas: fonte indisponível 3 vezes seguidas
    const failing = async () => ({ status: 424, body: { error: 'DATA_PROVIDER_UNAVAILABLE' } });
    for (let i = 0; i < 3; i += 1) {
      await pool.query('UPDATE plate_watches SET next_check_at=now() WHERE id=$1', [c.json.id]);
      await plateWatch.runDueWatches(failing);
    }
    const after = (await pool.query('SELECT status,pause_reason,failures FROM plate_watches WHERE id=$1', [c.json.id])).rows[0];
    assert.equal(after.status, 'PAUSED');
    assert.equal(after.pause_reason, 'FALHAS');
    const kinds = (await get(token2, `/api/watches/${c.json.id}/events`)).json.map((e) => e.kind);
    assert.equal(kinds.filter((k) => k === 'FAILED').length, 3);
  });

  it('pausar, mudar intervalo e apagar', async () => {
    const p = await hostRequest(server.base, `/api/watches/${watchDev}`, { method: 'PATCH', token, body: { status: 'PAUSED', intervalDays: 30 } });
    assert.equal(p.status, 200, p.text);
    assert.equal(p.json.status, 'PAUSED');
    assert.equal(p.json.intervalDays, 30);
    assert.equal((await hostRequest(server.base, `/api/watches/${watchDev}`, { method: 'PATCH', token, body: {} })).status, 400);
    assert.equal((await hostRequest(server.base, `/api/watches/${watchDev}`, { method: 'DELETE', token })).status, 200);
    assert.equal((await hostRequest(server.base, `/api/watches/${watchDev}`, { method: 'DELETE', token })).status, 404);
  });

  it('meus veículos: uma linha por placa, com a situação e se está monitorada', async () => {
    const r = await get(token, '/api/portfolio');
    assert.equal(r.status, 200, r.text);
    const plates = r.json.items.map((x) => x.plate);
    assert.equal(new Set(plates).size, plates.length, 'sem placa repetida');
    assert.ok(plates.includes('DEV1B11') && plates.includes('FUR5T55'));
    const fur = r.json.items.find((x) => x.plate === 'FUR5T55');
    assert.ok(fur.queries >= 1);
    assert.ok(fur.verdict?.title);
    assert.equal(fur.watching, true);
    assert.equal(r.json.items.find((x) => x.plate === 'DEV1B11').watching, false, 'o monitoramento da DEV1B11 foi apagado');
    assert.deepEqual((await get(token2, '/api/portfolio')).json.items.filter((x) => x.plate === 'FUR5T55'), [], 'só vê os próprios');
    assert.equal((await hostRequest(server.base, '/api/portfolio')).status, 401);
  });

  it('dossiê em PDF reúne os relatórios da placa; só do dono; sem consulta dá 404', async () => {
    const lien = await hostRequest(server.base, '/api/queries', { method: 'POST', token, body: { plate: 'DEV1B11', productId: 'LIEN' } });
    assert.equal(lien.status, 201, lien.text);
    const { PDFDocument } = await import('pdf-lib');
    const single = await server.request(`/api/queries/${devQueryId}/report/pdf`, { token });
    const singlePages = (await PDFDocument.load(Buffer.from(await single.arrayBuffer()))).getPageCount();
    const res = await server.request('/api/vehicles/DEV1B11/dossier.pdf', { token });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition') ?? '', /dossie-DEV1B11\.pdf/);
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    const pages = (await PDFDocument.load(bytes)).getPageCount();
    assert.ok(pages >= singlePages + 2, `capa + dois relatórios (${pages} páginas, um relatório tem ${singlePages})`);
    assert.equal((await server.request('/api/vehicles/DEV1B11/dossier.pdf', { token: token2 })).status, 404, 'quem não consultou não recebe');
    assert.equal((await server.request('/api/vehicles/INC7P77/dossier.pdf', { token })).status, 404);
    assert.equal((await server.request('/api/vehicles/XX/dossier.pdf', { token })).status, 400);
    assert.equal((await server.request('/api/vehicles/DEV1B11/dossier.pdf', {})).status, 401);
  });

  it('resultados da equipe: totais, por produto, por dia, internas à parte e permissão', async () => {
    const internal = await adm.call('/api/admin/lookups', { method: 'POST', body: { plate: 'DEV1B11', productId: 'COMPLETE' } });
    assert.equal(internal.status, 200, internal.text);
    const r = await adm.call('/api/admin/results');
    assert.equal(r.status, 200, r.text);
    assert.ok(r.json.totals.customer >= 3);
    assert.ok(r.json.totals.internal >= 1);
    assert.ok(r.json.totals.revenueCents > 0);
    const complete = r.json.byProduct.find((x) => x.id === 'COMPLETE');
    assert.ok(complete && complete.customer >= 1 && complete.internal >= 1);
    assert.ok(r.json.byDay.length >= 1 && /^\d{4}-\d{2}-\d{2}$/.test(r.json.byDay[0].date));
    assert.ok(r.json.watch.checks >= 1 && r.json.watch.changes >= 1);
    assert.ok(r.json.topCustomers.some((x) => x.queries >= 1));
    const sum = r.json.byDay.reduce((s, d) => s + d.revenueCents, 0);
    assert.equal(sum, r.json.totals.revenueCents, 'a soma dos dias fecha com o total');
    assert.equal((await adm.call('/api/admin/results?from=2025-01-01&to=2026-12-31')).status, 400, 'período longo demais');
    assert.equal((await adm.call('/api/admin/results?from=2026-05-02&to=2026-05-01')).status, 400);
    assert.equal((await adm.call('/api/admin/results?from=abc')).status, 400);
    const future = await adm.call('/api/admin/results?from=2040-01-01&to=2040-01-02');
    assert.equal(future.json.totals.total, 0);
    const support = await adminSession({ server, pool, role: 'SUPORTE' });
    assert.equal((await support.call('/api/admin/results')).status, 403);
  });
});
