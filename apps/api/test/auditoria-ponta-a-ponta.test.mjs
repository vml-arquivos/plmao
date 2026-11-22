import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';
import { SCENARIOS, jwt } from './fixtures/credify-respostas.mjs';

useTestEnv();

// Ponta a ponta SEM CUSTO: o servidor de verdade (rotas, cobrança, estorno, relatório e PDF) falando com uma Credify de mentira
// que responde no formato publicado. Garante, para cada consulta, as APIs chamadas e o que o cliente recebe.
const PRODUCTS = {
  CADASTRAL: ['/debitosrestricoesproprietarios'],
  LIEN: ['/debitosrestricoesproprietarios', '/gravame'],
  AUCTION: ['/debitosrestricoesproprietarios', '/veicularbnacionalonline', '/leilaoconjugado'],
  BASIC: ['/debitosrestricoesproprietarios', '/indiciosinistro', '/veicularbnacionalonline', '/precificadorfipe', '/renainf', '/veiculoproprietarioplaca', '/leilaoconjugado'],
  COMPLETE: ['/debitosrestricoesproprietarios', '/indiciosinistro', '/veicularbnacionalonline', '/precificadorfipe', '/veiculoproprietarioplaca', '/leilaoconjugado'],
  PREMIUM: ['/debitosrestricoesproprietarios', '/indiciosinistro', '/veicularbnacionalonline', '/historicoproprietario', '/precificadorfipe', '/renainf', '/veiculoproprietarioplaca', '/leilaoconjugado']
};
const pdfText = (b64) => { const f = path.join(os.tmpdir(), `ppp-${Math.random().toString(36).slice(2)}.pdf`); fs.writeFileSync(f, Buffer.from(b64, 'base64')); try { return execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }); } finally { fs.unlinkSync(f); } };

