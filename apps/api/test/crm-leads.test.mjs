import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

/**
 * CRM de leads do site e links de consulta enviados pelo painel: captura com consentimento, dedupe, esteira, rastreio por sessão,
 * link que cadastra o acesso, campanha só para quem aceitou, descadastro, exportação segura e permissões.
 */
describe('CRM de leads e links de consulta', integration, () => {
  let pool; let server; let sa; let op;
  const pub = (p, o = {}) => hostRequest(server.base, p, o);
  const email = (p = 'lead') => `${uid(p)}@lead.local`;
  const leadByEmail = async (e) => (await pool.query('SELECT * FROM site_leads WHERE lower(email)=$1', [e.toLowerCase()])).rows[0];
  const register = (body) => pub('/api/auth/register', { method: 'POST', body: { name: 'Pessoa Teste', password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true, ...body } });

  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    server = await startServer({ ADMIN_HOSTS: 'admin.placanamao.test' });
    sa = await adminSession({ server, pool, role: 'SUPER_ADMIN' });
    op = await adminSession({ server, pool, role: 'OPERADOR' });
  });
  after(async () => { await server.stop(); await pool.end(); });

  it('captura do site: cria o lead sem marketing por padrão, não duplica e não revela se já existia', async () => {
    const e = email();
    const r1 = await pub('/api/leads/capture', { method: 'POST', body: { email: e, name: 'Maria Souza', tool: 'SIMULADOR', interest: 'Simulação de carro' } });
    assert.equal(r1.status, 201, r1.text);
    const l = await leadByEmail(e);
    assert.equal(l.stage, 'NOVO'); assert.equal(l.source, 'SIMULADOR'); assert.equal(l.marketing_consent, false);
    const r2 = await pub('/api/leads/capture', { method: 'POST', body: { email: e.toUpperCase(), tool: 'FIPE', consent: true } });
    assert.equal(r2.status, 201); assert.deepEqual(r2.json, r1.json);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM site_leads WHERE lower(email)=$1', [e])).rows[0].n, 1);
    const l2 = await leadByEmail(e);
    assert.equal(l2.marketing_consent, true); assert.ok(l2.consent_at); assert.match(l2.consent_text, /cancelar quando quiser/);
    assert.equal(l2.name, 'Maria Souza', 'nome já guardado não é sobrescrito');
  });

  it('captura recusa contato inválido, campo desconhecido e robô (campo-armadilha)', async () => {
    assert.equal((await pub('/api/leads/capture', { method: 'POST', body: { tool: 'FIPE' } })).status, 400);
    assert.equal((await pub('/api/leads/capture', { method: 'POST', body: { email: 'isso-nao-e-email', tool: 'FIPE' } })).status, 400);
    assert.equal((await pub('/api/leads/capture', { method: 'POST', body: { email: email(), tool: 'FIPE', extra: 1 } })).status, 400);
    assert.equal((await pub('/api/leads/capture', { method: 'POST', body: { email: email(), tool: 'OUTRA' } })).status, 400);
    const bot = email('bot');
    const r = await pub('/api/leads/capture', { method: 'POST', body: { email: bot, tool: 'FIPE', website: 'http://spam' } });
    assert.equal(r.status, 201);
    assert.equal(await leadByEmail(bot), undefined, 'robô não entra no CRM');
  });

  it('rastreio do site: a atividade anônima da mesma sessão aparece na linha do tempo do lead', async () => {
    const sessionId = `sess-${uid('x')}-0123456789abcdef`;
    await pub('/api/funnel/events', { method: 'POST', body: { event: 'FIPE_PAGE_VIEW', sessionId, path: '/fipe', metadata: { utm_source: 'google' } } });
    await pub('/api/funnel/events', { method: 'POST', body: { event: 'FIPE_RESULT_VIEWED', sessionId, path: '/fipe' } });
    const e = email();
    await pub('/api/leads/capture', { method: 'POST', body: { email: e, tool: 'FIPE', sessionId, utm: { utm_source: 'google', utm_campaign: 'fipe', lixo: 'x' } } });
    const l = await leadByEmail(e);
    assert.deepEqual(l.utm, { utm_source: 'google', utm_campaign: 'fipe' });
    const d = await sa.call(`/api/admin/crm/leads/${l.id}`);
    assert.equal(d.status, 200);
    const types = d.json.site.map((x) => x.type);
    assert.ok(types.includes('FIPE_PAGE_VIEW') && types.includes('FIPE_RESULT_VIEWED'), types.join());
    assert.ok(d.json.events.some((x) => x.kind === 'CREATED'));
  });

  it('painel: resumo, lista com filtros e permissões (equipe vê; só quem gerencia altera)', async () => {
    const e = email('filtro'); await pub('/api/leads/capture', { method: 'POST', body: { email: e, name: 'Zé Filtro', tool: 'COMPARAR' } });
    const sum = await sa.call('/api/admin/crm/summary');
    assert.equal(sum.status, 200); assert.ok(sum.json.total >= 1); assert.ok('NOVO' in sum.json.stages);
    const list = await sa.call(`/api/admin/crm/leads?q=${encodeURIComponent('zé filtro')}&stage=NOVO&source=COMPARAR`);
    assert.equal(list.status, 200); assert.equal(list.json.leads.length, 1); assert.equal(list.json.leads[0].email, e);
    assert.equal((await op.call('/api/admin/crm/leads')).status, 200, 'operador (VIEW_CUSTOMERS) enxerga');
    const id = list.json.leads[0].id;
    assert.equal((await op.call(`/api/admin/crm/leads/${id}`, { method: 'PATCH', body: { stage: 'CONTATADO' } })).status, 403);
    assert.equal((await op.call('/api/admin/crm/links', { method: 'POST', body: { email: e } })).status, 403);
    assert.equal((await op.call('/api/admin/crm/export')).status, 403);
    const anon = await pub('/api/admin/crm/leads', { host: 'admin.placanamao.test' });
    assert.ok([401, 403].includes(anon.status));
    const site = await pub('/api/admin/crm/leads');
    assert.ok([401, 403, 404].includes(site.status), 'o CRM não existe no site público');
  });

  it('esteira: mudar etapa, etiquetas, nota, retorno marcado e histórico; entrada inválida é recusada', async () => {
    const e = email(); await pub('/api/leads/capture', { method: 'POST', body: { email: e, tool: 'SIMULADOR' } });
    const id = (await leadByEmail(e)).id;
    const patch = await sa.call(`/api/admin/crm/leads/${id}`, { method: 'PATCH', body: { stage: 'INTERESSADO', tags: ['quente', 'Lojista'], notes: 'Pediu retorno', nextContactAt: new Date(Date.now() - 60_000).toISOString() } });
    assert.equal(patch.status, 200, patch.text);
    const d = await sa.call(`/api/admin/crm/leads/${id}`);
    assert.equal(d.json.lead.stage, 'INTERESSADO'); assert.deepEqual(d.json.lead.tags, ['quente', 'lojista']); assert.equal(d.json.lead.notes, 'Pediu retorno');
    assert.ok(d.json.events.some((x) => x.kind === 'STAGE' && x.detail.to === 'INTERESSADO'));
    const due = await sa.call('/api/admin/crm/leads?followup=1');
    assert.ok(due.json.leads.some((x) => x.id === id), 'retorno vencido aparece no filtro');
    for (const body of [{ stage: 'QUALQUER' }, { phone: '123' }, { tags: ['<script>'] }, { ownerId: '00000000-0000-4000-8000-000000000000' }, {}, { id: 'x' }]) {
      assert.equal((await sa.call(`/api/admin/crm/leads/${id}`, { method: 'PATCH', body })).status, 400, JSON.stringify(body));
    }
    const bulk = await sa.call('/api/admin/crm/leads/bulk', { method: 'POST', body: { ids: [id], stage: 'PERDIDO', addTag: 'frio' } });
    assert.equal(bulk.status, 200);
    const d2 = await sa.call(`/api/admin/crm/leads/${id}`);
    assert.equal(d2.json.lead.stage, 'PERDIDO'); assert.ok(d2.json.lead.tags.includes('frio'));
    const c = await sa.call(`/api/admin/crm/leads/${id}/contact`, { method: 'POST', body: { channel: 'WHATSAPP', note: 'Mandei mensagem' } });
    assert.equal(c.status, 200);
    assert.equal((await sa.call(`/api/admin/crm/leads/${id}/contact`, { method: 'POST', body: { channel: 'POMBO' } })).status, 400);
  });

  it('link de consulta: validações, texto pronto, WhatsApp, abertura rastreada e revogação', async () => {
    const e = email('lk');
    assert.equal((await sa.call('/api/admin/crm/links', { method: 'POST', body: { name: 'Sem contato' } })).status, 400);
    assert.equal((await sa.call('/api/admin/crm/links', { method: 'POST', body: { email: e, plate: 'ABC' } })).status, 400);
    assert.equal((await sa.call('/api/admin/crm/links', { method: 'POST', body: { email: e, productId: 'FIPE_FREE' } })).status, 400, 'produto grátis não vale');
    assert.equal((await sa.call('/api/admin/crm/links', { method: 'POST', body: { email: e, productId: 'NAO_EXISTE' } })).status, 400);
    const r = await sa.call('/api/admin/crm/links', { method: 'POST', body: { name: 'João Lojista', email: e, phone: '(61) 99999-1234', kind: 'LOJISTA', productId: 'COMPLETE', plate: 'abc-1d23', channel: 'WHATSAPP', days: 7 } });
    assert.equal(r.status, 201, r.text);
    assert.match(r.json.url, /\/c\/[A-Z2-9]{8}$/); assert.ok(r.json.text.includes(r.json.url)); assert.match(r.json.text, /ABC1D23/);
    assert.ok(r.json.whatsappUrl.startsWith('https://wa.me/5561999991234?text='));
    const lead = await leadByEmail(e);
    assert.equal(lead.kind, 'LOJISTA'); assert.equal(lead.source, 'LINK_ADMIN'); assert.equal(lead.stage, 'CONTATADO'); assert.equal(lead.marketing_consent, false);

    const code = r.json.code;
    const info = await pub(`/api/lead-links/${code}`);
    assert.equal(info.json.valid, true); assert.equal(info.json.firstName, 'João'); assert.equal(info.json.plate, 'ABC1D23'); assert.equal(info.json.productId, 'COMPLETE');
    assert.ok(!JSON.stringify(info.json).includes(e), 'a página pública não mostra o e-mail do destinatário');
    assert.equal((await pub(`/api/lead-links/${code}/click`, { method: 'POST' })).json.valid, true);
    const l2 = await leadByEmail(e);
    assert.equal(l2.stage, 'INTERESSADO');
    const list = await sa.call('/api/admin/crm/links');
    const row = list.json.links.find((x) => x.code === code);
    assert.equal(row.clicks, 1); assert.equal(row.plate, 'ABC****', 'a lista não mostra a placa inteira');

    assert.equal((await sa.call(`/api/admin/crm/links/${row.id}/revoke`, { method: 'POST' })).status, 200);
    assert.equal((await pub(`/api/lead-links/${code}`)).json.valid, false);
    assert.equal((await pub(`/api/lead-links/${code}/click`, { method: 'POST' })).json.valid, false);
    assert.equal((await pub('/api/lead-links/AAAAAAAA')).json.valid, false);
    assert.equal((await pub('/api/lead-links/x')).json.valid, false);
  });

  it('quem abre o link e cria a conta fica ligado ao lead, ao link e a quem enviou', async () => {
    const e = email('reg');
    const link = await sa.call('/api/admin/crm/links', { method: 'POST', body: { name: 'Ana', email: e, phone: '11988887777', channel: 'COPIA' } });
    assert.equal(link.status, 201);
    const sessionId = `sess-${uid('r')}-0123456789abcdef`;
    const reg = await register({ email: e, name: 'Ana Lima', leadLinkCode: link.json.code, funnelSession: sessionId, utm: { utm_source: 'whatsapp' }, marketingOptIn: true });
    assert.equal(reg.status, 201, reg.text);
    const lead = await leadByEmail(e);
    assert.equal(lead.user_id, reg.json.user.id); assert.equal(lead.stage, 'CADASTRADO'); assert.equal(lead.marketing_consent, true);
    assert.equal((await pool.query('SELECT count(*)::int n FROM site_leads WHERE user_id=$1', [reg.json.user.id])).rows[0].n, 1);
    const k = (await pool.query('SELECT registered_user_id,lead_id FROM lead_links WHERE code=$1', [link.json.code])).rows[0];
    assert.equal(k.registered_user_id, reg.json.user.id); assert.equal(k.lead_id, lead.id);
    const inv = (await pool.query('SELECT invited_by FROM users WHERE id=$1', [reg.json.user.id])).rows[0];
    assert.ok(inv.invited_by, 'aparece em Convites como convidado de quem enviou o link');
    const d = await sa.call(`/api/admin/crm/leads/${lead.id}`);
    assert.ok(d.json.events.some((x) => x.kind === 'LINK_REGISTERED'));
    // link usado uma vez só
    const again = await register({ email: email('reg2'), leadLinkCode: link.json.code });
    assert.equal(again.status, 201);
    assert.equal((await pool.query('SELECT registered_user_id FROM lead_links WHERE code=$1', [link.json.code])).rows[0].registered_user_id, reg.json.user.id);
  });

  it('cadastro com outro e-mail: o lead do link é fundido na conta (sem duplicar, sem perder histórico)', async () => {
    const original = email('orig');
    const link = await sa.call('/api/admin/crm/links', { method: 'POST', body: { name: 'Carlos', email: original, tags: undefined, channel: 'COPIA' } });
    const leadBefore = await leadByEmail(original);
    await sa.call(`/api/admin/crm/leads/${leadBefore.id}`, { method: 'PATCH', body: { tags: ['indicado'], notes: 'conversa no balcão' } });
    const other = email('outro');
    const reg = await register({ email: other, name: 'Carlos Outro', leadLinkCode: link.json.code });
    assert.equal(reg.status, 201);
    const mine = await leadByEmail(other);
    assert.ok(mine, 'lead da conta existe');
    assert.equal(mine.user_id, reg.json.user.id);
    assert.equal(await leadByEmail(original) && (await leadByEmail(original)).id !== mine.id ? 'sobrou' : 'ok', 'ok', 'lead antigo foi fundido');
    assert.ok(mine.tags.includes('indicado')); assert.match(mine.notes ?? '', /balcão/);
    assert.equal((await pool.query('SELECT lead_id FROM lead_links WHERE code=$1', [link.json.code])).rows[0].lead_id, mine.id);
  });

  it('quem já tem conta (ou entrou por outro caminho) entra no CRM e sobe de etapa sozinho', async () => {
    const e = email('conta');
    const reg = await register({ email: e, marketingOptIn: false });
    const pre = await pool.query('SELECT 1 FROM site_leads WHERE user_id=$1', [reg.json.user.id]);
    assert.equal(pre.rowCount, 1);
    // conta criada por fora do cadastro normal (ex.: importação/Google): o resumo traz para o CRM
    const bcrypt = (await import('bcryptjs')).default;
    const x = email('fora');
    const u = await pool.query(`INSERT INTO users(email,password_hash,name,role) VALUES($1,$2,'Veio Por Fora','CLIENTE') RETURNING id`, [x, await bcrypt.hash('Senha-Forte-123!', 4)]);
    await pool.query('INSERT INTO wallets(user_id,balance) VALUES($1,0)', [u.rows[0].id]);
    await sa.call('/api/admin/crm/summary');
    const l = await leadByEmail(x);
    assert.ok(l); assert.equal(l.stage, 'CADASTRADO'); assert.equal(l.source, 'CADASTRO'); assert.equal(l.marketing_consent, false);
    // compra paga → CLIENTE
    await pool.query(`INSERT INTO payment_orders(user_id,status,amount_cents,provider,external_reference,purchase_type,product_id,query_plate,paid_at) VALUES($1,'PAID',3459,'test',$2,'QUERY','COMPLETE','ZZZ9Z99',now())`, [u.rows[0].id, uid('ref')]);
    await sa.call('/api/admin/crm/summary');
    assert.equal((await leadByEmail(x)).stage, 'CLIENTE');
    const list = await sa.call(`/api/admin/crm/leads?stage=CLIENTE&q=${encodeURIComponent(x)}`);
    assert.equal(list.json.leads[0].spentCents, 0, 'gasto = consultas pagas e concluídas; só ter pago um pedido ainda não conta como consumo');
    await pool.query(`INSERT INTO vehicle_queries(user_id,plate,product_id,status,credits_cost,provider,price_cents) VALUES($1,'ZZZ9Z99','COMPLETE','SUCCESS',0,'mock',3459)`, [u.rows[0].id]);
    assert.equal((await sa.call(`/api/admin/crm/leads?stage=CLIENTE&q=${encodeURIComponent(x)}`)).json.leads[0].spentCents, 3459);
    // lead do site com o mesmo e-mail de quem criou conta depois: liga sem duplicar
    const y = email('depois');
    await pub('/api/leads/capture', { method: 'POST', body: { email: y, tool: 'FIPE', consent: true } });
    const reg2 = await register({ email: y });
    assert.equal(reg2.status, 201);
    assert.equal((await pool.query('SELECT count(*)::int n FROM site_leads WHERE lower(email)=$1', [y])).rows[0].n, 1);
    const l3 = await leadByEmail(y);
    assert.equal(l3.user_id, reg2.json.user.id); assert.equal(l3.stage, 'CADASTRADO'); assert.equal(l3.marketing_consent, true, 'aceite dado no site continua valendo');
  });

  it('campanha de e-mail: só quem aceitou e não saiu, com link de descadastro; descadastro vale na hora', async () => {
    const tag = `camp-${uid('t')}`.toLowerCase();
    const yes = email('sim'); const no = email('nao'); const out = email('saiu');
    for (const [e, consent] of [[yes, true], [no, false], [out, true]]) await pub('/api/leads/capture', { method: 'POST', body: { email: e, name: 'Fulano Teste', tool: 'FIPE', consent } });
    const ids = [];
    for (const e of [yes, no, out]) ids.push((await leadByEmail(e)).id);
    await sa.call('/api/admin/crm/leads/bulk', { method: 'POST', body: { ids, addTag: tag } });
    const body = { tag, subject: 'Veja quanto vale seu carro', message: 'Preparamos uma dica para você conferir a Tabela FIPE antes de negociar.', ctaPath: '/fipe' };
    const dry = await sa.call('/api/admin/crm/campaign', { method: 'POST', body: { ...body, dryRun: true } });
    assert.equal(dry.json.recipients, 2);
    // descadastro por token
    const token = `${ids[2]}.${createHash('sha256').update('x').digest('base64url').slice(0, 32)}`;
    assert.equal((await pub('/api/leads/unsubscribe', { method: 'POST', body: { token } })).status, 400, 'assinatura falsa não vale');
    assert.equal((await pub('/api/leads/unsubscribe', { method: 'POST', body: { token: 'lixo' } })).status, 400);
    const { unsubscribeToken } = await import('../dist/lib/leads.js');
    const good = unsubscribeToken(ids[2]);
    assert.equal((await pub('/api/leads/unsubscribe', { method: 'POST', body: { token: good } })).status, 200);
    assert.equal((await pub('/api/leads/unsubscribe', { method: 'POST', body: { token: good } })).status, 200, 'repetir é inofensivo');
    const after = await sa.call('/api/admin/crm/campaign', { method: 'POST', body: { ...body, dryRun: true } });
    assert.equal(after.json.recipients, 1);
    const sent = await sa.call('/api/admin/crm/campaign', { method: 'POST', body });
    assert.equal(sent.status, 200, sent.text); assert.equal(sent.json.queued, 1);
    const mails = await pool.query(`SELECT to_email,template,subject,payload FROM email_outbox WHERE related_type='LEAD' AND related_id = ANY($1::text[])`, [ids]);
    assert.equal(mails.rowCount, 1); assert.equal(mails.rows[0].to_email, yes); assert.equal(mails.rows[0].template, 'LEAD_MESSAGE');
    assert.match(JSON.stringify(mails.rows[0].payload), /descadastrar\?t=/);
    const dup = await sa.call('/api/admin/crm/campaign', { method: 'POST', body });
    assert.equal(dup.json.queued, 0, 'o mesmo e-mail não sai duas vezes no mesmo dia');
    // link de consulta por e-mail também respeita quem saiu
    const blocked = await sa.call('/api/admin/crm/links', { method: 'POST', body: { leadId: ids[2], channel: 'EMAIL' } });
    assert.equal(blocked.status, 409); assert.equal(blocked.json.error ?? blocked.json.code, 'LEAD_UNSUBSCRIBED');
    // quem aceita de novo volta a receber
    await pub('/api/leads/capture', { method: 'POST', body: { email: out, tool: 'FIPE', consent: true } });
    assert.equal((await sa.call('/api/admin/crm/campaign', { method: 'POST', body: { ...body, dryRun: true } })).json.recipients, 2);
    // validação
    for (const b of [{ ...body, ctaPath: 'https://golpe.com' }, { ...body, ctaPath: '//golpe.com' }, { ...body, subject: '' }, { ...body, message: 'curto' }, { ...body, tag: '<x>' }]) {
      assert.equal((await sa.call('/api/admin/crm/campaign', { method: 'POST', body: b })).status, 400, JSON.stringify(b));
    }
  });

  it('link por e-mail sai pela fila com botão e opção de sair', async () => {
    const e = email('mailink');
    const r = await sa.call('/api/admin/crm/links', { method: 'POST', body: { name: 'Bia', email: e, channel: 'EMAIL', productId: 'LIEN' } });
    assert.equal(r.status, 201, r.text); assert.equal(r.json.emailSent, true);
    const m = await pool.query(`SELECT payload,template FROM email_outbox WHERE lower(to_email)=$1`, [e]);
    assert.equal(m.rowCount, 1); assert.equal(m.rows[0].template, 'LEAD_MESSAGE');
    const p = JSON.stringify(m.rows[0].payload);
    assert.ok(p.includes(r.json.url) && p.includes('descadastrar?t='));
    const { renderEmail } = await import('../dist/lib/emailTemplates.js');
    const mail = renderEmail('LEAD_MESSAGE', m.rows[0].payload.data);
    assert.match(mail.html, /Fazer a consulta/); assert.match(mail.text, /Não quer mais receber/);
    assert.equal((await sa.call('/api/admin/crm/links', { method: 'POST', body: { name: 'Sem email', phone: '11977776666', channel: 'EMAIL' } })).status, 409);
  });

  it('exportação: planilha neutraliza fórmula e a lista para anúncios sai só com hash e só de quem aceitou', async () => {
    const bad = email('csv'); const yes = email('ads'); const no = email('semaceite');
    await pub('/api/leads/capture', { method: 'POST', body: { email: bad, name: '=HYPERLINK("http://x","clique")', tool: 'FIPE' } });
    await pub('/api/leads/capture', { method: 'POST', body: { email: yes, name: 'Com Aceite', phone: '(61) 98888-7777', tool: 'FIPE', consent: true } });
    await pub('/api/leads/capture', { method: 'POST', body: { email: no, name: 'Sem Aceite', tool: 'FIPE' } });
    const full = await sa.call('/api/admin/crm/export');
    assert.equal(full.status, 200); assert.match(full.headers['content-type'], /text\/csv/);
    assert.ok(full.text.includes("'=HYPERLINK"), 'fórmula virou texto'); assert.ok(!/;=HYPERLINK/.test(full.text) && !/^=HYPERLINK/m.test(full.text));
    const ads = await sa.call('/api/admin/crm/export/audience');
    assert.equal(ads.status, 200);
    const h = (v) => createHash('sha256').update(v).digest('hex');
    assert.ok(ads.text.includes(h(yes)), 'e-mail de quem aceitou, em hash');
    assert.ok(ads.text.includes(h('5561988887777')), 'telefone com 55 em hash');
    assert.ok(!ads.text.includes(h(no)), 'quem não aceitou fica de fora');
    assert.ok(!ads.text.includes(yes) && !ads.text.includes('Com Aceite') && !ads.text.includes('61988887777'), 'nenhum dado legível');
    const audits = await pool.query(`SELECT metadata FROM audit_logs WHERE action='LEAD_EXPORT' ORDER BY created_at DESC LIMIT 2`);
    assert.ok(audits.rowCount >= 2, 'exportações ficam na auditoria');
  });

  it('apagar: contato solto pode ser apagado; quem tem conta continua (tem caminho próprio)', async () => {
    const solto = email('del'); await pub('/api/leads/capture', { method: 'POST', body: { email: solto, tool: 'FIPE' } });
    const id = (await leadByEmail(solto)).id;
    assert.equal((await op.call(`/api/admin/crm/leads/${id}`, { method: 'DELETE' })).status, 403);
    assert.equal((await sa.call(`/api/admin/crm/leads/${id}`, { method: 'DELETE' })).status, 200);
    assert.equal(await leadByEmail(solto), undefined);
    assert.equal((await sa.call(`/api/admin/crm/leads/${id}`)).status, 404);
    const reg = await register({ email: email('tem') });
    const lid = (await pool.query('SELECT id FROM site_leads WHERE user_id=$1', [reg.json.user.id])).rows[0].id;
    assert.equal((await sa.call(`/api/admin/crm/leads/${lid}`, { method: 'DELETE' })).status, 409);
  });

  it('contato e interesse em planos viram lead sem aceite de marketing', async () => {
    const c = email('contato');
    const r = await pub('/api/contact', { method: 'POST', body: { name: 'Quem Escreveu', email: c, subject: 'Dúvida sobre consulta', message: 'Gostaria de saber como funciona a consulta.' } });
    assert.equal(r.status, 201, r.text);
    const l = await leadByEmail(c);
    assert.equal(l.source, 'CONTATO'); assert.equal(l.marketing_consent, false); assert.equal(l.interest, 'Dúvida sobre consulta');
    const p = email('plano');
    assert.equal((await pub('/api/plan-interest', { method: 'POST', body: { email: p, plan: 'PREMIUM' } })).status, 201);
    assert.equal((await leadByEmail(p)).source, 'PLANOS');
  });

  it('manual: equipe cadastra contato sem poder dar aceite de marketing por ele', async () => {
    const e = email('manual');
    const r = await sa.call('/api/admin/crm/leads', { method: 'POST', body: { name: 'Loja do Zé', email: e, phone: '6133334444', kind: 'LOJISTA', consent: true } });
    assert.equal(r.status, 400, 'campo de aceite não existe para a equipe');
    const ok = await sa.call('/api/admin/crm/leads', { method: 'POST', body: { name: 'Loja do Zé', email: e, phone: '6133334444', kind: 'LOJISTA' } });
    assert.equal(ok.status, 201);
    const l = await leadByEmail(e);
    assert.equal(l.source, 'MANUAL'); assert.equal(l.kind, 'LOJISTA'); assert.equal(l.marketing_consent, false);
    assert.equal((await sa.call('/api/admin/crm/leads', { method: 'POST', body: { name: 'Sem contato' } })).status, 400);
  });
  it('páginas de link e convite abrem com status 200, sem indexação e fora do robots', async () => {
    for (const path of ['/c/ABCDEFGH', '/convite/ABCDEFGH', '/descadastrar', '/parceiro/convite/abc']) {
      const r = await fetch(`${server.base}${path}`, { headers: { accept: 'text/html' } });
      assert.equal(r.status, 200, `${path} deveria abrir`);
      const html = await r.text();
      assert.match(html, /noindex/i, `${path} sem noindex`);
    }
    const robots = await (await fetch(`${server.base}/robots.txt`)).text();
    for (const d of ['/c/', '/convite/', '/descadastrar']) assert.ok(robots.includes(`Disallow: ${d}`), d);
  });
  it('segurança: nenhuma rota do CRM abre sem login de equipe, nem com conta de cliente, nem fora do host do painel', async () => {
    const reg = await register({ email: email('seg') });
    const rotas = [['GET', '/api/admin/crm/summary'], ['GET', '/api/admin/crm/leads'], ['GET', '/api/admin/crm/leads/00000000-0000-4000-8000-000000000000'], ['PATCH', '/api/admin/crm/leads/00000000-0000-4000-8000-000000000000'],
      ['POST', '/api/admin/crm/leads'], ['POST', '/api/admin/crm/leads/bulk'], ['DELETE', '/api/admin/crm/leads/00000000-0000-4000-8000-000000000000'], ['POST', '/api/admin/crm/campaign'],
      ['GET', '/api/admin/crm/links'], ['POST', '/api/admin/crm/links'], ['GET', '/api/admin/crm/export'], ['GET', '/api/admin/crm/export/audience']];
    for (const [method, path] of rotas) {
      const semLogin = await pub(path, { method, host: 'admin.placanamao.test', body: method === 'GET' ? undefined : {} });
      assert.ok([401, 403].includes(semLogin.status), `${method} ${path} sem login: ${semLogin.status}`);
      const cliente = await pub(path, { method, host: 'admin.placanamao.test', token: reg.json.token, body: method === 'GET' ? undefined : {} });
      assert.ok([401, 403].includes(cliente.status), `${method} ${path} com conta de cliente: ${cliente.status}`);
      const publico = await pub(path, { method, token: sa.token, body: method === 'GET' ? undefined : {} });
      assert.ok([401, 403, 404].includes(publico.status), `${method} ${path} no host público com token de equipe: ${publico.status}`);
    }
    // o cliente nunca vê o CRM nem a ficha de outro contato por rota de cliente
    assert.equal((await pub('/api/me/lead-link/claim', { method: 'POST', body: { code: 'ABCDEFGH' } })).status, 401);
    assert.equal((await pub('/api/me/lead-link/claim', { method: 'POST', token: reg.json.token, body: { code: 'ABCDEFGH' } })).json.linked, false);
  });
});
