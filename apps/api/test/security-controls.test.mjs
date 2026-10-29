import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const server = await readFile(new URL('../src/server.ts', import.meta.url), 'utf8');
const auth = await readFile(new URL('../src/auth.ts', import.meta.url), 'utf8');
const config = await readFile(new URL('../src/config.ts', import.meta.url), 'utf8');
const webApi = await readFile(new URL('../../web/src/shared/api.ts', import.meta.url), 'utf8');
const adminAccount = await readFile(new URL('../../web/src/admin/pages/Account.tsx', import.meta.url), 'utf8');
const adminSession = await readFile(new URL('../../web/src/admin/session.tsx', import.meta.url), 'utf8');
const adminApi = await readFile(new URL('../../web/src/admin/api.ts', import.meta.url), 'utf8');

test('hardening fixa CSP e origem CORS sem reflexão ampla', () => {
  assert.match(server, /contentSecurityPolicy:\s*\{/);
  assert.match(server, /defaultSrc:\s*\[\"'self'\"\]/);
  assert.match(server, /objectSrc:\s*\[\"'none'\"\]/);
  assert.match(server, /frameAncestors:\s*\[\"'none'\"\]/);
  assert.match(server, /cors\(\{ origin: env\.WEB_ORIGIN, credentials: false \}\)/);
  assert.doesNotMatch(server, /cors\(\{\s*origin:\s*true/i);
});

test('retenção exige prévia por padrão e só permite execução administrativa explícita', () => {
  assert.match(server, /olderThanDays: z\.number\(\)\.int\(\)\.min\(180\)\.max\(3650\)\.default\(180\)/);
  assert.match(server, /if \(!parsed\.data\.execute\)/);
  assert.match(server, /dryRun: true/);
  assert.match(server, /requirePermission\('ADMIN_SYSTEM'\)/);
  assert.match(server, /INSERT INTO audit_retention_runs/);
});

test('middleware admin exige sessão persistida, audiência admin e TOTP verificado', () => {
  assert.match(auth, /audience === 'admin' && \(!claims\.sid \|\| !isTeamRole\(String\(claims\.role\)\)\)/);
  assert.match(auth, /metadata\?\.totpVerified !== true/);
  assert.match(auth, /has_totp/);
});

test('rotas de contato não expõem conteúdo sem permissão de suporte', () => {
  assert.match(server, /api\.get\('\/admin\/contact-messages', adminAuth, requirePermission\('MANAGE_SUPPORT'\)/);
  assert.match(server, /api\.patch\('\/admin\/contact-messages\/:id', adminAuth, requirePermission\('MANAGE_SUPPORT'\)/);
  assert.match(server, /api\.post\('\/contact', contactRateLimit/);
  assert.match(server, /api\.post\('\/account\/contact', auth, contactRateLimit/);
});

test('TOTP da equipe é opcional por padrão (TEAM_TOTP_REQUIRED=true torna obrigatório)', () => {
  assert.match(config, /TEAM_TOTP_REQUIRED: booleanFromEnv\.default\(false\)/);
  assert.doesNotMatch(config, /ADMIN_TOTP_CANNOT_BE_DISABLED/);
  assert.match(server, /if \(isTeamRole\(user\.role\)\) throw appError\('INVALID_CREDENTIALS'/);
});

test('API impede cache condicional e o dashboard não transforma falha parcial em logout', () => {
  assert.match(server, /api\.use\(\(_req, res, next\) =>/);
  assert.match(server, /res\.setHeader\('Cache-Control', 'no-store'\)/);
  assert.match(webApi, /cache: 'no-store'/);
  // sessão expirada (401) limpa o token do painel; erro parcial de uma tela não derruba a sessão
  assert.match(adminSession, /pnm:admin-unauthorized/);
  assert.match(webApi, /res\.status === 401 && t && opts\.onUnauthorized/);
  assert.match(adminApi, /store: 'session'/);
});

test('documentos FIPE exigem proprietário e consultas pagas bloqueiam estorno ativo', () => {
  assert.match(server, /report_kind=\\'FIPE_FREE\\' AND user_id=\$2/);
  assert.match(server, /QUERY_PAYMENT_REFUND_PENDING/);
  assert.match(server, /payment_refunds pr WHERE pr\.order_id=o\.id AND pr\.status IN \('REQUESTED','CONFIRMED'\)/);
});

test('painel administrativo expõe alteração segura da senha da sessão atual', () => {
  assert.match(adminAccount, /Atualizar senha/);
  assert.match(adminAccount, /admin\/auth\/change-password/);
  assert.match(adminAccount, /As outras sessões serão encerradas após a alteração/);
});

test('visão administrativa calcula receita de consulta pela ordem de pagamento', () => {
  assert.match(server, /FROM payments p JOIN payment_orders o ON o\.id=p\.order_id WHERE p\.status='PAID' AND o\.purchase_type='QUERY'/);
  assert.doesNotMatch(server, /FROM payments WHERE status='PAID' AND purchase_type='QUERY'/);
});

test('resposta bruta do provider é guardada criptografada por padrão e credenciais de provider são documentadas', async () => {
  assert.match(config, /STORE_RAW_PROVIDER_RESPONSE: booleanFromEnv\.default\(true\)/);
  assert.match(server, /encryptRaw\(output\.raw\)/);
  const envExample = await readFile(new URL('../../../.env.example', import.meta.url), 'utf8');
  for (const variable of ['APIBRASIL_BEARER_TOKEN', 'APIBRASIL_DEVICE_TOKEN', 'VEHICLE_API_DEVICE_TOKEN', 'VEHICLE_API_QUERY_METHOD', 'SUPER_ADMIN_BOOTSTRAP_ENABLED']) {
    assert.match(envExample, new RegExp(`^${variable}=`, 'm'));
  }
});
