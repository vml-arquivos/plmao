import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

describe('catálogo, FAQ e artigos editáveis no painel', integration, () => {
  let pool; let server; let sa; let op; let clientToken; let clientId;
  const pub = (path) => hostRequest(server.base, path);

  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    server = await startServer({ ADMIN_HOSTS: 'admin.placanamao.test' });
    sa = await adminSession({ server, pool, role: 'SUPER_ADMIN' });
    op = await adminSession({ server, pool, role: 'OPERADOR' });
    const reg = await hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { name: 'Cliente Conteúdo', email: `${uid('cnt')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    clientToken = reg.json.token; clientId = reg.json.user.id;
  });
  after(async () => { await server.stop(); await pool.end(); });

  it('catálogo público: produtos com conteúdo, matriz e pacotes; nunca expõe referência, custo ou margem', async () => {
    const r = await pub('/api/catalog');
    assert.equal(r.status, 200);
    const ids = r.json.products.map((p) => p.id);
    for (const id of ['COMPLETE', 'BASIC', 'AUCTION', 'LIEN', 'CADASTRAL']) assert.ok(ids.includes(id), id);
    assert.ok(!ids.includes('PREMIUM'));
    const complete = r.json.products.find((p) => p.id === 'COMPLETE');
    assert.equal(complete.priceCents, 6160);
    assert.equal(complete.badge, 'Mais completa');
    assert.ok(complete.tagline.length > 5 && complete.features.length >= 3);
    assert.equal(r.json.products.find((p) => p.id === 'AUCTION').commercialStatus, 'SOON');
    assert.ok(r.json.features.length >= 8);
    const lien = r.json.features.find((f) => f.key === 'gravame');
    assert.equal(complete.matrix[lien.id], 'INCLUDED');
    assert.equal(r.json.products.find((p) => p.id === 'CADASTRAL').matrix[lien.id], 'NOT_INCLUDED');
    assert.ok(r.json.packages.length >= 3);
    const text = r.text;
    for (const word of ['referencePrice', 'reference_price', 'providerCost', 'floor', 'margin', 'olhonocarro', 'Olho no Carro']) assert.ok(!text.includes(word), word);
  });

  it('reinício do servidor não desfaz preço e texto editados pelo dono', async () => {
    await pool.query(`UPDATE query_products SET name='Consulta Básica (editada)', price_cents=4399 WHERE id='BASIC'`);
    const { ensureSchema } = await import('../dist/schema.js');
    await ensureSchema();
    const row = (await pool.query(`SELECT name,price_cents FROM query_products WHERE id='BASIC'`)).rows[0];
    assert.equal(row.name, 'Consulta Básica (editada)');
    assert.equal(row.price_cents, 4399);
    await pool.query(`UPDATE query_products SET name='Consulta Básica', price_cents=4360 WHERE id='BASIC'`);
  });

  it('painel: produto aceita conteúdo, desconto e selo; exige permissão e sessão de admin', async () => {
    const denied = await hostRequest(server.base, '/api/admin/products/BASIC', { method: 'PATCH', token: clientToken, host: 'admin.placanamao.test', body: { badge: 'X' } });
    assert.ok([401, 403].includes(denied.status));
    const ok = await sa.call('/api/admin/products/BASIC', { method: 'PATCH', body: { badge: 'Oferta da semana', listPriceCents: 4999, tagline: 'Resumo editado', features: ['Item A', 'Item B'], showOnHome: true } });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.badge, 'Oferta da semana');
    const cat = await pub('/api/catalog');
    const basic = cat.json.products.find((p) => p.id === 'BASIC');
    assert.equal(basic.listPriceCents, 4999);
    assert.equal(basic.discountPercent, Math.round(((4999 - basic.priceCents) / 4999) * 100));
    assert.equal(basic.tagline, 'Resumo editado');
    assert.deepEqual(basic.features, ['Item A', 'Item B']);
    const badSections = await sa.call('/api/admin/products/BASIC', { method: 'PATCH', body: { reportSections: ['PROPRIETARIO'] } });
    assert.equal(badSections.status, 400);
    await sa.call('/api/admin/products/BASIC', { method: 'PATCH', body: { badge: 'Custo-benefício', listPriceCents: null, tagline: 'Cadastro, débitos, multas e restrições.' } });
  });

  it('seções do produto limitam o relatório: Gravame só mostra identificação e financiamento', async () => {
    await pool.query('UPDATE wallets SET balance_cents=100000 WHERE user_id=$1', [clientId]);
    const r = await hostRequest(server.base, '/api/queries', { method: 'POST', token: clientToken, body: { plate: 'DEV1B11', productId: 'LIEN' } });
    assert.equal(r.status, 201, r.text);
    const sections = r.json.result.v2.sections.map((s) => s.key);
    assert.ok(sections.includes('GRAVAME'));
    for (const s of ['DEBITOS', 'RESTRICOES', 'INSPECAO_RECALL', 'PROPRIETARIO', 'INTERNO']) assert.ok(!sections.includes(s), s);
    assert.equal(r.json.result.v2.debts.totalCents, 0);
  });

  it('FAQ: leitura pública; edição só com permissão; inativa some do site', async () => {
    const list = await pub('/api/faqs');
    assert.ok(list.json.faqs.length >= 10);
    const denied = await op.call('/api/admin/content/faqs', { method: 'POST', body: { question: 'Pergunta de teste?', answer: 'Resposta de teste.' } });
    assert.equal(denied.status, 403);
    const created = await sa.call('/api/admin/content/faqs', { method: 'POST', body: { category: 'Teste', question: 'Pergunta de teste?', answer: 'Resposta de teste.', displayOrder: 5 } });
    assert.equal(created.status, 201, created.text);
    assert.ok((await pub('/api/faqs')).json.faqs.some((f) => f.question === 'Pergunta de teste?'));
    await sa.call(`/api/admin/content/faqs/${created.json.id}`, { method: 'PATCH', body: { active: false } });
    assert.ok(!(await pub('/api/faqs')).json.faqs.some((f) => f.question === 'Pergunta de teste?'));
    assert.equal((await sa.call(`/api/admin/content/faqs/${created.json.id}`, { method: 'DELETE' })).status, 200);
  });

  it('artigos: rascunho não aparece; publicar libera lista, página, sitemap e SEO; slug único', async () => {
    const slug = `artigo-teste-${Math.random().toString(36).slice(2, 8)}`;
    const created = await sa.call('/api/admin/content/articles', { method: 'POST', body: { slug, title: 'Artigo de teste do painel', excerpt: 'Resumo do artigo.', body: '## Título\n\nTexto com **destaque**.\n\n- item 1\n- item 2', category: 'Teste', tags: ['a', 'b'], status: 'DRAFT' } });
    assert.equal(created.status, 201, created.text);
    assert.equal((await pub(`/api/articles/${slug}`)).status, 404);
    assert.ok(!(await pub('/api/articles')).json.articles.some((a) => a.slug === slug));
    assert.equal((await sa.call('/api/admin/content/articles', { method: 'POST', body: { slug, title: 'Outro artigo repetido', status: 'DRAFT' } })).status, 409);
    assert.equal((await sa.call('/api/admin/content/articles', { method: 'POST', body: { slug: 'x-y-z', title: 'Capa maliciosa', coverImageUrl: 'javascript:alert(1)' } })).status, 400);

    const published = await sa.call(`/api/admin/content/articles/${created.json.id}`, { method: 'PATCH', body: { status: 'PUBLISHED' } });
    assert.equal(published.status, 200);
    assert.ok(published.json.publishedAt);
    const page = await pub(`/api/articles/${slug}`);
    assert.equal(page.status, 200);
    assert.match(page.json.article.body, /destaque/);
    assert.ok(page.json.related.length >= 1);
    assert.ok((await pub('/api/articles')).json.articles.some((a) => a.slug === slug));

    const sitemap = await fetch(`${server.base}/sitemap.xml`).then((r) => r.text());
    assert.match(sitemap, new RegExp(`/blog/${slug}`));
    assert.ok(!sitemap.includes('/desenvolvedores'));
    const html = await fetch(`${server.base}/blog/${slug}`);
    if (html.status === 200) { // quando o frontend está compilado, o servidor injeta SEO do artigo
      const text = await html.text();
      assert.match(text, /Artigo de teste do painel \| Placa na Mão/);
      assert.match(text, /"@type":"Article"/);
    }
    await sa.call(`/api/admin/content/articles/${created.json.id}`, { method: 'DELETE' });
    assert.equal((await pub(`/api/articles/${slug}`)).status, 404);
  });

  it('API para integração não existe mais: nada de /api/v1 nem chaves de API', async () => {
    assert.equal((await pub('/api/v1/products')).status, 404);
    const keys = await hostRequest(server.base, '/api/account/api-keys', { token: clientToken });
    assert.equal(keys.status, 404);
  });
});
