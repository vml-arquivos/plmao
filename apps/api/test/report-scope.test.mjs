import assert from 'node:assert/strict';
import fs from 'node:fs';
import test, { before, after, describe, it } from 'node:test';
import { buildReportV2, viewReport } from '../dist/report/normalizeV2.js';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

useTestEnv();
const { validateScopeConfig, defaultScopeForTier, scopeCatalog } = await import('../dist/lib/reportScope.js');
const sample = JSON.parse(fs.readFileSync(new URL('./fixtures/exemplo-retorno-provedor.json', import.meta.url), 'utf8'));

const cfg = (fields, label) => ({ model: 'CATALOG_V1', sections: [
  { key: 'IDENTIFICACAO', fields: fields.filter((f) => ['PLACA', 'MARCA', 'MODELO'].includes(f)).map((key) => ({ key })) },
  { key: 'DEBITOS', fields: fields.filter((f) => f.startsWith('DEB') || f.startsWith('EXISTE')).map((key) => ({ key, ...(label?.[key] ? { label: label[key] } : {}) })) }
].filter((s) => s.fields.length) });

test('validação do escopo: recusa campo de pessoa, interno, fora do catálogo, seção errada, repetido e vazio', () => {
  assert.equal(validateScopeConfig(cfg(['PLACA', 'MARCA', 'DEBIPVA'])).ok, true);
  const bad = (config) => { const r = validateScopeConfig(config); assert.equal(r.ok, false); return r.errors.join(' | '); };
  assert.match(bad({ model: 'CATALOG_V1', sections: [{ key: 'PROPRIETARIO', fields: [{ key: 'PRONOME' }] }] }), /não pode ser entregue/);
  assert.match(bad({ model: 'CATALOG_V1', sections: [{ key: 'IDENTIFICACAO', fields: [{ key: 'CPF_CNPJ_PROPRIETARIO' }] }] }), /protegido|pertence/);
  assert.match(bad({ model: 'CATALOG_V1', sections: [{ key: 'INTERNO', fields: [{ key: 'CHAVERETORNO' }] }] }), /não pode ser entregue/);
  assert.match(bad({ model: 'CATALOG_V1', sections: [{ key: 'IDENTIFICACAO', fields: [{ key: 'NAO_EXISTE' }] }] }), /fora do catálogo/);
  assert.match(bad({ model: 'CATALOG_V1', sections: [{ key: 'DEBITOS', fields: [{ key: 'PLACA' }] }] }), /pertence à seção IDENTIFICACAO/);
  assert.match(bad({ model: 'CATALOG_V1', sections: [{ key: 'IDENTIFICACAO', fields: [{ key: 'PLACA' }, { key: 'PLACA' }] }] }), /repetido/);
  assert.match(bad({ model: 'CATALOG_V1', sections: [{ key: 'IDENTIFICACAO', fields: [{ key: 'PLACA', visible: false }] }] }), /ao menos um campo/);
  assert.equal(validateScopeConfig({ model: 'OUTRO', sections: [] }).ok, false);
});

test('catálogo editável nunca oferece proprietário nem controle interno; padrão por nível respeita o tier', () => {
  const keys = scopeCatalog().flatMap((s) => s.fields.map((f) => f.key));
  assert.ok(!keys.includes('PRONOME') && !keys.includes('CHAVERETORNO') && !keys.includes('CPF_CNPJ_PROPRIETARIO'));
  assert.ok(scopeCatalog().every((s) => s.key !== 'PROPRIETARIO' && s.key !== 'INTERNO'));
  const t1 = defaultScopeForTier(1).sections.flatMap((s) => s.fields.map((f) => f.key));
  assert.ok(t1.includes('PLACA') && !t1.includes('RESFURTO'));
  assert.equal(validateScopeConfig(defaultScopeForTier(3)).ok, true);
});

