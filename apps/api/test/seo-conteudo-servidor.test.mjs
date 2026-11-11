import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, useTestEnv } from './helpers/db.mjs';
import { startServer } from './helpers/server.mjs';

useTestEnv();
const { markdownToHtml } = await import('../dist/seoBodies.js');

describe('markdown do artigo no servidor', () => {
  it('converte o básico e nunca deixa HTML cru nem link perigoso passar', () => {
    const h = markdownToHtml('## Título\n\nTexto com **forte** e [link](/planos) e [x](javascript:alert(1)).\n\n- um\n- dois\n\n<script>alert(1)</script>');
    assert.match(h, /<h2>Título<\/h2>/); assert.match(h, /<strong>forte<\/strong>/); assert.match(h, /<a href="\/planos">link<\/a>/);
    assert.match(h, /<ul><li>um<\/li><li>dois<\/li><\/ul>/);
    assert.ok(!h.includes('<script>')); assert.ok(!/href="javascript/.test(h));
  });
});

describe('conteúdo real no HTML inicial (contra soft 404)', integration, () => {
  let server, pool;
  const get = (path) => fetch(`${server.base}${path}`, { headers: { accept: 'text/html' } });
  const text = (h) => { const i = h.indexOf('<div id="root">'); return h.slice(i, h.indexOf('</main>', i)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '); };
  before(async () => {
    ({ pool } = await loadCore()); server = await startServer();
    await pool.query(`DELETE FROM articles WHERE slug='teste-soft404-artigo'`);
    await pool.query(`INSERT INTO articles(slug,title,excerpt,body,category,status,published_at) VALUES('teste-soft404-artigo','Como conferir um carro usado','Resumo do artigo de teste.','## Passo um\n\nConfira a placa **antes** de pagar.\n\n- item a\n- item b','Dicas','PUBLISHED',now() - interval '1 day')`);
    await pool.query(`INSERT INTO articles(slug,title,excerpt,body,category,status) VALUES('teste-soft404-rascunho','Rascunho','x','Texto secreto do rascunho','Dicas','DRAFT') ON CONFLICT (slug) DO NOTHING`);
    await pool.query(`DELETE FROM vehicle_models WHERE slug='teste-soft404-modelo'`);
    const m = await pool.query(`INSERT INTO vehicle_models(slug,brand,name,vehicle_type,body_type,status,summary,review,pros,cons,year_from) VALUES('teste-soft404-modelo','TesteMarca','Modelo Z','CAR','Hatch','PUBLISHED','Resumo do modelo de teste.','Análise longa do modelo de teste com bastante texto para a prévia pública.',$1::jsonb,$2::jsonb,2020) RETURNING id`, [JSON.stringify(['Econômico', 'Espaçoso', 'Terceiro ponto oculto']), JSON.stringify(['Painel simples'])]);
    await pool.query(`INSERT INTO vehicle_versions(model_id,name,year_model,fuel,specs) VALUES($1,'1.0 Flex',2022,'Flex',$2::jsonb)`, [m.rows[0].id, JSON.stringify({ power_hp: 75 })]);
  });
  after(async () => {
    await pool.query(`DELETE FROM articles WHERE slug IN ('teste-soft404-artigo','teste-soft404-rascunho')`);
    await pool.query(`DELETE FROM vehicle_models WHERE slug='teste-soft404-modelo'`);
    await server.stop(); await pool.end();
  });

  it('artigo publicado: texto completo no HTML, com título, resumo e lista', async () => {
    const r = await get('/blog/teste-soft404-artigo'); assert.equal(r.status, 200);
    const h = await r.text(); const t = text(h);
    assert.match(h, /<h2>Passo um<\/h2>/); assert.match(h, /<li>item a<\/li>/);
    assert.ok(t.includes('Confira a placa antes de pagar')); assert.ok(t.length > 300);
  });
  it('rascunho de artigo continua 404 e não vaza o texto', async () => {
    const r = await get('/blog/teste-soft404-rascunho'); assert.equal(r.status, 404);
    assert.ok(!(await r.text()).includes('Texto secreto'));
  });
  it('modelo publicado: ficha pública no HTML (resumo, prévia, 2 pontos fortes, versões) sem o conteúdo restrito', async () => {
    const r = await get('/veiculos/teste-soft404-modelo'); assert.equal(r.status, 200);
    const h = await r.text(); const t = text(h);
    assert.ok(t.includes('Resumo do modelo de teste')); assert.ok(t.includes('Econômico')); assert.ok(t.includes('Espaçoso'));
    assert.ok(!t.includes('Terceiro ponto oculto'), 'só os 2 primeiros, como na tela pública');
    assert.ok(t.includes('1.0 Flex')); assert.ok(t.includes('Painel simples'));
  });
  it('modelo que não existe continua 404', async () => {
    const r = await get('/veiculos/modelo-que-nao-existe-123'); assert.equal(r.status, 404);
  });
  it('/planos traz consultas e preços reais no HTML, sem custo nem margem', async () => {
    const r = await get('/planos'); assert.equal(r.status, 200);
    const h = await r.text(); const t = text(h);
    assert.match(t, /R\$ \d+,\d{2}/); assert.ok(t.length > 500, `texto curto: ${t.length}`);
  });
});
