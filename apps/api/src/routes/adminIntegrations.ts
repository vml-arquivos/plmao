import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { adminAuth } from '../auth.js';
import { env, publicAppUrl, CREDIFY_CONSULTA_CODES } from '../config.js';
import { isEmailConfigured, verifyEmailTransport } from '../email.js';
import { appError, asyncRoute, audit, log, requestId } from '../lib/http.js';
import { enqueueEmail } from '../lib/emailOutbox.js';
import { requirePermission } from '../permissions.js';
import { CredifyVehicleProvider } from '../providers/credifyProvider.js';

/**
 * Painel de integrações: mostra SE cada chave está configurada (nunca o valor), a URL de webhook a cadastrar
 * e testes de conexão que não cobram nem consultam dados de clientes.
 */
export const adminIntegrationsRouter = Router();
const guard = requirePermission('MANAGE_PROVIDERS');

type Var = { name: string; set: boolean; required: boolean; hint?: string };
type State = 'OFF' | 'PARTIAL' | 'READY';
const v = (name: string, set: unknown, required = true, hint?: string): Var => ({ name, set: Boolean(set), required, ...(hint ? { hint } : {}) });
const stateOf = (vars: Var[], on: boolean): State => (!on ? 'OFF' : vars.filter((x) => x.required).every((x) => x.set) ? 'READY' : 'PARTIAL');

