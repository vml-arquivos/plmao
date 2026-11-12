import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

/**
 * Garantia de produção: cada consulta à venda faz o caminho inteiro (provedor → relatório → JSON, HTML, PDF e link) sem erro,
 * entrega exatamente as seções do produto e o PDF sai legível. Também cobre a limpeza do painel.
 */
const PRODUTOS = {
  CADASTRAL: { tem: ['IDENTIFICACAO', 'CARACTERISTICAS', 'REGISTRO'], nao: ['DEBITOS', 'HISTORICO', 'PROPRIETARIO', 'ANALISES'] },
  LIEN: { tem: ['IDENTIFICACAO', 'GRAVAME'], nao: ['DEBITOS', 'HISTORICO', 'PROPRIETARIO'] },
  AUCTION: { tem: ['IDENTIFICACAO', 'CARACTERISTICAS', 'REGISTRO', 'RESTRICOES'], nao: ['DEBITOS', 'GRAVAME', 'PROPRIETARIO'] },
  BASIC: { tem: ['IDENTIFICACAO', 'DEBITOS', 'RESTRICOES', 'PROPRIETARIO'], nao: [] },
  COMPLETE: { tem: ['IDENTIFICACAO', 'DEBITOS', 'RESTRICOES'], nao: [] },
  PREMIUM: { tem: ['IDENTIFICACAO', 'DEBITOS', 'RESTRICOES'], nao: [] }
};
/** O que cada produto entrega quando o provedor devolve todas as fontes (leilão com registros, sinistro, FIPE, gravame…). */
const COM_TODAS_AS_FONTES = {
  CADASTRAL: { tem: ['IDENTIFICACAO', 'CARACTERISTICAS', 'REGISTRO'], nao: ['DEBITOS', 'HISTORICO', 'PROPRIETARIO', 'ANALISES'], analises: false },
  AUCTION: { tem: ['IDENTIFICACAO', 'REGISTRO', 'RESTRICOES', 'HISTORICO', 'ANALISES'], nao: ['DEBITOS', 'GRAVAME', 'PROPRIETARIO', 'FIPE'], analises: true },
  BASIC: { tem: ['IDENTIFICACAO', 'DEBITOS', 'RESTRICOES', 'HISTORICO', 'ANALISES', 'PROPRIETARIO'], nao: [], analises: true },
  COMPLETE: { tem: ['IDENTIFICACAO', 'DEBITOS', 'RESTRICOES', 'HISTORICO', 'ANALISES'], nao: [], analises: true },
  PREMIUM: { tem: ['IDENTIFICACAO', 'DEBITOS', 'RESTRICOES', 'HISTORICO', 'ANALISES'], nao: [], analises: true }
};

function pdfText(buf) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-')), 'r.pdf');
  fs.writeFileSync(f, buf);
  try { return execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }); } catch { return null; }
}