test('viewReport com modelo: só os campos escolhidos, rótulo trocado, fora-do-produto declarado e veredito parcial', () => {
  const report = buildReportV2(sample);
  const v = viewReport(report, { audience: 'client', tier: 1, template: { version: 3, config: cfg(['PLACA', 'MARCA', 'DEBIPVA', 'DEBDER'], { DEBDER: 'Multas estaduais' }) } });
  const keys = v.sections.flatMap((s) => s.items.map((i) => i.key));
  assert.deepEqual(keys.sort(), ['DEBDER', 'DEBIPVA', 'MARCA', 'PLACA']);
  assert.equal(v.sections.flatMap((s) => s.items).find((i) => i.key === 'DEBDER').label, 'Multas estaduais');
  assert.equal(v.scope.mode, 'TEMPLATE'); assert.equal(v.scope.templateVersion, 3);
  assert.ok(v.scope.notIncluded.some((n) => n.key === 'RESTRICOES'));
  assert.ok(!JSON.stringify(v).includes('PRONOME'));
  // "fora do produto" não vira "nada consta": sem restrições no produto, o veredito não pode ser "sem alertas"
  const clean = buildReportV2(structuredClone(sample));
  const only = viewReport(clean, { audience: 'client', tier: 1, template: { version: 1, config: cfg(['PLACA']) } });
  assert.notEqual(only.verdict.level, 'CLEAR');
  // equipe nunca é filtrada por modelo
  const team = viewReport(report, { audience: 'team', tier: 3, template: { version: 3, config: cfg(['PLACA']) } });
  assert.ok(team.sections.flatMap((s) => s.items).length > 5);
});