export function integrationStatus() {
  const base = publicAppUrl();
  const mpOn = env.PAYMENT_PROVIDER === 'mercadopago';
  const mpVars = [v('PAYMENT_PROVIDER', mpOn, true, 'precisa ser mercadopago'), v('MP_ACCESS_TOKEN', env.MP_ACCESS_TOKEN, true, 'Access Token da aplicação (produção ou usuário de teste)'), v('MP_WEBHOOK_SECRET', env.MP_WEBHOOK_SECRET, true, 'Assinatura secreta do webhook, no painel do Mercado Pago')];
  const apiMode = env.EMAIL_PROVIDER === 'brevo_api';
  const smtpOn = env.EMAIL_PROVIDER === 'smtp' || apiMode;
  const smtpVars = [v('EMAIL_PROVIDER', smtpOn, true, 'smtp (ou brevo_api para enviar pela API)'), v('SMTP_HOST', env.SMTP_HOST, true, 'Brevo: smtp-relay.brevo.com'), v('SMTP_PORT', true, true, `atual: ${env.SMTP_PORT} (Brevo: 587, sem SMTP_SECURE; ou 465 com SMTP_SECURE=true)`), v('SMTP_USER', env.SMTP_USER, true, 'login SMTP exibido em Brevo > SMTP e API'), v('SMTP_PASSWORD', env.SMTP_PASSWORD, true, 'chave SMTP (não a chave de API)'), v('EMAIL_FROM', env.EMAIL_FROM, true, `atual: ${env.EMAIL_FROM}. O remetente/domínio precisa estar validado no Brevo`)];
  const mailVars = apiMode
    ? [v('EMAIL_PROVIDER', true, true, 'brevo_api (envio pela API do Brevo)'), v('BREVO_API_KEY', env.BREVO_API_KEY, true, 'chave de API do Brevo (SMTP e API > Chaves de API), não a chave SMTP'), smtpVars[smtpVars.length - 1]!]
    : smtpVars;
  const hookVars = [v('EMAIL_WEBHOOK_SECRET', env.EMAIL_WEBHOOK_SECRET, true, 'mesmo valor do token do portador (Bearer) ou do cabeçalho x-webhook-token no Brevo')];
  const credVars = [v('DATA_PROVIDER', env.DATA_PROVIDER === 'real', true, 'precisa ser real'), v('VEHICLE_API_PROVIDER', env.VEHICLE_API_PROVIDER === 'credify', true, 'precisa ser credify'), v('CREDIFY_CLIENT_ID', env.CREDIFY_CLIENT_ID), v('CREDIFY_CLIENT_SECRET', env.CREDIFY_CLIENT_SECRET), v('CREDIFY_QUERY_PATH', env.CREDIFY_QUERY_PATH, false, env.CREDIFY_QUERY_PATH ? `ATENÇÃO: definido (${env.CREDIFY_QUERY_PATH}); todos os pacotes usam essa mesma consulta. Apague para cada pacote usar a sua.` : 'não definido: cada pacote usa a consulta certa (Completa = Veículo Total 467; Básica, Gravame e Cadastral = Débitos e Restrições 487)'), v('CREDIFY_QUERY_BODY_TEMPLATE', env.CREDIFY_QUERY_BODY_TEMPLATE, false, env.CREDIFY_QUERY_BODY_TEMPLATE ? (env.CREDIFY_QUERY_PATH ? 'corpo personalizado em uso' : 'definido, mas ignorado enquanto CREDIFY_QUERY_PATH não existir (pode apagar)') : 'não precisa configurar: o corpo é montado com o código de cada consulta'), v('CREDIFY_QUERY_ID', env.CREDIFY_QUERY_ID, false, env.CREDIFY_QUERY_ID ? (env.CREDIFY_QUERY_PATH ? 'código personalizado em uso' : 'definido, mas ignorado enquanto CREDIFY_QUERY_PATH não existir (pode apagar)') : 'não precisa configurar: os códigos de cada consulta já estão no sistema')];
  const cpVars = [v('DATA_PROVIDER', env.DATA_PROVIDER === 'real', true, 'precisa ser real'), v('VEHICLE_API_PROVIDER', env.VEHICLE_API_PROVIDER === 'consultarplaca', true, 'precisa ser consultarplaca'), v('CONSULTARPLACA_EMAIL', env.CONSULTARPLACA_EMAIL, true, 'e-mail da conta'), v('CONSULTARPLACA_API_KEY', env.CONSULTARPLACA_API_KEY, true, 'Minha Conta > API > Gerar API KEY')];
  const cnpjVars = [v('CNPJ_PROVIDER', env.CNPJ_PROVIDER !== 'disabled', true, 'brasilapi')];
  const esignVars = [v('ESIGN_PROVIDER', env.ESIGN_PROVIDER !== 'disabled', true, 'internal = aceite eletrônico simples')];
  const fiscalVars = [v('FISCAL_PROVIDER', env.FISCAL_PROVIDER === 'manual', true, 'manual = fila para emissão externa')];
  const item = (key: string, name: string, vars: Var[], on: boolean, extra: Record<string, unknown> = {}) => ({ key, name, state: stateOf(vars, on), vars, ...extra });
  return [
    item('mercadopago', 'Mercado Pago (pagamentos)', mpVars, mpOn, { webhookUrl: `${base}/api/payments/mercadopago/webhook`, webhookNote: 'No painel do Mercado Pago, em Webhooks, cadastre esta URL e marque o evento "Pagamentos". Copie a assinatura secreta para MP_WEBHOOK_SECRET. Pagamentos de teste não geram aviso: o sistema também confere sozinho os pedidos em aberto.', mode: env.MP_ACCESS_TOKEN ? (env.MP_ACCESS_TOKEN.startsWith('TEST-') ? 'teste' : 'a confirmar (use Testar conexão)') : null, canTest: true }),
    item('email', apiMode ? 'E-mail (API do Brevo)' : 'E-mail (SMTP / Brevo)', mailVars, smtpOn, { canTest: true, workerOn: env.EMAIL_OUTBOX_WORKER }),
    item('email-webhook', 'Retorno de entrega de e-mail (Brevo)', hookVars, Boolean(env.EMAIL_WEBHOOK_SECRET), { webhookUrl: `${base}/api/webhooks/email/brevo`, webhookNote: 'No Brevo, em Webhooks transacionais, use esta URL, escolha autenticação por token do portador (Bearer) com o mesmo valor de EMAIL_WEBHOOK_SECRET (ou o cabeçalho x-webhook-token) e marque só entregue, bounce (hard/soft), bloqueado, reclamação e inválido.' }),
    item('vehicle', 'Consulta veicular (Credify)', credVars, env.VEHICLE_API_PROVIDER === 'credify', { canTest: true, webhookNote: 'Consulta Veículo Total (POST /veiculototal). O teste só faz o login na Credify (não gasta consulta) e mostra o IP de saída deste servidor, que precisa estar em "IPs Autorizados" na Credify. Depois, faça uma consulta real de baixo valor para validar.' }),
    item('site-access', 'Site fechado ao público (pré-lançamento)', [v('SITE_MODE', env.SITE_MODE === 'prelaunch', true, 'prelaunch = fechado ao público e sem indexação; public = aberto'), v('PRELAUNCH_ALLOWED_EMAILS', env.PRELAUNCH_ALLOWED_EMAILS, true, 'e-mails ou @domínios que podem criar conta, pagar e consultar')], env.SITE_MODE === 'prelaunch'),
    item('vehicle-test', 'Consulta veicular (ConsultarPlaca, teste)', cpVars, env.VEHICLE_API_PROVIDER === 'consultarplaca', { webhookNote: 'Use a placa AAA0000 (dados fictícios, não gasta crédito). Traz só dados do veículo; débitos e restrições aparecem como não fornecidos.' }),
    item('cnpj', 'Consulta de CNPJ', cnpjVars, env.CNPJ_PROVIDER !== 'disabled'),
    item('esign', 'Assinatura de contratos', esignVars, env.ESIGN_PROVIDER !== 'disabled'),
    item('fiscal', 'Emissão fiscal', fiscalVars, env.FISCAL_PROVIDER === 'manual')
  ];
}

