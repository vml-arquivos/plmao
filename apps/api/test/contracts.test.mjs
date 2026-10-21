import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import test, { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

useTestEnv();
const C = await import('../dist/lib/contracts.js');
const { decryptRaw } = await import('../dist/lib/rawStore.js');

test('termos: recusa item desconhecido, preço zero em item de catálogo e comissão acima de 50%', () => {
  const base = { validityMonths: 12, paymentTerms: 'Pix à vista' };
  assert.ok(C.termsSchema.safeParse({ ...base, items: [{ type: 'QUERY', productId: 'COMPLETE', agreedPriceCents: 1500 }] }).success);
  assert.equal(C.termsSchema.safeParse({ ...base, items: [{ type: 'QUERY', productId: 'COMPLETE', agreedPriceCents: 0 }] }).success, false);
  assert.equal(C.termsSchema.safeParse({ ...base, items: [{ type: 'OUTRO' }] }).success, false);
  assert.equal(C.termsSchema.safeParse({ ...base, commission: { bps: 6000, base: 'NET' } }).success, false);
  assert.equal(C.termsSchema.safeParse({ ...base, items: [], extra: 1 }).success, false);
});

test('renderização: variável desconhecida falha; todas as variáveis dos modelos iniciais existem', async () => {
  assert.throws(() => C.renderBody('Olá {{nao_existe}}', {}), /VARIABLE_UNKNOWN/);
  const { CONTRACT_MODELS } = await import('../dist/lib/contractModels.js');
  for (const m of CONTRACT_MODELS) assert.deepEqual(C.unknownVariables(`${m.title}\n${m.body}`), [], m.code);
});

test('descrição dos termos mostra preço, desconto e total do pacote personalizado', () => {
  const d = C.describeTerms({ items: [
    { type: 'QUERY', name: 'Consulta Completa', productId: 'COMPLETE', basePriceCents: 2000, unitPriceCents: 1500, discountPercent: 25 },
    { type: 'CUSTOM', name: 'Pacote 100', quantity: 100, unitPriceCents: 900, basePriceCents: 1000, discountPercent: 10, totalCents: 90000 }
  ], commission: undefined }, 7);
  assert.match(d.conditions, /R\$\s15,00 por consulta/); assert.match(d.conditions, /desconto de 25%/);
  assert.match(d.conditions, /100 un\. × R\$\s9,00/); assert.match(d.conditions, /R\$\s900,00/);
});

test('assinatura eletrônica desligada por padrão: envio recusado', async () => {
  await assert.rejects(() => C.sendForSignature(randomUUID(), randomUUID()), (e) => e.code === 'ESIGN_NOT_CONFIGURED');
});

const rawReq = (base, path, { method = 'GET', body } = {}) => {
  const url = new URL(base + path);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method, headers: { 'content-type': 'application/json', 'user-agent': 'teste/1.0' } }, (res) => {
      let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => { let json = null; try { json = JSON.parse(d); } catch { /* vazio */ } resolve({ status: res.statusCode, json }); });
    });
    req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end();
  });
};

