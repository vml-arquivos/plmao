import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, useTestEnv } from './helpers/db.mjs';
import { startServer } from './helpers/server.mjs';

useTestEnv();
const { SEO_SEED } = await import('../dist/seoSeed.js');
const { pageMeta } = await import('../dist/seo.js');

const PROMESSA = /em segundos|tempo real|poucos segundos|aprovação garantida|garantid[oa]|qualquer veículo/i;
const TODOS = /todos os bancos/i; // só é problema em título, descrição e blocos; em pergunta, a resposta é a negação

describe('SEO: textos sem promessa sem prova', () => {
  it('nenhum título, descrição, bloco ou pergunta promete velocidade, tempo real ou aprovação', () => {
    for (const s of SEO_SEED) {
      const txt = [s.title, s.description, ...(s.sections ?? []).flatMap((x) => [x.h, x.p]), ...s.faq.flatMap((x) => [x.q, x.a])].filter(Boolean);
      for (const t of txt) assert.ok(!PROMESSA.test(t), `${s.path}: ${t.slice(0, 90)}`);
      for (const t of [s.title, s.description, ...(s.sections ?? []).flatMap((x) => [x.h, x.p])].filter(Boolean)) assert.ok(!TODOS.test(t), `${s.path}: ${t.slice(0, 90)}`);
    }
    for (const [p, m] of Object.entries(pageMeta)) assert.ok(!PROMESSA.test(`${m.title} ${m.description}`), p);
  });
  it('home, Sobre, Planos e Gravame têm textos complementares e a palavra-chave aparece neles', () => {
    for (const path of ['/', '/sobre', '/planos', '/consultar-gravame']) {
      const s = SEO_SEED.find((x) => x.path === path);
      assert.ok(s.sections.length >= 3, path);
      const t = [...s.sections.map((x) => `${x.h} ${x.p}`), ...s.faq.map((x) => `${x.q} ${x.a}`)].join(' ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      assert.ok(t.includes(s.keyword.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')), `${path}: palavra-chave fora do texto`);
    }
  });
  it('gravame explica gravame, alienação fiduciária e Renajud', () => {
    const t = SEO_SEED.find((x) => x.path === '/consultar-gravame').sections.map((x) => x.p).join(' ');
    assert.match(t, /alienação fiduciária/); assert.match(t, /Renajud/);
  });
  it('limites do painel respeitados: H1 até 30, título 30–65, descrição 70–165', () => {
    for (const s of SEO_SEED) {
      assert.ok(s.h1.length <= 30, `${s.path} h1 ${s.h1.length}`);
      if (s.title) assert.ok(s.title.length >= 30 && s.title.length <= 65, `${s.path} título ${s.title.length}`);
      if (s.description) assert.ok(s.description.length >= 70 && s.description.length <= 165, `${s.path} descrição ${s.description.length}`);
    }
  });
});

describe('SEO: migração editorial preserva o que foi editado e guarda o anterior', integration, () => {
  let server, pool;
  before(async () => { ({ pool } = await loadCore()); server = await startServer(); });
  after(async () => { await server.stop(); await pool.end(); });

  it('tabela de histórico existe e o texto novo chega ao HTML público', async () => {
    const seed = SEO_SEED.find((x) => x.path === '/consultar-gravame');
    await pool.query(`UPDATE seo_pages SET sections=$1::jsonb, faq=$2::jsonb, updated_by=NULL WHERE path='/consultar-gravame'`, [JSON.stringify(seed.sections), JSON.stringify(seed.faq)]);
    const t = await pool.query(`SELECT to_regclass('seo_pages_history') AS t`); assert.ok(t.rows[0].t);
    const h = await (await fetch(`${server.base}/consultar-gravame`, { headers: { accept: 'text/html' } })).text();
    assert.match(h, /<h2>Gravame, alienação fiduciária e Renajud: qual a diferença<\/h2>/);
    const home = await (await fetch(`${server.base}/`, { headers: { accept: 'text/html' } })).text();
    assert.ok(!/em segundos/.test(home.match(/<meta name="description" content="([^"]*)"/)[1]));
  });
  it('linha editada no painel nunca é sobrescrita pela revisão', async () => {
    const mig = (await import('../dist/migrations.placanamao.js')).placaMigrations.find((m) => m.id === '084_seo_revisao_editorial');
    const admin = await pool.query(`SELECT id FROM users WHERE role='ADMIN' LIMIT 1`);
    let uid = admin.rows[0]?.id;
    if (!uid) uid = (await pool.query(`INSERT INTO users(email,password_hash,name,role) VALUES('seo-edit@example.com','x','Editor','ADMIN') RETURNING id`)).rows[0].id;
    await pool.query(`UPDATE seo_pages SET title='Título editado por mim', updated_by=$1 WHERE path='/consultar-recall'`, [uid]);
    await pool.query(`UPDATE seo_pages SET title='Antigo título do gravame para teste de revisão', updated_by=NULL WHERE path='/consultar-gravame'`);
    const c = await pool.connect();
    try { await mig.up(c); } finally { c.release(); }
    assert.equal((await pool.query(`SELECT title FROM seo_pages WHERE path='/consultar-recall'`)).rows[0].title, 'Título editado por mim');
    const hist = await pool.query(`SELECT title FROM seo_pages_history WHERE path='/consultar-gravame' ORDER BY id DESC LIMIT 1`);
    assert.equal(hist.rows[0].title, 'Antigo título do gravame para teste de revisão');
    assert.notEqual((await pool.query(`SELECT title FROM seo_pages WHERE path='/consultar-gravame'`)).rows[0].title, 'Antigo título do gravame para teste de revisão');
  });
});
