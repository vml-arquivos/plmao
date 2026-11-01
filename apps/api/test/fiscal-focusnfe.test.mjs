import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import http from 'node:http';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';

useTestEnv();
const F = await import('../dist/lib/fiscal.js');
const X = await import('../dist/lib/fiscalFocusNfe.js');
const A = await import('../dist/lib/fiscalAuto.js');

const issuer = { cnpj: '11222333000181', municipal_registration: '12345', service_code: '010701', iss_rate_bps: 200, tax_regime: 'SIMPLES', city_ibge_code: '5300108', series: '1' };
const customerPf = { name: 'Maria Souza', document: '52998224725', email: 'maria@teste.local', phone: '(61) 99999-0000' };
const input = (over = {}) => ({ idempotencyKey: 'fiscal-emit:abc-123', kind: 'NFSE', amountCents: 2490, description: 'Serviço de consulta veicular', customer: customerPf, issuer, ...over });

describe('Focus NFe: montagem e leitura (sem rede)', () => {
  it('monta a DPS do consumidor pessoa física no Simples, sem alíquota de ISS', () => {
    const d = X.buildDps(input(), new Date('2026-11-02T15:00:00Z'));
    assert.equal(d.cpf_tomador, '52998224725'); assert.equal(d.cnpj_tomador, undefined);
    assert.equal(d.valor_servico, 24.9); assert.equal(d.codigo_opcao_simples_nacional, '3');
    assert.equal(d.codigo_tributacao_nacional_iss, '010701'); assert.equal(d.codigo_municipio_prestacao, '5300108');
    assert.equal(d.data_competencia, '2026-11-02'); assert.equal(d.percentual_aliquota_relativa_municipio, undefined);
    assert.equal(d.telefone_tomador, '61999990000'); assert.equal(d.serie_dps, 1);
  });
  it('fora do Simples leva a alíquota; empresa usa CNPJ do tomador', () => {
    const d = X.buildDps(input({ issuer: { ...issuer, tax_regime: 'PRESUMIDO' }, customer: { ...customerPf, document: '11222333000181' } }));
    assert.equal(d.percentual_aliquota_relativa_municipio, 2); assert.equal(d.cnpj_tomador, '11222333000181'); assert.equal(d.codigo_opcao_simples_nacional, '1');
  });
  it('recusa dados incompletos com mensagem clara e sem repetir', () => {
    for (const [over, re] of [[{ issuer: { ...issuer, cnpj: '123' } }, /CNPJ/], [{ issuer: { ...issuer, municipal_registration: '' } }, /municipal/], [{ issuer: { ...issuer, city_ibge_code: '53' } }, /IBGE/], [{ issuer: { ...issuer, service_code: '1.07' } }, /6 dígitos/], [{ customer: { ...customerPf, document: '123' } }, /CPF ou CNPJ/], [{ amountCents: 0 }, /Valor/]]) {
      assert.throws(() => X.buildDps(input(over)), (e) => e instanceof F.FiscalProviderError && e.transient === false && re.test(e.message));
    }
  });
  it('referência estável e curta; mapeia os status do emissor', () => {
    assert.equal(X.focusRef('fiscal-emit:abc-123'), 'plmao-abc-123');
    const ok = X.mapFocusStatus({ status: 'autorizado', numero: '77', codigo_verificacao: 'XYZ', chave_nfse: 'K1', url_danfse: '/arquivos/n.pdf', caminho_xml_nota_fiscal: 'https://x.test/n.xml' }, 'https://h.test', 'r', '1');
    assert.equal(ok.status, 'ISSUED'); assert.equal(ok.number, '77'); assert.equal(ok.pdfUrl, 'https://h.test/arquivos/n.pdf'); assert.equal(ok.xmlUrl, 'https://x.test/n.xml'); assert.equal(ok.series, '1');
    assert.equal(X.mapFocusStatus({ status: 'processando_autorizacao' }, 'https://h.test', 'r', null).status, 'PENDING');
    const rej = X.mapFocusStatus({ status: 'erro_autorizacao', erros: [{ mensagem: 'IM inválida' }] }, 'https://h.test', 'r', null);
    assert.equal(rej.status, 'REJECTED'); assert.match(rej.reason, /IM inválida/);
    assert.throws(() => X.mapFocusStatus({ status: 'autorizado' }, 'https://h.test', 'r', null), (e) => e.transient === true);
  });
});