describe('garantia de produção: todas as consultas, do dado ao PDF', integration, () => {
  let pool; let server; let token; let userId; let sa; let op;
  const ids = {};
  const call = (p, o = {}) => hostRequest(server.base, p, { token, ...o });

  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    server = await startServer({ ADMIN_HOSTS: 'admin.placanamao.test' });
    const reg = await call('/api/auth/register', { method: 'POST', token: undefined, body: { name: 'Cliente Garantia', email: `${uid('gar')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    assert.equal(reg.status, 201, reg.text);
    token = reg.json.token; userId = reg.json.user.id;
    await pool.query('UPDATE wallets SET balance_cents=1000000 WHERE user_id=$1', [userId]);
    sa = await adminSession({ server, pool, role: 'SUPER_ADMIN' });
    op = await adminSession({ server, pool, role: 'OPERADOR' });
  });
  after(async () => { await server.stop(); await pool.end(); });

  for (const [productId, regra] of Object.entries(PRODUTOS)) {
    it(`${productId}: consulta, relatório, HTML, PDF legível e link de visualização`, async () => {
      const r = await call('/api/queries', { method: 'POST', body: { plate: 'DEV1B11', productId } });
      assert.equal(r.status, 201, `${productId}: ${r.text.slice(0, 300)}`);
      const id = r.json.id; ids[productId] = id;
      const secoes = r.json.result.v2.sections.map((s) => s.key);
      for (const k of regra.tem) assert.ok(secoes.includes(k), `${productId} deveria ter ${k}: ${secoes}`);
      for (const k of regra.nao) assert.ok(!secoes.includes(k), `${productId} não deveria ter ${k}: ${secoes}`);
      assert.ok(r.json.result.v2.sections.every((s) => s.items.length > 0), 'nenhuma seção vazia');
      assert.ok(!r.text.includes('undefined') && !r.text.includes('[object Object]'), 'sem undefined/[object Object] no JSON');

      const html = await call(`/api/queries/${id}/report/print`);
      assert.equal(html.status, 200);
      assert.match(html.text, /DEV1B11/);
      assert.ok(!/undefined|\[object Object\]|NaN/.test(html.text.replace(/<style[\s\S]*?<\/style>/g, '')), `${productId}: HTML com valor quebrado`);

      const pdf = await fetch(`${server.base}/api/queries/${id}/report/pdf`, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(pdf.status, 200);
      const buf = Buffer.from(await pdf.arrayBuffer());
      assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
      assert.ok(buf.length > 8000, `${productId}: PDF pequeno demais`);
      const texto = pdfText(buf);
      if (texto != null) {
        assert.match(texto, /DEV1B11/);
        assert.doesNotMatch(texto, /undefined|\[object Object\]|NaN/);
        // O preço da consulta nunca aparece no PDF (nem o de venda, nem o de lista).
        const preco = (await pool.query('SELECT price_cents, list_price_cents, reference_price_cents FROM query_products WHERE id=$1', [productId])).rows[0];
        for (const cents of [preco.price_cents, preco.list_price_cents, preco.reference_price_cents].filter((c) => Number.isInteger(c) && c > 0)) {
          const reais = (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
          assert.ok(!texto.includes(`R$ ${reais}`) && !texto.includes(`R$${reais}`), `${productId}: o PDF mostra o preço da consulta (R$ ${reais})`);
        }
      }

      // Equipe: o mesmo PDF no painel e o link de visualização para enviar ao cliente (abre sem login, com relatório e PDF).
      const adminPdf = await sa.call(`/api/admin/queries/${id}/report/pdf`);
      assert.equal(adminPdf.status, 200, `${productId}: PDF do painel`);
      assert.equal(adminPdf.text.slice(0, 5), '%PDF-');
      const link = await sa.call(`/api/admin/queries/${id}/share`, { method: 'POST', body: { days: 3 } });
      assert.equal(link.status, 201, link.text);
      const tk = String(link.json.url).split('/r/')[1].split('?')[0];
      const pub = await hostRequest(server.base, `/api/shared-report/${tk}`);
      assert.equal(pub.status, 200, `${productId}: link público`);
      const pubPdf = await hostRequest(server.base, `/api/shared-report/${tk}/pdf`);
      assert.equal(pubPdf.status, 200, `${productId}: PDF do link`);
    });
  }

  it('com todas as fontes, cada produto entrega o seu relatório e o PDF sai com leilão, análises e sem valor quebrado', async () => {
    const { refreshScopes, scopeForProduct } = await import('../dist/lib/reportScope.js');
    const { buildReportV2, viewReport, tierForProductCode } = await import('../dist/report/normalizeV2.js');
    const { renderVehiclePdf } = await import('../dist/report/pdf.js');
    await refreshScopes();
    const raw = JSON.parse(fs.readFileSync(new URL('./fixtures/veiculototal-sucesso.json', import.meta.url), 'utf8'));
    raw.leilao = { data: { LEILAOCONJUGADO: { DESCRICAORETORNO: 'SUCESSO', REGISTRO_1: { DATA_LEILAO: '2023-05-10', LEILOEIRO: 'Leiloeiro Teste', LOTE: '12', CONDICAO: 'RECUPERAVEL' } } } };
    const full = buildReportV2(raw);
    for (const [productId, regra] of Object.entries(COM_TODAS_AS_FONTES)) {
      const scope = scopeForProduct(productId, new Date());
      const view = viewReport(full, { audience: 'client', tier: tierForProductCode(productId), sections: scope.sections, template: scope.template });
      const keys = view.sections.map((x) => x.key);
      for (const k of regra.tem) assert.ok(keys.includes(k), `${productId} deveria ter ${k}: ${keys}`);
      for (const k of regra.nao) assert.ok(!keys.includes(k), `${productId} não deveria ter ${k}: ${keys}`);
      const items = view.sections.flatMap((x) => x.items).filter((i) => i.state !== 'NOT_PROVIDED');
      if (regra.analises) {
        assert.ok(items.some((i) => i.key === 'AN_SCORE_LEILAO'), `${productId}: sem nível de risco de leilão`);
        assert.ok(items.some((i) => i.key === 'AN_SEGURO'), `${productId}: sem aceitação em seguro`);
        assert.ok(items.some((i) => i.key === 'AU_LEILAO' || i.key === 'VT_LEILAO'), `${productId}: sem leilão`);
      }
      const pdf = await renderVehiclePdf(view, { productName: productId, verificationCode: 'ABCD1234', verificationUrl: 'https://placanamao.test/validar/ABCD1234', consultedAt: new Date(), audience: 'client' });
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
      const texto = pdfText(pdf);
      if (texto != null) {
        assert.doesNotMatch(texto, /undefined|\[object Object\]|NaN/, `${productId}: PDF com valor quebrado`);
        if (regra.analises) assert.match(texto, /risco de leil/i, `${productId}: PDF sem o nível de risco de leilão`);
        if (regra.analises) assert.match(texto, /Leiloeiro Teste/, `${productId}: PDF sem o registro de leilão`);
      }
    }
  });

  it('o preço cobrado em cada consulta é o do catálogo e nenhuma ficou em processamento', async () => {
    const rows = (await pool.query(`SELECT q.product_id,q.status,q.price_cents,p.price_cents AS catalog FROM vehicle_queries q JOIN query_products p ON p.id=q.product_id WHERE q.user_id=$1`, [userId])).rows;
    assert.equal(rows.length, Object.keys(PRODUTOS).length);
    for (const r of rows) { assert.equal(r.status, 'SUCCESS', r.product_id); assert.equal(Number(r.price_cents), Number(r.catalog), r.product_id); }
  });

  it('painel: lista de consultas traz os cartões com o que o envio precisa', async () => {
    const r = await sa.call(`/api/admin/queries?customerId=${userId}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.length, Object.keys(PRODUTOS).length);
    for (const q of r.json) assert.ok(q.id && q.plate && q.productName && q.status && q.customer?.email);
  });

  it('limpeza: mostra a contagem, só apaga o que não gerou receita e deixa o resto intacto', async () => {
    const mk = async (status, extra = {}) => (await pool.query(`INSERT INTO vehicle_queries(user_id,plate,product_id,status,credits_cost,provider,price_cents,charge_source,payment_order_id,created_at) VALUES($1,'ZZZ9Z99','COMPLETE',$2,0,'test',0,'LEGACY_CREDIT',$3,COALESCE($4::timestamptz, now())) RETURNING id`, [userId, status, extra.order ?? null, extra.at ?? null])).rows[0].id;
    const mkOrder = async (status, at, paid = false) => (await pool.query(`INSERT INTO payment_orders(user_id,status,amount_cents,provider,external_reference,purchase_type,product_id,query_plate,created_at,paid_at) VALUES($1,$2,3459,'test',$3,'QUERY','COMPLETE','ZZZ9Z99',$4::timestamptz,$5) RETURNING id`, [userId, status, uid('ref'), at, paid ? new Date() : null])).rows[0].id;
    const antigo = new Date(Date.now() - 48 * 3600e3).toISOString();
    const falhou = await mk('FAILED');
    const travada = await mk('PROCESSING', { at: new Date(Date.now() - 5 * 3600e3).toISOString() });
    const recente = await mk('PROCESSING');
    const pago = await mkOrder('PAID', antigo, true);
    const falhaPaga = await mk('FAILED', { order: pago });
    const abandonado = await mkOrder('CHECKOUT_ACTIVE', antigo);
    const cancelado = await mkOrder('CANCELLED', new Date().toISOString());
    const aberto = await mkOrder('CHECKOUT_ACTIVE', new Date().toISOString());

    assert.equal((await op.call('/api/admin/queries/cleanup', { method: 'POST', body: { confirm: false } })).status, 403, 'operador não limpa');
    const prev = await sa.call('/api/admin/queries/cleanup', { method: 'POST', body: { confirm: false } });
    assert.equal(prev.status, 200, prev.text);
    const by = Object.fromEntries(prev.json.items.map((i) => [i.kind, i]));
    assert.ok(by.FAILED.deletable >= 1 && by.FAILED.kept >= 1, JSON.stringify(by.FAILED));
    assert.ok(by.STUCK.deletable >= 1 && by.UNPAID_ORDERS.deletable >= 2, JSON.stringify(by));
    const still = await pool.query('SELECT 1 FROM vehicle_queries WHERE id=$1', [falhou]);
    assert.equal(still.rowCount, 1, 'a prévia não apaga nada');

    const done = await sa.call('/api/admin/queries/cleanup', { method: 'POST', body: { confirm: true } });
    assert.equal(done.status, 200, done.text);
    const existe = async (table, id) => (await pool.query(`SELECT 1 FROM ${table} WHERE id=$1`, [id])).rowCount === 1;
    assert.equal(await existe('vehicle_queries', falhou), false);
    assert.equal(await existe('vehicle_queries', travada), false);
    assert.equal(await existe('payment_orders', abandonado), false);
    assert.equal(await existe('payment_orders', cancelado), false);
    // Intocados: processando há pouco tempo, pedido pago, falha ligada a pagamento, checkout aberto agora e todas as consultas bem-sucedidas.
    assert.equal(await existe('vehicle_queries', recente), true);
    assert.equal(await existe('payment_orders', pago), true);
    assert.equal(await existe('vehicle_queries', falhaPaga), true);
    assert.equal(await existe('payment_orders', aberto), true);
    const ok = await pool.query(`SELECT count(*)::int AS n FROM vehicle_queries WHERE user_id=$1 AND status='SUCCESS'`, [userId]);
    assert.equal(ok.rows[0].n, Object.keys(PRODUTOS).length);
    const audit = await pool.query(`SELECT 1 FROM audit_logs WHERE action='QUERY_CLEANUP'`);
    assert.ok(audit.rowCount >= 1);
  });
});