adminIntegrationsRouter.get('/integrations', adminAuth, guard, asyncRoute(async (_req, res) => { res.json({ items: integrationStatus(), appUrl: publicAppUrl() }); }));

const fail = (code: string, http = 409) => appError(code, { code, http, expose: true });

/** Leitura somente: pergunta ao Mercado Pago quem é o dono do token. Não cria pagamento nem cobra. */
adminIntegrationsRouter.post('/integrations/mercadopago/test', adminAuth, guard, asyncRoute(async (req, res) => {
  if (!env.MP_ACCESS_TOKEN) throw fail('INTEGRATION_NOT_CONFIGURED');
  const base = (env.MP_API_BASE_URL ?? 'https://api.mercadopago.com').replace(/\/+$/, '');
  let status = 0; let body: Record<string, unknown> = {};
  try {
    const r = await fetch(`${base}/users/me`, { headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, Accept: 'application/json' }, signal: AbortSignal.timeout(env.MP_TIMEOUT_MS) });
    status = r.status; body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  } catch { throw fail('INTEGRATION_UNREACHABLE', 502); }
  await audit(req.user!.id, 'INTEGRATION_TESTED', 'INTEGRATION', null, { integration: 'mercadopago', httpStatus: status, requestId: requestId(req) });
  if (status === 401 || status === 403) throw fail('INTEGRATION_CREDENTIALS_REJECTED', 422);
  if (status < 200 || status >= 300) throw fail('INTEGRATION_UNREACHABLE', 502);
  res.json({ ok: true, mode: env.MP_ACCESS_TOKEN.startsWith('TEST-') || /^test/i.test(String(body.nickname ?? '')) ? 'teste' : 'produção', siteId: typeof body.site_id === 'string' ? body.site_id : null, accountIdTail: body.id ? String(body.id).slice(-4) : null, webhookSecretSet: Boolean(env.MP_WEBHOOK_SECRET), checkoutActive: env.PAYMENT_PROVIDER === 'mercadopago' });
}));

/** Confere a conexão SMTP e agenda um e-mail de teste para quem clicou. */
adminIntegrationsRouter.post('/integrations/email/test', adminAuth, guard, asyncRoute(async (req, res) => {
  if (!isEmailConfigured()) throw fail('INTEGRATION_NOT_CONFIGURED');
  try { await verifyEmailTransport(); } catch (error) {
    const e = error as { code?: string; responseCode?: number };
    log('warn', 'smtp_test_failed', { code: e.code ?? null, responseCode: e.responseCode ?? null, requestId: requestId(req) });
    // Login ou chave errados (535) são diferentes de servidor inalcançável (host, porta ou rede).
    if (e.code === 'EAUTH' || e.responseCode === 535) throw fail('INTEGRATION_CREDENTIALS_REJECTED', 422);
    throw fail('SMTP_CONNECTION_FAILED', 502);
  }
  const q = await enqueueEmail({ idempotencyKey: `integration-test:${randomUUID()}`, template: 'GENERIC_NOTICE', toEmail: req.user!.email, toName: req.user!.name, data: { name: req.user!.name, documentTitle: 'Teste de e-mail', message: 'Se você recebeu esta mensagem, o envio de e-mail está funcionando.' }, createdBy: req.user!.id });
  await audit(req.user!.id, 'INTEGRATION_TESTED', 'INTEGRATION', null, { integration: 'email', requestId: requestId(req) });
  res.json({ ok: true, connection: 'ok', queued: true, outboxId: q.id, workerOn: env.EMAIL_OUTBOX_WORKER });
}));

