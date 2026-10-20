import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

// CPF e CNPJ válidos (dígitos verificadores corretos) usados só em teste.
const CPF = '529.982.247-25';
const CNPJ = '11.222.333/0001-81';

describe('painel: equipe, clientes, empresas, cobranças e notas fiscais', integration, () => {
  let pool; let server; let sa; let adm; let fin; let sup; let cont;
  const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    await pool.query(`DELETE FROM vehicle_queries WHERE product_id LIKE 'TESTE\\_%'`);
    for (const t of ['product_catalog_features', 'product_report_configs', 'report_templates']) await pool.query(`DELETE FROM ${t} WHERE product_id LIKE 'TESTE\\_%'`);
    await pool.query(`DELETE FROM query_products WHERE id LIKE 'TESTE\\_%'`);
    server = await startServer({ ADMIN_HOSTS: 'admin.placanamao.test' });
    sa = await adminSession({ server, pool, role: 'SUPER_ADMIN' });
    adm = await adminSession({ server, pool, role: 'ADMIN' });
    fin = await adminSession({ server, pool, role: 'FINANCEIRO' });
    sup = await adminSession({ server, pool, role: 'SUPORTE' });
    cont = await adminSession({ server, pool, role: 'CONTEUDO' });
  });
  after(async () => { await server.stop(); await pool.end(); });

  it('novos níveis de acesso entram no painel e cada um enxerga só o seu pedaço', async () => {
    assert.equal((await fin.call('/api/admin/charges')).status, 200);
    assert.equal((await fin.call('/api/admin/fiscal/summary')).status, 200);
    assert.equal((await fin.call('/api/admin/team')).status, 403);
    assert.equal((await fin.call('/api/admin/content/faqs')).status, 403);
    assert.equal((await sup.call('/api/admin/customers')).status, 200);
    assert.equal((await sup.call('/api/admin/charges')).status, 403);
    assert.equal((await sup.call('/api/admin/fiscal/summary')).status, 403);
    assert.equal((await sup.call('/api/admin/contact-messages')).status, 200);
    assert.equal((await cont.call('/api/admin/content/faqs')).status, 200);
    assert.equal((await cont.call('/api/admin/customers')).status, 403);
    assert.equal((await cont.call('/api/admin/overview')).status, 403);
    assert.equal((await fin.call('/api/admin/overview')).status, 200);
  });

  it('equipe: criar com nível, trocar nível, redefinir senha/2FA e proteger o último super admin', async () => {
    const email = `${uid('eq')}@equipe.local`;
    const created = await adm.call('/api/admin/team', { method: 'POST', body: { name: 'Fulana Financeira', email, role: 'FINANCEIRO' } });
    assert.equal(created.status, 201, created.text);
    assert.equal(created.json.member.role, 'FINANCEIRO');
    assert.ok(created.json.temporaryPassword.length >= 12);
    const id = created.json.member.id;
    // o novo membro consegue entrar com a senha temporária e cai no cadastro do 2FA
    const login = await hostRequest(server.base, '/api/admin/auth/login', { method: 'POST', host: 'admin.placanamao.test', body: { email, password: created.json.temporaryPassword } });
    assert.equal(login.status, 200, login.text);
    assert.ok(login.json.setup?.secret);
    // admin não cria outro admin; só super admin
    const denied = await adm.call('/api/admin/team', { method: 'POST', body: { name: 'Outro Admin', email: `${uid('a')}@equipe.local`, role: 'ADMIN' } });
    assert.equal(denied.status, 403);
    const ok = await sa.call('/api/admin/team', { method: 'POST', body: { name: 'Outro Admin', email: `${uid('a')}@equipe.local`, role: 'ADMIN' } });
    assert.equal(ok.status, 201);
    // e-mail repetido
    assert.equal((await adm.call('/api/admin/team', { method: 'POST', body: { name: 'Dup', email, role: 'SUPORTE' } })).status, 409);
    const patch = await adm.call(`/api/admin/team/${id}`, { method: 'PATCH', body: { role: 'SUPORTE' } });
    assert.equal(patch.status, 200);
    assert.equal(patch.json.member.role, 'SUPORTE');
    assert.equal((await adm.call(`/api/admin/team/${id}/reset-password`, { method: 'POST' })).json.temporaryPassword.length >= 12, true);
    assert.equal((await adm.call(`/api/admin/team/${id}/reset-2fa`, { method: 'POST' })).status, 200);
    // não mexe em si mesmo
    const me = (await adm.call('/api/admin/team')).json.items.find((m) => m.email === adm.email);
    assert.equal((await adm.call(`/api/admin/team/${me.id}`, { method: 'PATCH', body: { active: false } })).status, 409);
    // admin não mexe em super admin
    const superRow = (await sa.call('/api/admin/team')).json.items.find((m) => m.email === sa.email);
    assert.equal((await adm.call(`/api/admin/team/${superRow.id}`, { method: 'PATCH', body: { active: false } })).status, 403);
    // remover
    assert.equal((await adm.call(`/api/admin/team/${id}`, { method: 'DELETE' })).status, 204);
    assert.ok(!(await adm.call('/api/admin/team')).json.items.some((m) => m.id === id));
    const roles = await adm.call('/api/admin/team/roles');
    assert.ok(roles.json.roles.length >= 6);
    assert.equal(roles.json.roles.find((r) => r.role === 'ADMIN').assignable, false);
  });

  it('clientes: cria por tipo, valida CPF/CNPJ, filtra, edita, arquiva e exporta', async () => {
    const mk = (over) => adm.call('/api/admin/customers', { method: 'POST', body: { name: 'Cliente', email: `${uid('c')}@cli.local`, type: 'PARTICULAR', ...over } });
    const part = await mk({ name: 'Maria Particular', cpfCnpj: CPF, type: 'PARTICULAR', city: 'Campinas', state: 'SP', street: 'Rua A', zip: '13000-000' });
    assert.equal(part.status, 201, part.text);
    assert.ok(part.json.temporaryPassword);
    assert.equal(part.json.customer.type, 'PARTICULAR');
    assert.equal(part.json.customer.cpfCnpj, CPF);
    assert.equal(part.json.customer.fiscalReady, true);
    const auto = await mk({ name: 'João Vendedor', type: 'AUTONOMO', segment: 'Vendedor de carros autônomo', cpfCnpj: CPF.replace(/\D/g, '') });
    assert.equal(auto.status, 201, auto.text);
    assert.equal(auto.json.customer.fiscalReady, false);
    const emp = await mk({ name: 'Loja Boa Ltda', type: 'EMPRESA', segment: 'Agência', cpfCnpj: CNPJ, legalName: 'Loja Boa Comércio Ltda' });
    assert.equal(emp.status, 201, emp.text);
    // validações
    assert.equal((await mk({ cpfCnpj: '111.111.111-11' })).status, 400);
    assert.equal((await mk({ type: 'EMPRESA', cpfCnpj: CPF })).status, 400);
    assert.equal((await mk({ type: 'PARTICULAR', cpfCnpj: CNPJ })).status, 400);
    assert.equal((await mk({ email: part.json.customer.email })).status, 409);
    // quem só lê não cria
    assert.equal((await sup.call('/api/admin/customers', { method: 'POST', body: { name: 'X Y', email: `${uid('c')}@cli.local`, type: 'PARTICULAR' } })).status, 403);
    // filtros por tipo
    const list = await adm.call('/api/admin/customers?type=AUTONOMO');
    assert.ok(list.json.items.every((c) => c.type === 'AUTONOMO'));
    assert.ok(list.json.items.some((c) => c.id === auto.json.customer.id));
    assert.ok(list.json.byType.AUTONOMO >= 1 && list.json.byType.EMPRESA >= 1);
    const byDoc = await adm.call(`/api/admin/customers?search=${encodeURIComponent('11.222.333')}`);
    assert.ok(byDoc.json.items.some((c) => c.id === emp.json.customer.id));
    // lista mascara o documento; suporte vê mascarado também no detalhe
    assert.ok(list.json.items.every((c) => !c.cpfCnpj || c.cpfCnpj.includes('*')));
    const detailSup = await sup.call(`/api/admin/customers/${part.json.customer.id}`);
    assert.equal(detailSup.status, 200);
    assert.ok(detailSup.json.customer.cpfCnpj.includes('*'));
    const detailAdm = await adm.call(`/api/admin/customers/${part.json.customer.id}`);
    assert.equal(detailAdm.json.customer.cpfCnpj, CPF);
    // editar sem apagar o resto
    const edit = await adm.call(`/api/admin/customers/${auto.json.customer.id}`, { method: 'PATCH', body: { city: 'Santos', state: 'sp' } });
    assert.equal(edit.status, 200, edit.text);
    assert.equal(edit.json.customer.city, 'Santos');
    assert.equal(edit.json.customer.segment, 'Vendedor de carros autônomo');
    assert.equal(edit.json.customer.type, 'AUTONOMO');
    // cliente criado entra pelo site com a senha temporária
    const login = await hostRequest(server.base, '/api/auth/login', { method: 'POST', body: { email: part.json.customer.email, password: part.json.temporaryPassword } });
    assert.equal(login.status, 200, login.text);
    // sem acesso ao portal não loga
    const noPortal = await mk({ name: 'Só Cadastro', portalAccess: false });
    assert.equal(noPortal.json.temporaryPassword, null);
    // arquivar tira da lista padrão e bloqueia o login; restaurar volta
    const arch = await adm.call(`/api/admin/customers/${part.json.customer.id}/archive`, { method: 'POST', body: {} });
    assert.equal(arch.status, 200);
    assert.ok(!(await adm.call('/api/admin/customers')).json.items.some((c) => c.id === part.json.customer.id));
    assert.ok((await adm.call('/api/admin/customers?status=archived')).json.items.some((c) => c.id === part.json.customer.id));
    assert.equal((await hostRequest(server.base, '/api/auth/login', { method: 'POST', body: { email: part.json.customer.email, password: part.json.temporaryPassword } })).status, 401);
    assert.equal((await adm.call(`/api/admin/customers/${part.json.customer.id}/archive`, { method: 'POST', body: { archived: false } })).status, 200);
    // exportar CSV
    const csv = await adm.call('/api/admin/customers/export.csv?type=EMPRESA');
    assert.equal(csv.status, 200);
    assert.ok(csv.text.includes('Loja Boa Ltda') && !csv.text.includes('Maria Particular'));
    // apagar
    assert.equal((await adm.call(`/api/admin/customers/${noPortal.json.customer.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await adm.call(`/api/admin/customers/${noPortal.json.customer.id}`)).status, 404);
  });

  it('empresas: cria, vincula clientes, filtra clientes por empresa, arquiva e só apaga vazia', async () => {
    const created = await adm.call('/api/admin/companies', { method: 'POST', body: { name: 'Agência Teste', kind: 'AGENCIA', document: CNPJ, city: 'Recife', state: 'PE' } });
    assert.equal(created.status, 201, created.text);
    const orgId = created.json.company.id;
    assert.equal((await adm.call('/api/admin/companies', { method: 'POST', body: { name: 'Ruim', kind: 'AGENCIA', document: '123' } })).status, 400);
    const cust = await adm.call('/api/admin/customers', { method: 'POST', body: { name: 'Func Agência', email: `${uid('f')}@cli.local`, type: 'EMPRESA', organizationId: orgId } });
    assert.equal(cust.status, 201, cust.text);
    assert.equal(cust.json.customer.organization.id, orgId);
    const detail = await adm.call(`/api/admin/companies/${orgId}`);
    assert.equal(detail.json.members.length, 1);
    assert.ok((await adm.call(`/api/admin/customers?organizationId=${orgId}`)).json.items.length === 1);
    assert.equal((await adm.call(`/api/admin/companies/${orgId}`, { method: 'DELETE' })).status, 409);
    assert.equal((await adm.call(`/api/admin/companies/${orgId}/members/${cust.json.customer.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await adm.call(`/api/admin/companies/${orgId}/archive`, { method: 'POST', body: {} })).status, 200);
    assert.ok(!(await adm.call('/api/admin/companies')).json.items.some((c) => c.id === orgId));
    assert.equal((await adm.call(`/api/admin/companies/${orgId}`, { method: 'DELETE' })).status, 204);
  });

  it('cobranças: plano em parcelas, atrasadas, baixa, reabrir, nota a emitir e cancelamento', async () => {
    const cust = await adm.call('/api/admin/customers', { method: 'POST', body: { name: 'Pagador Parcelado', email: `${uid('p')}@cli.local`, type: 'AUTONOMO', cpfCnpj: CPF, street: 'Rua B', zip: '01000000', city: 'São Paulo', state: 'SP' } });
    const customerId = cust.json.customer.id;
    assert.equal((await fin.call('/api/admin/charges', { method: 'POST', body: { customerId, description: 'x', totalCents: 1000, plan: { count: 2, firstDueDate: day(5) } } })).status, 400);
    const made = await fin.call('/api/admin/charges', { method: 'POST', body: { customerId, description: 'Plano mensal de consultas', totalCents: 10001, plan: { count: 3, firstDueDate: day(-40), frequency: 'MONTHLY' } } });
    assert.equal(made.status, 201, made.text);
    const { charge, installments } = made.json;
    assert.equal(installments.length, 3);
    assert.equal(installments.reduce((s, i) => s + i.amountCents, 0), 10001);
    assert.equal(installments[2].amountCents, 3335);
    assert.equal(charge.situation, 'OVERDUE');
    assert.ok(installments[0].overdue);
    // parcelas manuais precisam fechar o total
    assert.equal((await fin.call('/api/admin/charges', { method: 'POST', body: { customerId, description: 'Manual', totalCents: 5000, installments: [{ amountCents: 2000, dueDate: day(1) }, { amountCents: 2000, dueDate: day(10) }] } })).status, 400);
    // baixa da 1ª parcela já pedindo a nota
    const pay = await fin.call(`/api/admin/charges/${charge.id}/installments/${installments[0].id}/pay`, { method: 'POST', body: { method: 'PIX', createFiscalDocument: true, reference: 'comprovante 123' } });
    assert.equal(pay.status, 200, pay.text);
    assert.equal(pay.json.installments[0].status, 'PAID');
    assert.ok(pay.json.installments[0].fiscalDocumentId);
    assert.equal(pay.json.charge.installmentsPaid, 1);
    assert.equal((await fin.call(`/api/admin/charges/${charge.id}/installments/${installments[0].id}/pay`, { method: 'POST', body: { method: 'PIX' } })).status, 409);
    // lista e filtros
    const overdue = await fin.call('/api/admin/charges?status=overdue&customerType=AUTONOMO');
    assert.ok(overdue.json.items.some((c) => c.id === charge.id));
    assert.ok(overdue.json.summary.overdueCents >= installments[1].amountCents);
    assert.ok(!(await fin.call('/api/admin/charges?status=overdue&customerType=EMPRESA')).json.items.some((c) => c.id === charge.id));
    // cliente aparece com o que deve
    const detail = await fin.call(`/api/admin/customers/${customerId}`);
    assert.ok(detail.json.customer.overdueCents > 0);
    assert.equal(detail.json.charges.length, 1);
    // não apaga cliente com parcela aberta
    assert.equal((await adm.call(`/api/admin/customers/${customerId}`, { method: 'DELETE' })).status, 409);
    // nota pendente com dados do cliente
    const docs = await fin.call('/api/admin/fiscal/documents?status=PENDING');
    const doc = docs.json.items.find((d) => d.id === pay.json.installments[0].fiscalDocumentId);
    assert.ok(doc);
    assert.equal(doc.amountCents, installments[0].amountCents);
    assert.equal(doc.customer.type, 'AUTONOMO');
    assert.deepEqual(doc.missing, []);
    // reabrir cancela a nota pendente
    const reopen = await fin.call(`/api/admin/charges/${charge.id}/installments/${installments[0].id}/reopen`, { method: 'POST', body: {} });
    assert.equal(reopen.status, 200);
    assert.equal(reopen.json.installments[0].status, 'PENDING');
    assert.ok(!(await fin.call('/api/admin/fiscal/documents?status=PENDING')).json.items.some((d) => d.id === doc.id));
    // pagar tudo fecha a cobrança
    let last;
    for (const i of installments) last = await fin.call(`/api/admin/charges/${charge.id}/installments/${i.id}/pay`, { method: 'POST', body: { method: 'BOLETO', paidAt: day(-1) } });
    assert.equal(last.json.charge.status, 'PAID');
    assert.equal(last.json.charge.situation, 'PAID');
    assert.equal((await fin.call(`/api/admin/charges/${charge.id}`, { method: 'DELETE' })).status, 409);
    // cancelar uma cobrança sem pagamentos
    const second = await fin.call('/api/admin/charges', { method: 'POST', body: { customerId, description: 'Cobrança avulsa', totalCents: 2500, plan: { count: 1, firstDueDate: day(7) } } });
    const cancelled = await fin.call(`/api/admin/charges/${second.json.charge.id}/cancel`, { method: 'POST', body: {} });
    assert.equal(cancelled.json.charge.status, 'CANCELLED');
    assert.equal((await fin.call(`/api/admin/charges/${second.json.charge.id}`, { method: 'DELETE' })).status, 204);
  });

  it('notas fiscais: configurar emissor, criar, avisar dados faltando, emitir, bloquear número repetido, cancelar e exportar', async () => {
    assert.equal((await fin.call('/api/admin/fiscal/settings', { method: 'PUT', body: { taxRegime: 'SIMPLES', environment: 'HOMOLOGACAO', series: '1', cnpj: '11.111.111/1111-11' } })).status, 400);
    const settings = await fin.call('/api/admin/fiscal/settings', { method: 'PUT', body: {
      legalName: 'Placa na Mão Serviços Ltda', cnpj: CNPJ, municipalRegistration: '12345', taxRegime: 'SIMPLES', serviceCode: '1.07', city: 'São Paulo', state: 'SP', cityIbgeCode: '3550308',
      issRateBps: 200, environment: 'HOMOLOGACAO', series: '1', accountantEmail: 'contador@exemplo.com.br'
    } });
    assert.equal(settings.status, 200, settings.text);
    assert.equal(settings.json.ready, true);
    assert.equal(settings.json.cnpj, CNPJ);
    const cust = await adm.call('/api/admin/customers', { method: 'POST', body: { name: 'Sem Endereço', email: `${uid('n')}@cli.local`, type: 'PARTICULAR' } });
    const created = await fin.call('/api/admin/fiscal/documents', { method: 'POST', body: { customerId: cust.json.customer.id, description: 'Consulta veicular', amountCents: 6160 } });
    assert.equal(created.status, 201, created.text);
    assert.ok(created.json.missing.includes('CPF/CNPJ') && created.json.missing.includes('Endereço'));
    // corrige o cadastro e atualiza os dados da nota
    await adm.call(`/api/admin/customers/${cust.json.customer.id}`, { method: 'PATCH', body: { cpfCnpj: CPF, street: 'Rua C', zip: '01001000', city: 'São Paulo', state: 'SP' } });
    const refreshed = await fin.call(`/api/admin/fiscal/documents/${created.json.id}/refresh-customer`, { method: 'POST', body: {} });
    assert.deepEqual(refreshed.json.missing, []);
    // emitir
    const bad = await fin.call(`/api/admin/fiscal/documents/${created.json.id}/issue`, { method: 'POST', body: { number: '1', pdfUrl: 'http://inseguro.com/x.pdf' } });
    assert.equal(bad.status, 400);
    const issued = await fin.call(`/api/admin/fiscal/documents/${created.json.id}/issue`, { method: 'POST', body: { number: String(7000 + Math.floor(Math.random() * 900)), series: '1', verificationCode: 'ABC123', pdfUrl: 'https://notas.exemplo.com.br/1.pdf' } });
    assert.equal(issued.status, 200, issued.text);
    assert.equal(issued.json.status, 'ISSUED');
    // número repetido na mesma série
    const other = await fin.call('/api/admin/fiscal/documents', { method: 'POST', body: { customerId: cust.json.customer.id, description: 'Outra', amountCents: 1000 } });
    assert.equal((await fin.call(`/api/admin/fiscal/documents/${other.json.id}/issue`, { method: 'POST', body: { number: issued.json.number, series: '1' } })).status, 409);
    // pendente pode ser apagada; emitida só cancelada, com motivo
    assert.equal((await fin.call(`/api/admin/fiscal/documents/${other.json.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await fin.call(`/api/admin/fiscal/documents/${issued.json.id}`, { method: 'DELETE' })).status, 409);
    assert.equal((await fin.call(`/api/admin/fiscal/documents/${issued.json.id}/cancel`, { method: 'POST', body: { reason: 'x' } })).status, 400);
    const csvBefore = await fin.call('/api/admin/fiscal/documents/export.csv?status=ISSUED');
    assert.equal(csvBefore.status, 200);
    assert.ok(csvBefore.text.includes('Sem Endereço') && csvBefore.text.includes('Emitida'));
    const cancel = await fin.call(`/api/admin/fiscal/documents/${issued.json.id}/cancel`, { method: 'POST', body: { reason: 'Erro de digitação no valor' } });
    assert.equal(cancel.json.status, 'CANCELLED');
    // pagamentos do gateway sem nota viram "a emitir"
    const reg = await hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { name: 'Pagou Gateway', email: `${uid('g')}@cli.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true, accountType: 'AUTONOMO' } });
    assert.equal(reg.status, 201, reg.text);
    await pool.query(`INSERT INTO payments(user_id,provider,status,amount_cents,credits,paid_at) VALUES($1,'asaas','PAID',4360,0,now())`, [reg.json.user.id]);
    const before = await fin.call('/api/admin/fiscal/summary');
    assert.ok(before.json.paymentsWithoutDocument >= 1);
    const sync = await fin.call('/api/admin/fiscal/sync', { method: 'POST', body: {} });
    assert.ok(sync.json.created >= 1);
    assert.equal((await fin.call('/api/admin/fiscal/summary')).json.paymentsWithoutDocument, 0);
    assert.equal((await fin.call('/api/admin/fiscal/sync', { method: 'POST', body: {} })).json.created, 0);
    // pagamentos mostram tipo do cliente e situação da nota; filtram por tipo
    const pays = await fin.call('/api/admin/payments?customerType=AUTONOMO&status=PAID');
    assert.ok(pays.json.some((p) => p.customer.email === reg.json.user.email && p.customerType === 'AUTONOMO' && p.fiscalStatus === 'PENDING'));
    // quem não é financeiro não toca em notas
    assert.equal((await sup.call('/api/admin/fiscal/documents')).status, 403);
  });

  it('consultas filtram por tipo de cliente e cadastro público aceita o tipo de conta', async () => {
    const reg = await hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { name: 'Empresa Cad', email: `${uid('e')}@cli.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true, accountType: 'EMPRESA' } });
    const row = await pool.query('SELECT customer_type FROM user_profiles WHERE user_id=$1', [reg.json.user.id]);
    assert.equal(row.rows[0].customer_type, 'EMPRESA');
    const q = await sup.call('/api/admin/queries?customerType=EMPRESA');
    assert.equal(q.status, 200);
    assert.ok(Array.isArray(q.json));
    assert.equal((await sup.call('/api/admin/queries?customerType=INVALIDO')).status, 400);
  });

  it('vitrine e conteúdo: arquivar, restaurar e apagar produto, FAQ e artigo', async () => {
    // produto novo e nunca usado: pode apagar
    const created = await adm.call('/api/admin/products', { method: 'POST', body: { id: 'TESTE_ARQ', name: 'Produto de Teste', slug: 'produto-de-teste', description: 'Produto temporário para teste', priceCents: 1000, commercialStatus: 'SOON', showOnHome: true } });
    assert.equal(created.status, 201, created.text);
    const arch = await cont.call('/api/admin/content/products/TESTE_ARQ/archive', { method: 'POST', body: {} });
    assert.equal(arch.status, 200);
    const list = await adm.call('/api/admin/products');
    assert.ok(list.json.find((p) => p.id === 'TESTE_ARQ').archivedAt);
    const cat = await hostRequest(server.base, '/api/catalog');
    assert.ok(!cat.json.products.some((p) => p.id === 'TESTE_ARQ'));
    assert.equal((await cont.call('/api/admin/content/products/TESTE_ARQ/archive', { method: 'POST', body: { archived: false } })).status, 200);
    assert.equal((await cont.call('/api/admin/content/products/TESTE_ARQ', { method: 'DELETE' })).status, 200);
    assert.ok(!(await adm.call('/api/admin/products')).json.some((p) => p.id === 'TESTE_ARQ'));
    // produto com consultas não pode ser apagado, só arquivado
    const used = await adm.call('/api/admin/products', { method: 'POST', body: { id: 'TESTE_USO', name: 'Produto Usado', slug: 'produto-usado', description: 'Produto com histórico', priceCents: 1000, commercialStatus: 'SOON' } });
    assert.equal(used.status, 201, used.text);
    const owner = (await pool.query(`SELECT id FROM users WHERE role='CLIENTE' LIMIT 1`)).rows[0].id;
    await pool.query(`INSERT INTO vehicle_queries(user_id,plate,product_id,status,credits_cost,provider) VALUES($1,'ABC1D23','TESTE_USO','SUCCESS',0,'mock')`, [owner]);
    const blocked = await cont.call('/api/admin/content/products/TESTE_USO', { method: 'DELETE' });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.json.error, 'PRODUCT_IN_USE');
    assert.equal((await cont.call('/api/admin/content/products/TESTE_USO/archive', { method: 'POST', body: {} })).status, 200);
    // FAQ
    const faq = await cont.call('/api/admin/content/faqs', { method: 'POST', body: { category: 'Teste', question: 'Pergunta de arquivo?', answer: 'Resposta de arquivo longa o bastante.' } });
    const faqArch = await cont.call(`/api/admin/content/faqs/${faq.json.id}/archive`, { method: 'POST', body: {} });
    assert.equal(faqArch.json.archived, true);
    assert.ok(!(await hostRequest(server.base, '/api/faqs')).text.includes('Pergunta de arquivo?'));
    assert.equal((await cont.call(`/api/admin/content/faqs/${faq.json.id}/archive`, { method: 'POST', body: { archived: false } })).json.archived, false);
    assert.equal((await cont.call(`/api/admin/content/faqs/${faq.json.id}`, { method: 'DELETE' })).status, 200);
    // artigo publicado some do site ao arquivar
    const art = await cont.call('/api/admin/content/articles', { method: 'POST', body: { slug: uid('artigo'), title: 'Artigo para arquivar', status: 'PUBLISHED', body: 'Texto' } });
    assert.equal(art.status, 201, art.text);
    const slug = art.json.slug;
    assert.equal((await hostRequest(server.base, `/api/articles/${slug}`)).status, 200);
    const artArch = await cont.call(`/api/admin/content/articles/${art.json.id}/archive`, { method: 'POST', body: {} });
    assert.equal(artArch.json.archived, true);
    assert.equal((await hostRequest(server.base, `/api/articles/${slug}`)).status, 404);
    assert.equal((await cont.call(`/api/admin/content/articles/${art.json.id}`, { method: 'DELETE' })).status, 200);
  });
});
