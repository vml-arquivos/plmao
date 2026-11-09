import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, useTestEnv } from './helpers/db.mjs';
import { startServer } from './helpers/server.mjs';

useTestEnv();
const { renderSeoHtml } = await import('../dist/seo.js');
const { SEO_SEED } = await import('../dist/seoSeed.js');
const { placaMigrations } = await import('../dist/migrations.placanamao.js');
const tpl = readFileSync(new URL('../../web/index.html', import.meta.url), 'utf8');
const TITULO = 'Simulador de financiamento de veículos grátis | Placa na Mão';
const PERGUNTAS = ['O simulador é gratuito?', 'Posso usar a taxa da proposta do meu banco?', 'A simulação consulta ofertas de todos os bancos?'];

describe('SEO do simulador: o que o Google recebe', () => {
  it('/simulador sai com título, descrição e canonical próprios, mesmo com parâmetros da simulação', () => {
    const h = renderSeoHtml(tpl, '/simulador', 'https://placanamao.com.br', {});
    assert.match(h, new RegExp(`<title>${TITULO}</title>`));
    assert.match(h, /<meta name="description" content="Use o simulador de financiamento de veículos grátis\./);
    assert.match(h, /<link rel="canonical" href="https:\/\/placanamao\.com\.br\/simulador"/);
    assert.doesNotMatch(h, /Consulte a placa e receba um relatório veicular completo/);
  });
  it('o conteúdo de fábrica tem o título, a descrição e as 3 perguntas novas', () => {
    const s = SEO_SEED.find((x) => x.path === '/simulador');
    assert.equal(s.title, TITULO);
    for (const q of PERGUNTAS) assert.ok(s.faq.some((f) => f.q === q), q);
  });
});

describe('migração 082 (simulador)', integration, () => {
  let pool;
  before(async () => { ({ pool } = await loadCore()); });
  after(async () => { await pool.end(); });
  const mig = placaMigrations.find((m) => m.id === '082_seo_simulador_texto');
  const rodar = async () => { const c = await pool.connect(); try { await mig.up(c); } finally { c.release(); } };
  it('troca só o texto de fábrica, mantém o que a equipe escreveu e não repete perguntas', async () => {
    const row = async () => (await pool.query(`SELECT title,description,faq FROM seo_pages WHERE path='/simulador'`)).rows[0];
    await pool.query(`UPDATE seo_pages SET title='Simulador de financiamento de veículo | Placa na Mão', description='Descrição escrita pela equipe.', faq='[]'::jsonb WHERE path='/simulador'`);
    await rodar();
    let r = await row();
    assert.equal(r.title, TITULO);
    assert.equal(r.description, 'Descrição escrita pela equipe.');
    assert.equal(r.faq.length, 3);
    await rodar();
    r = await row();
    assert.equal(r.faq.length, 3, 'rodar de novo não duplica');
    await pool.query(`UPDATE seo_pages SET title='Título da equipe' WHERE path='/simulador'`);
    await rodar();
    assert.equal((await row()).title, 'Título da equipe');
  });
});
