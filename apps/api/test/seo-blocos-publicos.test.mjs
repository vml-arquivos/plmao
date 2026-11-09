import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, useTestEnv } from './helpers/db.mjs';
import { adminSession, startServer } from './helpers/server.mjs';

useTestEnv();
const dist = existsSync(new URL('../../web/dist/index.html', import.meta.url));
let chromium = null;
try { chromium = createRequire(import.meta.url)('playwright').chromium; } catch { /* sem navegador neste ambiente */ }
const PATHS = ['/', '/sobre', '/consultar-gravame', '/planos', '/instalar', '/contato', '/perguntas-frequentes'];

describe('blocos e perguntas do painel (SEO) aparecem nas páginas públicas', { ...integration, skip: integration.skip || (!dist || !chromium ? 'sem build do front ou sem navegador' : false) }, () => {
  let server, pool, adm, browser;
  const call = (p, opts = {}) => adm.call(`/api${p}`, opts);
  before(async () => {
    ({ pool } = await loadCore()); server = await startServer(); adm = await adminSession({ server, pool, role: 'ADMIN' });
    browser = await chromium.launch();
  });
  after(async () => {
    for (const p of PATHS) await call('/admin/content/seo/pages/reset', { method: 'POST', body: { path: p } });
    await pool.query(`DELETE FROM faqs WHERE question='Pergunta repetida na central e no painel?'`);
    await browser?.close(); await server.stop(); await pool.end();
  });
  async function salvar(path, sections, faq) {
    const item = (await call('/admin/content/seo/pages')).json.items.find((i) => i.path === path);
    const r = await call('/admin/content/seo/pages', { method: 'PUT', body: { path, h1: item.h1, title: item.title, description: item.description, keyword: item.keyword, sections, faq, noindex: false } });
    assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.json)}`);
  }

  it('cada rota mostra, como texto visível, os blocos e as perguntas salvos; texto com script não executa', async () => {
    await pool.query(`INSERT INTO faqs(question,answer,display_order) VALUES('Pergunta repetida na central e no painel?','Resposta da central.',1)`);
    for (const p of PATHS) {
      await salvar(p, [{ h: `Bloco de teste ${p}`, p: p === '/sobre' ? 'Texto com <script>window.__xss=1</script> e <img src=x onerror="window.__xss=2">.' : 'Texto do bloco.' }],
        [{ q: `Pergunta de teste ${p}?`, a: 'Resposta de teste.' }, { q: 'Pergunta repetida na central e no painel?', a: 'Resposta do painel.' }]);
    }
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    for (const p of PATHS) {
      const pg = await ctx.newPage();
      await pg.goto(server.base + p, { waitUntil: 'load' });
      await pg.getByRole('heading', { name: `Bloco de teste ${p}` }).waitFor({ state: 'visible', timeout: 15000 });
      await pg.getByText(`Pergunta de teste ${p}?`).first().waitFor({ state: 'attached', timeout: 15000 });
      assert.equal(await pg.getByText(`Pergunta de teste ${p}?`).count(), 1, `${p}: pergunta do painel aparece uma vez`);
      assert.equal(await pg.evaluate(() => window.__xss), undefined, `${p}: texto cadastrado não executa`);
      await pg.close();
    }
    // pergunta que já está na central não repete nas páginas que mostram a central
    for (const p of ['/', '/planos']) {
      const pg = await ctx.newPage();
      await pg.goto(server.base + p, { waitUntil: 'load' });
      await pg.getByText(`Pergunta de teste ${p}?`).first().waitFor({ state: 'attached', timeout: 15000 });
      assert.equal(await pg.locator('summary', { hasText: 'Pergunta repetida na central e no painel?' }).count(), 1, `${p}: sem pergunta repetida`);
      await pg.close();
    }
    await ctx.close();
  });

  it('página sem blocos nem perguntas cadastrados não ganha seção vazia', async () => {
    await salvar('/contato', [], []);
    const ctx = await browser.newContext(); const pg = await ctx.newPage();
    await pg.goto(server.base + '/contato', { waitUntil: 'load' });
    await pg.waitForTimeout(1500);
    assert.equal(await pg.locator('.seo-content').count(), 0);
    await ctx.close();
  });
});