describe('escopo por produto ponta a ponta: relatório, API pública, HTML, PDF, snapshot e rollback', integration, () => {
  let pool; let server; let sa; let token; let userId; let key; let v1Id; let v2Id;
  const call = (path, opts = {}) => hostRequest(server.base, path, { token, ...opts });

  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    server = await startServer({ ADMIN_HOSTS: 'admin.placanamao.test', PUBLIC_API_ENABLED: 'true' });
    const reg = await hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { name: 'Cliente Escopo', email: `${uid('esc')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    token = reg.json.token; userId = reg.json.user.id;
    await pool.query('UPDATE wallets SET balance_cents=500000 WHERE user_id=$1', [userId]);
    sa = await adminSession({ server, pool, role: 'SUPER_ADMIN' });
    key = (await call('/api/account/api-keys', { method: 'POST', body: { name: 'escopo' } })).json.key;
  });
  after(async () => {
    await server.stop();
    // devolve o produto ao estado original para não influenciar os demais testes
    await pool.query(`DELETE FROM report_template_publications WHERE product_id='COMPLETE'`);
    const legacy = await pool.query(`SELECT id FROM report_templates WHERE product_id='COMPLETE' AND (config->>'model') IS DISTINCT FROM 'CATALOG_V1' ORDER BY version LIMIT 1`);
    if (legacy.rowCount) {
      await pool.query(`UPDATE product_report_configs SET template_id=$1 WHERE product_id='COMPLETE'`, [legacy.rows[0].id]);
      await pool.query(`DELETE FROM report_templates WHERE product_id='COMPLETE' AND config->>'model'='CATALOG_V1'`);
      await pool.query(`UPDATE report_templates SET status='PUBLISHED' WHERE id=$1`, [legacy.rows[0].id]);
    }
    await pool.end();
  });

  const fieldKeys = (report) => report.sections.flatMap((s) => s.items.map((i) => i.key));

  it('catálogo, prévia e publicação exigem dados válidos e ficam auditados', async () => {
    const cat = await sa.call('/api/admin/report-scope/catalog');
    assert.equal(cat.status, 200); assert.ok(cat.json.sections.length >= 6);
    const invalid = await sa.call('/api/admin/products/COMPLETE/report-scope', { method: 'POST', body: { name: 'ruim', config: { model: 'CATALOG_V1', sections: [{ key: 'IDENTIFICACAO', fields: [{ key: 'PRONOME' }] }] }, publish: true } });
    assert.equal(invalid.status, 400); assert.equal(invalid.json.error, 'INVALID_REPORT_SCOPE');
    const prev = await sa.call('/api/admin/products/COMPLETE/report-scope/preview', { method: 'POST', body: { config: cfg(['PLACA', 'MARCA', 'DEBIPVA']) } });
    assert.equal(prev.status, 200); assert.equal(prev.json.sample, true);
    assert.deepEqual(fieldKeys(prev.json.report).sort(), ['DEBIPVA', 'MARCA', 'PLACA']);
  });

  it('versão 1 publicada vale no app, na API, no HTML e no PDF', async () => {
    const created = await sa.call('/api/admin/products/COMPLETE/report-scope', { method: 'POST', body: { name: 'Identificação + IPVA', config: cfg(['PLACA', 'MARCA', 'DEBIPVA']), publish: true } });
    assert.equal(created.status, 201, created.text); v1Id = created.json.id;
    const q = await call('/api/queries', { method: 'POST', body: { plate: 'DEV1B11', productId: 'COMPLETE' } });
    assert.equal(q.status, 201, q.text);
    assert.deepEqual(fieldKeys(q.json.result.v2).sort(), ['DEBIPVA', 'MARCA', 'PLACA']);
    const rep = await call(`/api/queries/${q.json.id}/report`);
    assert.deepEqual(fieldKeys(rep.json.report).sort(), ['DEBIPVA', 'MARCA', 'PLACA']);
    assert.equal(rep.json.report.scope.templateVersion, created.json.version);
    const html = await call(`/api/queries/${q.json.id}/report/print`);
    assert.match(html.text, /Não incluído neste produto/); assert.ok(!/Furto|Restrição judicial/i.test(html.text));
    const pdf = await fetch(`${server.base}/api/queries/${q.json.id}/report/pdf`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(pdf.status, 200); assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    const api = await hostRequest(server.base, '/api/v1/vehicles', { method: 'POST', token: key, body: { plate: 'DEV1B11', product: 'COMPLETE' } });
    assert.equal(api.status, 201, api.text);
    assert.deepEqual(fieldKeys(api.json.result.v2).sort(), ['DEBIPVA', 'MARCA', 'PLACA']);
    const apiPdf = await fetch(`${server.base}/api/v1/vehicles/${api.json.id}/pdf`, { headers: { authorization: `Bearer ${key}` } });
    assert.equal(apiPdf.status, 200);
    v1Id = { template: v1Id, query: q.json.id, version: created.json.version };
  });

  it('nova versão não altera consultas antigas (snapshot) e a volta para a v1 é uma nova publicação', async () => {
    await new Promise((r) => setTimeout(r, 30));
    const v2 = await sa.call('/api/admin/products/COMPLETE/report-scope', { method: 'POST', body: { name: 'Só placa', config: cfg(['PLACA']), publish: true } });
    assert.equal(v2.status, 201); v2Id = v2.json.id;
    const newQ = await call('/api/queries', { method: 'POST', body: { plate: 'DEV1B11', productId: 'COMPLETE' } });
    assert.equal(newQ.status, 201, newQ.text);
    assert.deepEqual(fieldKeys(newQ.json.result.v2), ['PLACA']);
    const old = await call(`/api/queries/${v1Id.query}/report`);
    assert.deepEqual(fieldKeys(old.json.report).sort(), ['DEBIPVA', 'MARCA', 'PLACA']);
    const back = await sa.call(`/api/admin/report-scope/${v1Id.template}/publish`, { method: 'POST', body: {} });
    assert.equal(back.status, 200);
    const again = await call('/api/queries', { method: 'POST', body: { plate: 'DEV1B11', productId: 'COMPLETE' } });
    assert.deepEqual(fieldKeys(again.json.result.v2).sort(), ['DEBIPVA', 'MARCA', 'PLACA']);
    const state = await sa.call('/api/admin/products/COMPLETE/report-scope');
    assert.equal(state.json.currentVersion, v1Id.version); assert.equal(state.json.versions.length >= 2, true);
    const pubs = (await pool.query(`SELECT count(*)::int AS n FROM report_template_publications WHERE product_id='COMPLETE'`)).rows[0].n;
    assert.ok(pubs >= 3);
    const audits = (await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action='PUBLISH_REPORT_SCOPE'`)).rows[0].n;
    assert.ok(audits >= 3);
  });

  it('produto sem fonte ativa ou "em breve" não é cobrado: 409 e saldo intacto', async () => {
    const before = Number((await pool.query('SELECT balance_cents FROM wallets WHERE user_id=$1', [userId])).rows[0].balance_cents);
    const r = await call('/api/queries', { method: 'POST', body: { plate: 'DEV1B11', productId: 'AUCTION' } });
    assert.equal(r.status, 409, r.text); assert.equal(r.json.error, 'PRODUCT_NOT_AVAILABLE');
    assert.equal(Number((await pool.query('SELECT balance_cents FROM wallets WHERE user_id=$1', [userId])).rows[0].balance_cents), before);
  });

  it('o painel mostra o status efetivo (o que o público vê) e os bloqueios', async () => {
    const list = await sa.call('/api/admin/products');
    const auction = list.json.find((p) => p.id === 'AUCTION');
    assert.equal(auction.sellableNow, false);
    const complete = list.json.find((p) => p.id === 'COMPLETE');
    assert.ok(Array.isArray(complete.blockers));
    // gateway desativado no servidor de teste: nada "à venda" de verdade
    assert.ok(complete.blockers.some((b) => /Gateway/.test(b)));
    assert.equal(complete.effectiveStatus, 'SOON');
  });
});
