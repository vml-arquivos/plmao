import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { hostRequest, startServer } from './helpers/server.mjs';

// Padrão do sistema: relatório da consulta Completa sai sem nenhuma máscara (crédito e comércio de veículos).
describe('relatório completo sem máscara (padrão)', integration, () => {
  let pool; let server; let token; let queryId;
  const call = (path, opts = {}) => hostRequest(server.base, path, { token, ...opts });
  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    server = await startServer({});
    const reg = await hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { name: 'Cliente Aberto', email: `${uid('clr')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    assert.equal(reg.status, 201);
    token = reg.json.token;
    await pool.query('UPDATE wallets SET balance_cents=100000 WHERE user_id=$1', [reg.json.user.id]);
  });
  after(async () => { await server.stop(); await pool.end(); });

  it('Completa entrega proprietário, documento e identificadores em claro ao cliente', async () => {
    const r = await call('/api/queries', { method: 'POST', body: { plate: 'DEV1B11', productId: 'COMPLETE' } });
    assert.equal(r.status, 201, r.text);
    queryId = r.json.id;
    const items = r.json.result.v2.sections.flatMap((s) => s.items);
    const nome = items.find((i) => i.key === 'PRONOME');
    assert.ok(nome && nome.state !== 'NOT_PROVIDED', 'seção de proprietário chegou ao cliente');
    assert.ok(!nome.masked && !String(nome.value).includes('*'));
    assert.match(String(nome.value), /FICTICIO/);
    assert.deepEqual(items.filter((i) => i.key !== 'CPF_CNPJ_PROPRIETARIO' && String(i.value ?? '').includes('***')).map((i) => [i.key, i.value]), [], 'nenhum valor mascarado pelo sistema (o documento do mock já vem anonimizado pela própria fonte)');
    assert.ok(!items.some((i) => i.key === 'CHAVERETORNO'), 'controle interno continua fora');
  });

  it('o mesmo vale no relatório salvo, na impressão e no PDF', async () => {
    const j = await call(`/api/queries/${queryId}/report`);
    assert.equal(j.status, 200);
    assert.match(JSON.stringify(j.json), /PROPRIETARIO FICTICIO/);
    const html = await call(`/api/queries/${queryId}/report/print`);
    assert.match(html.text, /PROPRIETARIO FICTICIO/);
    const pdf = await fetch(`${server.base}/api/queries/${queryId}/report/pdf`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(pdf.status, 200);
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  });
});
