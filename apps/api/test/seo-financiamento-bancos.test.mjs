import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

useTestEnv();
const { slugify } = await import('../dist/financingPages.js');
const { bankDisplayName } = await import('../dist/financingSettings.js');

describe('páginas de financiamento por banco: nomes e endereços', () => {
  it('endereço limpo a partir do nome do banco', () => {
    assert.equal(slugify('C6 Bank'), 'c6-bank');
    assert.equal(slugify('Banco Itaú'), 'banco-itau');
    assert.equal(bankDisplayName('BCO C6 S.A.'), 'C6 Bank');
  });
});

describe('páginas "Financiamento de carro {banco}" e páginas criadas no painel', integration, () => {
  let server, pool, adm;
  const get = async (path) => fetch(`${server.base}${path}`, { headers: { accept: 'text/html' } });
  const SEEDED = `'BCO BRADESCO FINANC. S.A.'`;
  before(async () => {
    ({ pool } = await loadCore()); server = await startServer(); adm = await adminSession({ server, pool, role: 'ADMIN' });
    await pool.query(`DELETE FROM seo_pages WHERE path LIKE '/financiamento/%'`);
    await pool.query(`INSERT INTO financing_bank_rates(segment,modality,institution,monthly_pct,annual_pct,position,period) VALUES('PF','CDC',${SEEDED},1.81,24.0,6,'2026-10-05') ON CONFLICT (segment,modality,institution) DO UPDATE SET monthly_pct=1.81, period='2026-10-05'`);
    await pool.query(`UPDATE financing_banks SET active=true WHERE name='Bradesco'`);
  });
  after(async () => {
    await pool.query(`DELETE FROM financing_bank_rates WHERE institution=${SEEDED}`);
    await pool.query(`DELETE FROM seo_pages WHERE path LIKE '/financiamento/%'`);
    await pool.query(`DELETE FROM seo_images WHERE path LIKE '/financiamento/%'`);
    await server.stop(); await pool.end();
  });

  it('banco com taxa ganha página própria, com título, taxa real, exemplo e perguntas no HTML', async () => {
    const r = await get('/financiamento/bradesco'); assert.equal(r.status, 200);
    const h = await r.text();
    assert.match(h, /<title>Financiamento de carro Bradesco: taxa e simulação \| Placa na Mão<\/title>/);
    assert.match(h, /<meta name="description" content="Financiamento de carro Bradesco: /);
    assert.match(h, /<link rel="canonical" href="[^"]*\/financiamento\/bradesco"/);
    if (!h.includes('<div id="root">')) return;
    assert.match(h, /<h1[^>]*>Financiamento de carro Bradesco<\/h1>/);
    assert.match(h, /1,81% ao mês/); assert.match(h, /Exemplo de parcela no Bradesco/); assert.match(h, /"@type":"FAQPage"/);
    assert.ok(!/noindex/.test(h));
  });

  it('o índice /financiamento lista os bancos; endereço que não existe dá 404', async () => {
    const hub = await get('/financiamento'); assert.equal(hub.status, 200);
    assert.match(await hub.text(), /<title>Financiamento de carro por banco: compare taxas \| Placa na Mão<\/title>/);
    assert.equal((await get('/financiamento/banco-que-nao-existe')).status, 404);
  });

  it('entram no sitemap e no painel de SEO', async () => {
    const xml = await (await fetch(`${server.base}/sitemap.xml`)).text();
    assert.match(xml, /\/financiamento\/bradesco<\/loc>/); assert.match(xml, /\/financiamento<\/loc>/);
    const items = (await adm.call('/api/admin/content/seo/pages')).json.items;
    const it1 = items.find((i) => i.path === '/financiamento/bradesco');
    assert.equal(it1.kind, 'bank'); assert.equal(it1.h1, 'Financiamento de carro Bradesco'); assert.match(it1.keyword ?? it1.defaultKeyword, /financiamento de carro Bradesco/i);
    assert.equal(items.find((i) => i.path === '/financiamento').kind, 'hub');
  });

  it('API pública entrega os blocos com a taxa e 404 para página inexistente', async () => {
    const ok = await hostRequest(server.base, '/api/simulator/financing-page?path=/financiamento/bradesco');
    assert.equal(ok.status, 200); assert.ok(ok.json.blocks.length >= 3); assert.ok(ok.json.faq.length >= 3);
    assert.equal((await hostRequest(server.base, '/api/simulator/financing-page?path=/financiamento/nada')).status, 404);
    const cfg = await hostRequest(server.base, '/api/simulator/config'); assert.equal(cfg.json.financingHub, true);
  });

  it('título e descrição do banco podem ser trocados no painel e valem no HTML', async () => {
    const put = await adm.call('/api/admin/content/seo/pages', { method: 'PUT', body: { path: '/financiamento/bradesco', h1: 'Financiamento Bradesco carro', title: 'Financiamento de carro Bradesco 2026: taxa hoje | Placa na Mão', description: 'Veja a taxa atual do Bradesco para financiar carro novo ou usado, simule a parcela e compare o custo total com outros bancos.', keyword: 'financiamento de carro bradesco', sections: [{ h: 'Dica do Bradesco', p: 'Compare sempre o CET antes de assinar.' }], faq: [], noindex: false } });
    assert.equal(put.status, 200, put.text);
    const h = await (await get('/financiamento/bradesco')).text();
    assert.match(h, /<title>Financiamento de carro Bradesco 2026: taxa hoje \| Placa na Mão<\/title>/);
    if (h.includes('<div id="root">')) { assert.match(h, /Dica do Bradesco/); assert.match(h, /Financiamento Bradesco carro/); }
  });

  it('página criada no painel: cria, aparece no site, não duplica, bloqueia restaurar e exclui', async () => {
    const body = { slug: 'financiamento-carro-usado-caixa', h1: 'Financiamento de carro usado Caixa', title: 'Financiamento de carro usado Caixa: taxa e simulação | Placa na Mão', description: 'Simule o financiamento de carro usado da Caixa, veja parcela, CET e custo total e compare com outros bancos antes de decidir.', keyword: 'financiamento de carro usado caixa' };
    const c = await adm.call('/api/admin/content/seo/pages/custom', { method: 'POST', body });
    assert.equal(c.status, 201, c.text); assert.equal(c.json.path, '/financiamento/financiamento-carro-usado-caixa');
    assert.equal((await adm.call('/api/admin/content/seo/pages/custom', { method: 'POST', body })).status, 409);
    assert.equal((await adm.call('/api/admin/content/seo/pages/custom', { method: 'POST', body: { ...body, slug: 'Nome Inválido!' } })).status, 400);
    const r = await get(c.json.path); assert.equal(r.status, 200);
    assert.match(await r.text(), /<title>Financiamento de carro usado Caixa: taxa e simulação \| Placa na Mão<\/title>/);
    assert.match(await (await fetch(`${server.base}/sitemap.xml`)).text(), /financiamento-carro-usado-caixa<\/loc>/);
    assert.equal((await adm.call('/api/admin/content/seo/pages/reset', { method: 'POST', body: { path: c.json.path } })).status, 422);
    assert.equal((await adm.call(`/api/admin/content/seo/pages/custom?path=${encodeURIComponent('/financiamento/bradesco')}`, { method: 'DELETE' })).status, 422, 'página de banco não se exclui');
    const del = await adm.call(`/api/admin/content/seo/pages/custom?path=${encodeURIComponent(c.json.path)}`, { method: 'DELETE' });
    assert.equal(del.status, 200, del.text);
    assert.equal((await get(c.json.path)).status, 404);
  });

  it('banco desativado deixa de ter página', async () => {
    const off = await pool.query(`SELECT id FROM financing_banks WHERE name='Bradesco'`);
    const r = await adm.call(`/api/admin/simulator/banks/${off.rows[0].id}`, { method: 'PUT', body: { active: false } });
    assert.equal(r.status, 200, r.text);
    await pool.query(`DELETE FROM seo_pages WHERE path='/financiamento/bradesco'`);
    assert.equal((await get('/financiamento/bradesco')).status, 404);
    await pool.query(`UPDATE financing_banks SET active=true WHERE name='Bradesco'`);
  });
});