describe('fluxo de contratos (integração)', integration, () => {
  let server, pool, a1, a2, fin, sup, orgId, affId, userId, savedFiscal;
  const created = {};
  before(async () => {
    ({ pool } = await loadCore());
    server = await startServer({ ESIGN_PROVIDER: 'internal' });
    a1 = await adminSession({ server, pool, role: 'ADMIN' }); a2 = await adminSession({ server, pool, role: 'SUPER_ADMIN' });
    fin = await adminSession({ server, pool, role: 'FINANCEIRO' }); sup = await adminSession({ server, pool, role: 'SUPORTE' });
    savedFiscal = (await pool.query('SELECT legal_name,cnpj FROM fiscal_settings WHERE id=1')).rows[0];
    await pool.query(`UPDATE fiscal_settings SET legal_name='PLACA NA MAO TESTE LTDA',cnpj='11222333000181' WHERE id=1`);
    orgId = (await pool.query(`INSERT INTO organizations(name,document) VALUES($1,'11444777000161') RETURNING id`, [uid('Loja')])).rows[0].id;
    affId = (await pool.query(`INSERT INTO affiliates(name,email,code,document) VALUES('Parceiro Teste',$1,$2,'52998224725') RETURNING id`, [`${uid('p')}@teste.com`, uid('COD').toUpperCase()])).rows[0].id;
    userId = (await pool.query(`INSERT INTO users(email,password_hash,name,role) VALUES($1,'x','Maria da Silva','CLIENTE') RETURNING id`, [`${uid('c')}@teste.com`])).rows[0].id;
    await pool.query(`INSERT INTO user_profiles(user_id,cpf_cnpj) VALUES($1,'52998224725') ON CONFLICT(user_id) DO UPDATE SET cpf_cnpj='52998224725'`, [userId]);
    await pool.query(`UPDATE query_products SET floor_price_cents=500 WHERE id='COMPLETE'`);
  });
  after(async () => {
    await pool.query(`UPDATE fiscal_settings SET legal_name=$1,cnpj=$2 WHERE id=1`, [savedFiscal.legal_name, savedFiscal.cnpj]);
    await pool.query('DELETE FROM organization_query_prices WHERE organization_id=$1', [orgId]);
    await pool.query('DELETE FROM organizations WHERE id=$1', [orgId]);
    await server.stop(); await pool.end();
  });

  const publishModel = async (code) => {
    const list = await a1.call('/api/admin/contract-models');
    const tpl = list.json.items.find((t) => t.code === code);
    const draft = tpl.versions.find((v) => v.status === 'DRAFT') ?? null;
    let vid = draft?.id;
    if (!vid) {
      const cur = await a1.call(`/api/admin/contract-model-versions/${tpl.versions[0].id}`);
      vid = (await a1.call(`/api/admin/contract-models/${tpl.id}/versions`, { method: 'POST', body: { title: cur.json.title, body: cur.json.body } })).json.id;
    }
    assert.equal((await a1.call(`/api/admin/contract-model-versions/${vid}/submit`, { method: 'POST' })).status, 200);
    return vid;
  };

  it('modelos iniciais são minutas em rascunho e só publicam com revisão jurídica de outra pessoa', async () => {
    const list = await a1.call('/api/admin/contract-models');
    assert.equal(list.status, 200); assert.ok(list.json.items.length >= 5);
    const vid = await publishModel('PJ_B2B');
    assert.equal((await a1.call(`/api/admin/contract-model-versions/${vid}/publish`, { method: 'POST' })).status, 409, 'não publica sem aprovação');
    assert.equal((await a2.call(`/api/admin/contract-model-versions/${vid}/approve`, { method: 'POST', body: {} })).status, 400, 'exige referência do parecer');
    // quem escreveu a versão (a1 criou a nova versão) não aprova a própria
    const own = await a1.call(`/api/admin/contract-model-versions/${vid}`);
    const mine = (await pool.query('SELECT created_by FROM contract_template_versions WHERE id=$1', [vid])).rows[0].created_by;
    if (mine) assert.equal((await a1.call(`/api/admin/contract-model-versions/${vid}/approve`, { method: 'POST', body: { legalReviewRef: 'Parecer 123/2026' } })).status, 403);
    assert.equal(own.status, 200);
    assert.equal((await a2.call(`/api/admin/contract-model-versions/${vid}/approve`, { method: 'POST', body: { legalReviewRef: 'Parecer 123/2026 — Dra. Teste' } })).status, 200);
    assert.equal((await a2.call(`/api/admin/contract-model-versions/${vid}/publish`, { method: 'POST' })).status, 200);
    for (const code of ['PF_AVULSO', 'PACOTE_PERSONALIZADO', 'PARCEIRO', 'ADITIVO']) {
      const v = await publishModel(code);
      await a2.call(`/api/admin/contract-model-versions/${v}/approve`, { method: 'POST', body: { legalReviewRef: 'Parecer 123/2026 — Dra. Teste' } });
      assert.equal((await a2.call(`/api/admin/contract-model-versions/${v}/publish`, { method: 'POST' })).status, 200);
    }
  });

  it('rejeita variável desconhecida ao salvar versão de modelo', async () => {
    const list = await a1.call('/api/admin/contract-models'); const t = list.json.items[0];
    const r = await a1.call(`/api/admin/contract-models/${t.id}/versions`, { method: 'POST', body: { title: 'Título válido', body: 'Texto com {{variavel_inventada}} '.repeat(5) } });
    assert.equal(r.status, 400); assert.equal(r.json.error, 'CONTRACT_VARIABLE_UNKNOWN');
  });

  it('permissões: suporte não vê contratos; financeiro só consulta; só admin cria', async () => {
    assert.equal((await sup.call('/api/admin/contracts')).status, 403);
    assert.equal((await fin.call('/api/admin/contracts')).status, 200);
    assert.equal((await fin.call('/api/admin/contracts', { method: 'POST', body: {} })).status, 403);
    assert.equal((await hostRequest(server.base, '/api/admin/contracts', { host: 'admin.placanamao.test' })).status, 401);
  });

  const pjBody = (price = 1500) => ({ templateCode: 'PJ_B2B', organizationId: orgId, signer: { name: 'João Representante', email: 'joao@loja.test' },
    terms: { items: [{ type: 'QUERY', productId: 'COMPLETE', agreedPriceCents: price }, { type: 'CUSTOM', name: 'Pacote 50 consultas', quantity: 50, unitPriceCents: 1200, discountPercent: 10 }], validityMonths: 12, paymentTerms: 'Pix antecipado, mediante cobrança.' } });

  it('recusa preço abaixo do piso e dados fiscais da empresa ausentes', async () => {
    const low = await a1.call('/api/admin/contracts', { method: 'POST', body: pjBody(100) });
    assert.equal(low.status, 422); assert.equal(low.json.error, 'PRICE_BELOW_FLOOR');
    await pool.query(`UPDATE fiscal_settings SET cnpj=NULL WHERE id=1`);
    const noFiscal = await a1.call('/api/admin/contracts', { method: 'POST', body: pjBody() });
    await pool.query(`UPDATE fiscal_settings SET cnpj='11222333000181' WHERE id=1`);
    assert.equal(noFiscal.status, 422); assert.equal(noFiscal.json.error, 'CONTRACTOR_DATA_MISSING');
  });

  it('tipo de parte errado para o modelo é recusado', async () => {
    const r = await a1.call('/api/admin/contracts', { method: 'POST', body: { ...pjBody(), templateCode: 'PF_AVULSO' } });
    assert.equal(r.status, 422); assert.equal(r.json.error, 'CONTRACT_PARTY_KIND_MISMATCH');
  });

  it('ciclo completo: criar → aprovar por outra pessoa → enviar → assinar → aplicar preços', async () => {
    const pre = await a1.call('/api/admin/contracts/preview', { method: 'POST', body: pjBody() });
    assert.equal(pre.status, 200); assert.match(pre.json.body, /R\$\s15,00 por consulta/);
    const c = await a1.call('/api/admin/contracts', { method: 'POST', body: pjBody() });
    assert.equal(c.status, 201); created.pj = c.json;
    const id = c.json.id;
    assert.equal((await a1.call(`/api/admin/contracts/${id}/approve`, { method: 'POST' })).status, 409, 'rascunho não aprova');
    assert.equal((await a1.call(`/api/admin/contracts/${id}/send`, { method: 'POST' })).status, 409, 'não envia sem aprovação');
    assert.equal((await a1.call(`/api/admin/contracts/${id}/submit`, { method: 'POST' })).status, 200);
    assert.equal((await a1.call(`/api/admin/contracts/${id}`, { method: 'PATCH', body: { signer: { name: 'Outro Nome', email: 'x@y.test' } } })).status, 409, 'congelado após enviar para aprovação');
    const self = await a1.call(`/api/admin/contracts/${id}/approve`, { method: 'POST' });
    assert.equal(self.status, 403); assert.equal(self.json.error, 'CONTRACT_APPROVER_MUST_DIFFER');
    assert.equal((await a2.call(`/api/admin/contracts/${id}/approve`, { method: 'POST' })).status, 200);
    assert.equal((await a2.call(`/api/admin/contracts/${id}/apply`, { method: 'POST' })).status, 409, 'não aplica antes de assinado');

    const sent = await a1.call(`/api/admin/contracts/${id}/send`, { method: 'POST' });
    assert.equal(sent.status, 200);
    const mail = (await pool.query(`SELECT payload,template,to_email FROM email_outbox WHERE related_type='CONTRACT' AND related_id=$1`, [id])).rows[0];
    assert.equal(mail.template, 'CONTRACT_SIGN_REQUEST'); assert.equal(mail.to_email, 'joao@loja.test');
    assert.doesNotMatch(JSON.stringify(mail.payload), /11444777000161|11\.444\.777/, 'sem CNPJ no e-mail');
    const token = decryptRaw(mail.payload.tokenEnc);

    const page = await rawReq(server.base, `/api/contracts/sign/${token}`);
    assert.equal(page.status, 200); assert.equal(page.json.canSign, true); assert.match(page.json.body, /11\.444\.777\/0001-61/);
    const hash = page.json.bodyHash;
    assert.equal((await rawReq(server.base, `/api/contracts/sign/${token}`, { method: 'POST', body: { name: 'João Representante', accept: false, bodyHash: hash } })).status, 422);
    assert.equal((await rawReq(server.base, `/api/contracts/sign/${token}`, { method: 'POST', body: { name: 'Outra Pessoa', accept: true, bodyHash: hash } })).status, 422);
    assert.equal((await rawReq(server.base, `/api/contracts/sign/${token}`, { method: 'POST', body: { name: 'João Representante', accept: true, bodyHash: 'a'.repeat(64) } })).status, 409);
    assert.equal((await rawReq(server.base, `/api/contracts/sign/${'z'.repeat(43)}`)).status, 404);
    const ok = await rawReq(server.base, `/api/contracts/sign/${token}`, { method: 'POST', body: { name: 'joão representante', accept: true, bodyHash: hash } });
    assert.equal(ok.status, 200);
    assert.equal((await rawReq(server.base, `/api/contracts/sign/${token}`, { method: 'POST', body: { name: 'João Representante', accept: true, bodyHash: hash } })).status, 404, 'link usado não vale de novo');

    const detail = await a1.call(`/api/admin/contracts/${id}`);
    assert.equal(detail.json.status, 'ASSINADO');
    assert.equal(detail.json.signers[0].method, 'ACEITE_ELETRONICO_SIMPLES'); assert.ok(detail.json.signers[0].ip_hash);
    assert.deepEqual(detail.json.events.map((e) => e.event), ['CRIADO', 'ENVIADO_PARA_APROVACAO', 'APROVADO', 'ENVIADO_PARA_ASSINATURA', 'ASSINADO_PELO_SIGNATARIO', 'CONTRATO_ASSINADO']);

    const signedMail = (await pool.query(`SELECT payload FROM email_outbox WHERE related_type='CONTRACT' AND related_id=$1 AND template='CONTRACT_SIGNED'`, [id])).rows[0];
    const viewToken = decryptRaw(signedMail.payload.tokenEnc);
    const viewed = await rawReq(server.base, `/api/contracts/view/${viewToken}`);
    assert.equal(viewed.status, 200); assert.equal(viewed.json.bodyHash, hash);

    assert.equal((await fin.call(`/api/admin/contracts/${id}/apply`, { method: 'POST' })).status, 403, 'aplicar exige permissão de preços');
    const applied = await a1.call(`/api/admin/contracts/${id}/apply`, { method: 'POST' });
    assert.equal(applied.status, 200); assert.deepEqual(applied.json.manual, ['Pacote 50 consultas']);
    const price = await pool.query(`SELECT price_cents,ends_at > starts_at AS ok FROM organization_query_prices WHERE organization_id=$1 AND product_id='COMPLETE'`, [orgId]);
    assert.equal(price.rows[0].price_cents, 1500); assert.equal(price.rows[0].ok, true);
    assert.equal((await a1.call(`/api/admin/contracts/${id}/apply`, { method: 'POST' })).status, 409, 'não aplica duas vezes');
    assert.equal((await a1.call(`/api/admin/contracts/${id}/cancel`, { method: 'POST', body: { reason: 'tentativa' } })).status, 409, 'assinado não cancela');
  });

  it('a trilha de eventos é imutável', async () => {
    await assert.rejects(() => pool.query(`UPDATE contract_events SET event='X' WHERE contract_id=$1`, [created.pj.id]), /imutavel/);
    await assert.rejects(() => pool.query(`DELETE FROM contract_events WHERE contract_id=$1`, [created.pj.id]), /imutavel/);
  });

  it('cancelar revoga o link; link expirado não assina', async () => {
    const mk = async () => {
      const c = await a1.call('/api/admin/contracts', { method: 'POST', body: pjBody(1400) });
      await a1.call(`/api/admin/contracts/${c.json.id}/submit`, { method: 'POST' }); await a2.call(`/api/admin/contracts/${c.json.id}/approve`, { method: 'POST' });
      await a1.call(`/api/admin/contracts/${c.json.id}/send`, { method: 'POST' });
      const m = (await pool.query(`SELECT payload FROM email_outbox WHERE related_id=$1 AND template='CONTRACT_SIGN_REQUEST'`, [c.json.id])).rows[0];
      return { id: c.json.id, token: decryptRaw(m.payload.tokenEnc) };
    };
    const one = await mk();
    assert.equal((await a1.call(`/api/admin/contracts/${one.id}/cancel`, { method: 'POST', body: { reason: 'erro de preço' } })).status, 200);
    assert.equal((await rawReq(server.base, `/api/contracts/sign/${one.token}`)).status, 404);
    const two = await mk();
    await pool.query(`UPDATE contracts SET expires_at=now() - interval '1 hour' WHERE id=$1`, [two.id]);
    const page = await rawReq(server.base, `/api/contracts/sign/${two.token}`);
    assert.equal(page.json?.canSign ?? false, false);
  });

  it('contrato alterado depois de aprovado não é enviado', async () => {
    const c = await a1.call('/api/admin/contracts', { method: 'POST', body: pjBody(1300) });
    await a1.call(`/api/admin/contracts/${c.json.id}/submit`, { method: 'POST' }); await a2.call(`/api/admin/contracts/${c.json.id}/approve`, { method: 'POST' });
    await pool.query(`UPDATE contracts SET rendered_body=rendered_body || ' x', body_hash='${'b'.repeat(64)}' WHERE id=$1`, [c.json.id]);
    const r = await a1.call(`/api/admin/contracts/${c.json.id}/send`, { method: 'POST' });
    assert.equal(r.status, 409); assert.equal(r.json.error, 'CONTRACT_CHANGED_AFTER_APPROVAL');
  });

  it('parceiro: comissão entra no contrato e só vale para o parceiro depois de assinado e aplicado', async () => {
    const before = (await pool.query('SELECT commission_bps FROM affiliates WHERE id=$1', [affId])).rows[0].commission_bps;
    const c = await a1.call('/api/admin/contracts', { method: 'POST', body: { templateCode: 'PARCEIRO', affiliateId: affId, signer: { name: 'Parceiro Teste', email: 'parceiro@teste.test' }, terms: { items: [], validityMonths: 12, paymentTerms: 'Repasse mensal por Pix.', commission: { bps: 1250, base: 'NET' } } } });
    assert.equal(c.status, 201);
    assert.equal((await pool.query('SELECT commission_bps FROM affiliates WHERE id=$1', [affId])).rows[0].commission_bps, before, 'criar não altera comissão');
    const pre = await a1.call(`/api/admin/contracts/${c.json.id}`); assert.match(pre.json.rendered_body, /12,5%/);
    await a1.call(`/api/admin/contracts/${c.json.id}/submit`, { method: 'POST' }); await a2.call(`/api/admin/contracts/${c.json.id}/approve`, { method: 'POST' });
    await a1.call(`/api/admin/contracts/${c.json.id}/send`, { method: 'POST' });
    const m = (await pool.query(`SELECT payload FROM email_outbox WHERE related_id=$1 AND template='CONTRACT_SIGN_REQUEST'`, [c.json.id])).rows[0];
    const token = decryptRaw(m.payload.tokenEnc);
    const page = await rawReq(server.base, `/api/contracts/sign/${token}`);
    assert.equal((await rawReq(server.base, `/api/contracts/sign/${token}`, { method: 'POST', body: { name: 'Parceiro Teste', accept: true, bodyHash: page.json.bodyHash } })).status, 200);
    assert.equal((await pool.query('SELECT commission_bps FROM affiliates WHERE id=$1', [affId])).rows[0].commission_bps, before, 'assinar não altera comissão');
    assert.equal((await a1.call(`/api/admin/contracts/${c.json.id}/apply`, { method: 'POST' })).status, 200);
    assert.equal((await pool.query('SELECT commission_bps FROM affiliates WHERE id=$1', [affId])).rows[0].commission_bps, 1250);
  });

  it('pessoa física e aditivo (só de contrato assinado, mesma parte)', async () => {
    const pf = await a1.call('/api/admin/contracts', { method: 'POST', body: { templateCode: 'PF_AVULSO', userId, signer: { name: 'Maria da Silva', email: 'maria@teste.test' }, terms: { items: [{ type: 'QUERY', productId: 'COMPLETE', agreedPriceCents: 1800 }], validityMonths: 6, paymentTerms: 'Pagamento no checkout.' } } });
    assert.equal(pf.status, 201);
    const badAdd = await a1.call('/api/admin/contracts', { method: 'POST', body: { ...pjBody(), templateCode: 'ADITIVO', parentContractId: pf.json.id } });
    assert.equal(badAdd.status, 409, 'original não assinado');
    const add = await a1.call('/api/admin/contracts', { method: 'POST', body: { ...pjBody(1450), templateCode: 'ADITIVO', parentContractId: created.pj.id } });
    assert.equal(add.status, 201);
    const other = await a1.call('/api/admin/contracts', { method: 'POST', body: { templateCode: 'ADITIVO', affiliateId: affId, parentContractId: created.pj.id, signer: { name: 'Parceiro Teste', email: 'p@teste.test' }, terms: { items: [], validityMonths: 1, paymentTerms: 'x x', commission: { bps: 100, base: 'NET' } } } });
    assert.equal(other.status, 422); assert.equal(other.json.error, 'CONTRACT_PARENT_PARTY_MISMATCH');
  });
});