describe('Focus NFe: emissão ponta a ponta com emissor falso (integração)', integration, () => {
  let pool, server, base, userId, saved;
  const hits = []; let behavior = { post: [202, {}], get: [200, { status: 'processando_autorizacao' }] };
  const payments = []; const docs = [];
  before(async () => {
    ({ pool } = await loadCore());
    server = http.createServer((req, res) => {
      let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
        hits.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
        const [code, json] = req.method === 'POST' ? behavior.post : behavior.get;
        res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(json));
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`;
    await pool.query("DELETE FROM fiscal_jobs WHERE provider='focusnfe'");
    saved = (await pool.query('SELECT * FROM fiscal_settings WHERE id=1')).rows[0];
    await pool.query(`UPDATE fiscal_settings SET legal_name='Empresa Teste LTDA',cnpj='11222333000181',municipal_registration='12345',service_code='010701',iss_rate_bps=200,tax_regime='SIMPLES',city='Brasília',state='DF',city_ibge_code='5300108',environment='HOMOLOGACAO' WHERE id=1`);
    userId = (await pool.query(`INSERT INTO users(email,password_hash,name,role) VALUES($1,'x','Cliente Nota','CLIENTE') RETURNING id`, [`${uid('fn')}@teste.local`])).rows[0].id;
  });
  after(async () => {
    await pool.query('DELETE FROM email_outbox WHERE related_type=$1 AND related_id = ANY($2::text[])', ['FISCAL_DOCUMENT', docs.map(String)]).catch(() => undefined);
    await pool.query("DELETE FROM fiscal_jobs WHERE provider='focusnfe'").catch(() => undefined);
    await pool.query('DELETE FROM fiscal_documents WHERE payment_id = ANY($1::uuid[])', [payments]).catch(() => undefined);
    await pool.query('DELETE FROM payments WHERE id = ANY($1::uuid[])', [payments]).catch(() => undefined);
    await pool.query(`UPDATE fiscal_settings SET legal_name=$1,cnpj=$2,municipal_registration=$3,service_code=$4,iss_rate_bps=$5,tax_regime=$6,city=$7,state=$8,city_ibge_code=$9,environment=$10 WHERE id=1`,
      [saved.legal_name, saved.cnpj, saved.municipal_registration, saved.service_code, saved.iss_rate_bps, saved.tax_regime, saved.city, saved.state, saved.city_ibge_code, saved.environment]);
    await new Promise((r) => server.close(r)); await pool.end();
  });

  const provider = () => X.createFocusNfeProvider({ token: 'tok-prod', tokenHomologacao: 'tok-hml', baseUrl: base });
  async function mkPaid({ paidAgoDays = 0, customer = {}, withProfile = true } = {}) {
    const u = (await pool.query(`INSERT INTO users(email,password_hash,name,role) VALUES($1,'x','Cliente Auto','CLIENTE') RETURNING id`, [`${uid('fa')}@teste.local`])).rows[0].id;
    if (withProfile) await pool.query(`INSERT INTO user_profiles(user_id,cpf_cnpj,street,city,state,zip) VALUES($1,$2,'Rua A','Brasília','DF','70000000') ON CONFLICT(user_id) DO UPDATE SET cpf_cnpj=EXCLUDED.cpf_cnpj,street=EXCLUDED.street,city=EXCLUDED.city,state=EXCLUDED.state,zip=EXCLUDED.zip`, [u, customer.document ?? '52998224725']).catch(() => undefined);
    const p = await pool.query(`INSERT INTO payments(user_id,provider,status,amount_cents,credits,external_id,paid_at) VALUES($1,'mercadopago','PAID',2490,0,$2,now() - make_interval(days => $3::int)) RETURNING id`, [u, uid('pay'), paidAgoDays]);
    payments.push(p.rows[0].id); return { paymentId: p.rows[0].id, userId: u };
  }

  it('envia a nota com a autenticação certa, fica aguardando e depois emite sem duplicar', async () => {
    hits.length = 0; behavior = { post: [202, { status: 'processando_autorizacao' }], get: [200, { status: 'processando_autorizacao' }] };
    const pay = await mkPaid();
    const d = await pool.query(`INSERT INTO fiscal_documents(kind,status,user_id,payment_id,amount_cents,description,customer_snapshot) VALUES('NFSE','PENDING',$1,$2,2490,'Consulta veicular',$3::jsonb) RETURNING id`,
      [pay.userId, pay.paymentId, JSON.stringify({ name: 'Maria Souza', document: '52998224725', email: 'maria@teste.local', street: 'Rua A', city: 'Brasília', state: 'DF', zip: '70000000' })]);
    const id = d.rows[0].id; docs.push(id);
    const p = provider(); await F.enqueueFiscalEmission(id, null, p);
    await F.processFiscalJobs({ provider: p, limit: 50 });
    const post = hits.find((h) => h.method === 'POST');
    assert.match(post.url, /^\/v2\/nfsen\?ref=plmao-/); assert.equal(post.auth, `Basic ${Buffer.from('tok-hml:').toString('base64')}`, 'homologação usa o token de homologação');
    assert.equal(post.body.cpf_tomador, '52998224725'); assert.equal(post.body.valor_servico, 24.9);
    const job = async () => (await pool.query('SELECT * FROM fiscal_jobs WHERE document_id=$1', [id])).rows[0];
    assert.equal((await job()).status, 'AGUARDANDO_PROVEDOR');

    const numero = uid('N');
    behavior.get = [200, { status: 'autorizado', numero: numero, codigo_verificacao: 'COD1', chave_nfse: 'CH1', url_danfse: `${base}/n.pdf` }];
    await pool.query(`UPDATE fiscal_jobs SET next_attempt_at=now() - interval '1 second' WHERE document_id=$1`, [id]);
    await F.processFiscalJobs({ provider: p, limit: 50 });
    assert.equal(hits.filter((h) => h.method === 'POST' && h.url.includes(`plmao-${id}`)).length, 1, 'a consulta não reenvia a nota');
    const doc = (await pool.query('SELECT status,number,verification_code,pdf_url FROM fiscal_documents WHERE id=$1', [id])).rows[0];
    assert.equal(doc.status, 'ISSUED'); assert.equal(doc.number, numero); assert.equal(doc.verification_code, 'COD1'); assert.equal(doc.pdf_url, `${base}/n.pdf`);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM email_outbox WHERE related_type='FISCAL_DOCUMENT' AND related_id=$1`, [id])).rows[0].n, 1, 'cliente recebe o aviso');
  });

  it('produção usa o token de produção; recusa do emissor vira REJEITADO com o motivo; acesso negado não repete', async () => {
    await pool.query(`UPDATE fiscal_settings SET environment='PRODUCAO' WHERE id=1`);
    try {
      hits.length = 0; behavior.post = [422, { codigo: 'requisicao_invalida', mensagem: 'Inscrição municipal inválida' }];
      const p = provider();
      const r = await p.emit(input());
      assert.equal(hits[0].auth, `Basic ${Buffer.from('tok-prod:').toString('base64')}`);
      assert.equal(r.status, 'REJECTED'); assert.match(r.reason, /municipal/);
      behavior.post = [401, {}];
      await assert.rejects(() => p.emit(input()), (e) => e instanceof F.FiscalProviderError && e.transient === false);
      behavior.post = [503, {}];
      await assert.rejects(() => p.emit(input()), (e) => e instanceof F.FiscalProviderError && e.transient === true);
      behavior.post = [409, { codigo: 'requisicao_invalida', mensagem: 'Nota já existe para esta referência' }];
      assert.equal((await p.emit(input())).status, 'PENDING', 'reenvio da mesma referência segue para a consulta');
    } finally { await pool.query(`UPDATE fiscal_settings SET environment='HOMOLOGACAO' WHERE id=1`); }
  });

  it('emissão automática: só pagamentos recentes, só documentos do sistema, cliente incompleto fica pendente', async () => {
    behavior = { post: [202, {}], get: [200, { status: 'processando_autorizacao' }] };
    const p = provider();
    const novo = await mkPaid(); const velho = await mkPaid({ paidAgoDays: 10 }); const semDoc = await mkPaid({ withProfile: false });
    const feito = await mkPaid();
    const manual = await pool.query(`INSERT INTO fiscal_documents(kind,status,user_id,payment_id,amount_cents,description,customer_snapshot,created_by) VALUES('NFSE','PENDING',$1,$2,2490,'Manual',$3::jsonb,$1) RETURNING id`,
      [feito.userId, feito.paymentId, JSON.stringify({ name: 'X', document: '52998224725', street: 'Rua', city: 'B', state: 'DF', zip: '70000000' })]);
    docs.push(manual.rows[0].id);
    const out = await A.runFiscalAuto({ provider: p });
    assert.equal(out.skipped, null); assert.ok(out.created >= 2);
    const byPay = async (pid) => (await pool.query(`SELECT d.id,d.status,(SELECT status FROM fiscal_jobs j WHERE j.document_id=d.id) AS job FROM fiscal_documents d WHERE d.payment_id=$1`, [pid])).rows;
    const n = await byPay(novo.paymentId); docs.push(...n.map((x) => x.id));
    const incompleto = await byPay(semDoc.paymentId); docs.push(...incompleto.map((x) => x.id));
    assert.equal(n.length, 1); assert.equal(n[0].job, 'PENDENTE', 'pagamento recente entra na fila');
    assert.equal((await byPay(velho.paymentId)).length, 0, 'pagamento antigo nunca é emitido sozinho');
    assert.equal(incompleto.length, 1); assert.equal(incompleto[0].job, null, 'cliente sem dados continua pendente no painel');
    assert.equal((await byPay(feito.paymentId)).length, 1); assert.equal((await byPay(feito.paymentId))[0].job, null, 'documento criado por pessoa não é emitido sozinho');
    const again = await A.runFiscalAuto({ provider: p });
    assert.equal(again.queued, 0, 'segunda rodada não repete');
  });

  it('não emite sozinho com a configuração do emissor incompleta ou sem emissor', async () => {
    assert.equal((await A.runFiscalAuto({ provider: null })).skipped, 'EMISSOR_NAO_CONFIGURADO');
    await pool.query(`UPDATE fiscal_settings SET municipal_registration=NULL WHERE id=1`);
    try {
      const out = await A.runFiscalAuto({ provider: provider() });
      assert.equal(out.skipped, 'CONFIGURACAO_INCOMPLETA'); assert.equal(out.created, 0);
      assert.ok((await A.fiscalAutoStatus()).missing.includes('municipal_registration'));
    } finally { await pool.query(`UPDATE fiscal_settings SET municipal_registration='12345' WHERE id=1`); }
  });
});