/** IP público de saída do servidor (o que a Credify enxerga). Melhor esforço: null se o serviço não responder. */
async function outboundIp(): Promise<string | null> {
  try {
    const r = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(4000) });
    const j = (await r.json()) as { ip?: unknown };
    return typeof j.ip === 'string' && /^[0-9a-fA-F:.]{3,45}$/.test(j.ip) ? j.ip : null;
  } catch { return null; }
}

/** Login na Credify (não consome consulta) e, se vier `plate`, uma consulta real (gasta 1 consulta do plano). Devolve o motivo técnico quando falha, sem expor chaves. */
adminIntegrationsRouter.post('/integrations/vehicle/test', adminAuth, guard, asyncRoute(async (req, res) => {
  if (env.VEHICLE_API_PROVIDER !== 'credify') throw fail('INTEGRATION_NOT_CONFIGURED');
  if (!env.CREDIFY_CLIENT_ID || !env.CREDIFY_CLIENT_SECRET) throw fail('INTEGRATION_NOT_CONFIGURED');
  const serverIp = await outboundIp();
  const plate = typeof req.body?.plate === 'string' ? req.body.plate.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
  if (plate && !/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate)) throw fail('INVALID_PLATE');
  // Pacote cuja consulta será testada (a rota da Credify depende dele); sem pacote, usa o caminho padrão.
  const productId = typeof req.body?.productId === 'string' ? req.body.productId.toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 40) : '';
  let result: Record<string, unknown>;
  try {
    const provider = new CredifyVehicleProvider();
    const r = await provider.testConnection();
    result = { ok: true, expiresInMinutes: r.expiresInMinutes, serverIp, queryEnabled: env.DATA_PROVIDER === 'real' };
    if (plate) {
      const out = await provider.queryByPlate(plate, { productId: productId || undefined });
      const raw = (out.raw ?? {}) as Record<string, unknown>;
      const route = provider.routeFor(productId || undefined);
      result = { ...result, plate, productId: productId || null, servicePath: route.path, serviceCode: CREDIFY_CONSULTA_CODES[route.path.toLowerCase()] ?? null, queryOk: true, providerQueryId: out.providerQueryId ?? null, blocks: Object.keys(raw).slice(0, 20) };
    }
  } catch (error) {
    const e = error as Error & { code?: string; detail?: string };
    // Ajuda a achar erro de digitação sem expor a chave: o ClientID (identificador, não é segredo) e só o tamanho do ClientSecret.
    const id = (env.CREDIFY_CLIENT_ID ?? '').trim().replace(/^(["'])(.*)\1$/, '$2').trim();
    const secret = (env.CREDIFY_CLIENT_SECRET ?? '').trim().replace(/^(["'])(.*)\1$/, '$2').trim();
    const credentialHint = { clientId: id || null, secretLength: secret.length, secretNumeric: /^\d+$/.test(secret) };
    result = { ok: false, code: e.code ?? 'PROVIDER_ERROR', detail: e.detail ?? e.message, serverIp, ...(e.code === 'DATA_PROVIDER_AUTH_FAILED' ? { credentialHint } : {}), ...(plate ? { plate, queryTested: true } : {}) };
  }
  await audit(req.user!.id, 'INTEGRATION_TESTED', 'INTEGRATION', null, { integration: 'credify', ok: result.ok, code: result.code ?? null, withQuery: Boolean(plate), requestId: requestId(req) });
  res.json(result);
}));