describe('auditoria ponta a ponta com Credify de mentira (sem custo)', integration, () => {
  let pool; let app; let credify; let sa; let scenario = 'placa limpa';
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
        const body = SCENARIOS[scenario][req.url];
        return body ? send(200, body) : send(404, { Message: 'sem resposta de teste' });
      });
    });
    await new Promise((r) => credify.listen(0, '127.0.0.1', r));
    app = await startServer({
      DATA_PROVIDER: 'real', VEHICLE_API_PROVIDER: 'credify', CREDIFY_BASE_URL: `http://127.0.0.1:${credify.address().port}`, CREDIFY_CLIENT_ID: 'cid', CREDIFY_CLIENT_SECRET: 'sec',
      ENRICH_FIPE_HISTORY: 'false', PLATE_CACHE_HOURS: '0', PAYMENT_PROVIDER: 'disabled',
      FIPE_PRIMARY_BASE_URL: 'http://127.0.0.1:9', FIPE_SECONDARY_BASE_URL: 'http://127.0.0.1:9'
    });
    sa = await adminSession({ server: app, pool, role: 'SUPER_ADMIN' });
  });
  after(async () => { await app?.stop(); credify?.close(); await pool?.end(); });

  for (const [pid, esperado] of Object.entries(PRODUCTS)) {
    it(`${pid}: consulta interna do painel chama só as APIs do contrato e entrega relatório e PDF sem nome de fonte`, async () => {
      scenario = 'placa limpa'; hits.length = 0;
      const r = await sa.call('/api/admin/lookups', { method: 'POST', body: { plate: 'AAA0000', productId: pid } });
      assert.equal(r.status, 200, r.text);
      assert.deepEqual([...new Set(hits)].sort(), [...esperado].sort(), `APIs chamadas em ${pid}`);
      assert.equal(hits.length, new Set(hits).size, 'nenhuma API repetida');
      assert.ok(r.json.report?.sections?.length, 'relatório com seções');
      const texto = pdfText(r.json.pdfBase64);
      assert.ok(texto.includes('AAA0000'), 'placa no PDF');
      assert.ok(!/credify|anycar|bdrp|provedor|fornecedor|plano contratado|pacote/i.test(texto), 'sem nome de fonte nem conversa de plano no PDF');
      assert.ok(!/credify|anycar|bdrp/i.test(JSON.stringify(r.json.report)), 'sem nome de fonte no relatório da tela');
    });
  }

  for (const pid of ['LIEN', 'COMPLETE', 'PREMIUM']) {
    it(`${pid}: placa com ocorrências (alienação, recall, furto, judicial) chama também as APIs condicionais e mostra no relatório`, async () => {
      scenario = 'placa com ocorrências'; hits.length = 0;
      const r = await sa.call('/api/admin/lookups', { method: 'POST', body: { plate: 'AAA0000', productId: pid } });
      assert.equal(r.status, 200, r.text);
      const texto = JSON.stringify(r.json.report);
      if (pid === 'LIEN') assert.ok(hits.includes('/gravame') && /BANCO EXEMPLO/.test(texto), 'gravame com o agente financeiro');
      if (pid !== 'LIEN') {
        for (const api of ['/recall', '/historicoroubofurto']) assert.ok(hits.includes(api), `chamou ${api}`);
        assert.ok(/VW DO BRASIL/.test(texto), 'campanha de recall no relatório');
        assert.ok(/LEILOEIRO EXEMPLO/.test(texto), 'dados do leilão no relatório');
      }
      if (pid === 'PREMIUM') for (const api of ['/renajud', '/renainf']) assert.ok(hits.includes(api), `chamou ${api}`);
      assert.ok(!/credify|anycar|bdrp/i.test(pdfText(r.json.pdfBase64)), 'PDF sem nome de fonte');
    });
  }

  for (const [pid, chama] of [['BASIC', true], ['PREMIUM', true], ['COMPLETE', false]]) {
    it(`${pid}: alienação sem banco/contrato no cadastro ${chama ? 'busca o gravame e mostra o banco' : 'segue sem a consulta de gravame (fora do contrato da Completa)'}`, async () => {
      scenario = 'alienação sem detalhe no cadastro'; hits.length = 0;
      const r = await sa.call('/api/admin/lookups', { method: 'POST', body: { plate: 'AAA0000', productId: pid } });
      assert.equal(r.status, 200, r.text);
      assert.equal(hits.includes('/gravame'), chama, `/gravame em ${pid}`);
      assert.equal(/BANCO EXEMPLO/.test(JSON.stringify(r.json.report)), chama, 'banco financiador no relatório');
    });
  }

  it('cliente de verdade: compra a Consulta Completa pela API, é cobrado uma vez, recebe o relatório e baixa o PDF', async () => {
    scenario = 'placa limpa'; hits.length = 0;
    const reg = await hostRequest(app.base, '/api/auth/register', { method: 'POST', body: { name: 'Cliente Auditoria', email: `${uid('aud')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    assert.equal(reg.status, 201, reg.text);
    const { token, user } = reg.json;
    await pool.query('UPDATE wallets SET balance_cents=100000 WHERE user_id=$1', [user.id]);
    const price = Number((await pool.query(`SELECT price_cents FROM query_products WHERE id='COMPLETE'`)).rows[0].price_cents);
    const q = await hostRequest(app.base, '/api/queries', { method: 'POST', token, headers: { 'Idempotency-Key': `aud-${uid('k')}-0001` }, body: { searchType: 'PLATE', searchValue: 'AAA0000', productId: 'COMPLETE' } });
    assert.equal(q.status, 201, q.text);
    assert.deepEqual([...new Set(hits)].sort(), [...PRODUCTS.COMPLETE].sort());
    const balance = Number((await pool.query('SELECT balance_cents FROM wallets WHERE user_id=$1', [user.id])).rows[0].balance_cents);
    assert.equal(balance, 100000 - price, 'cobrou o preço da consulta uma única vez');
    assert.ok(q.json.result?.v2?.sections?.length, 'relatório na resposta');
    const pdf = await fetch(`${app.base}/api/queries/${q.json.id}/report/pdf`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(pdf.status, 200);
    assert.ok(!/credify|anycar|bdrp/i.test(pdfText(Buffer.from(await pdf.arrayBuffer()).toString('base64'))), 'PDF do cliente sem nome de fonte');
  });

  it('falha de uma API obrigatória: o cliente é estornado e nada fica sem retorno', async () => {
    scenario = 'placa limpa'; hits.length = 0;
    const reg = await hostRequest(app.base, '/api/auth/register', { method: 'POST', body: { name: 'Cliente Falha', email: `${uid('fal')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    const { token, user } = reg.json;
    await pool.query('UPDATE wallets SET balance_cents=100000 WHERE user_id=$1', [user.id]);
    failing.add('/leilaoconjugado');
    try {
      const q = await hostRequest(app.base, '/api/queries', { method: 'POST', token, headers: { 'Idempotency-Key': `aud-${uid('k')}-0002` }, body: { searchType: 'PLATE', searchValue: 'AAA0000', productId: 'COMPLETE' } });
      assert.notEqual(q.status, 201, 'não entrega relatório incompleto');
      const balance = Number((await pool.query('SELECT balance_cents FROM wallets WHERE user_id=$1', [user.id])).rows[0].balance_cents);
      assert.equal(balance, 100000, 'saldo devolvido');
    } finally { failing.clear(); }
  });
});
