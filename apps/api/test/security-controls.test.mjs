import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const server = await readFile(new URL('../src/server.ts', import.meta.url), 'utf8');
const auth = await readFile(new URL('../src/auth.ts', import.meta.url), 'utf8');
const config = await readFile(new URL('../src/config.ts', import.meta.url), 'utf8');
const frontend = await readFile(new URL('../../web/src/main.tsx', import.meta.url), 'utf8');

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

test('middleware não aceita token sem sessão persistida para equipe', () => {
  assert.match(auth, /\['OPERADOR', 'ADMIN', 'SUPER_ADMIN'\]\.includes\(String\(claims\.role\)\) && !claims\.sid/);
  assert.match(auth, /metadata\.totpVerified !== true/);
});

test('rotas de contato não expõem conteúdo sem permissão de auditoria', () => {
  assert.match(server, /api\.get\('\/admin\/contact-messages', auth, requirePermission\('VIEW_AUDIT'\)/);
  assert.match(server, /api\.patch\('\/admin\/contact-messages\/:id', auth, requirePermission\('MANAGE_USERS'\)/);
  assert.match(server, /api\.post\('\/contact', contactRateLimit/);
  assert.match(server, /api\.post\('\/account\/contact', auth, contactRateLimit/);
});

test('TOTP da equipe fica desligado por padrão e só é exigido quando explicitamente habilitado', () => {
  assert.match(config, /TEAM_TOTP_REQUIRED: booleanFromEnv\.default\(false\)/);
  assert.match(auth, /env\.TEAM_TOTP_REQUIRED && \['OPERADOR', 'ADMIN', 'SUPER_ADMIN'\]\.includes\(String\(claims\.role\)\)/);
  assert.match(server, /!isTeamRole\(user\.role\) \|\| !env\.TEAM_TOTP_REQUIRED/);
  assert.match(server, /totpRequired: isTeamRole\(user\.role\) && env\.TEAM_TOTP_REQUIRED/);
});

test('API impede cache condicional e o dashboard não transforma falha parcial em logout', () => {
  assert.match(server, /api\.use\(\(_req, res, next\) =>/);
  assert.match(server, /res\.setHeader\('Cache-Control', 'no-store'\)/);
  assert.match(frontend, /cache: 'no-store'/);
  assert.match(frontend, /Promise\.allSettled/);
  assert.match(frontend, /isAuthenticationFailure\(profileResult\.reason\)/);
  assert.match(frontend, /adminLoadErrors/);
  assert.match(frontend, /Tentar novamente/);
});

test('painel administrativo expõe alteração segura da senha da sessão atual', () => {
  assert.match(frontend, /function AdminPasswordCard\(/);
  assert.match(frontend, /onChangePassword=\{changePassword\}/);
  assert.match(frontend, /Atualizar senha/);
  assert.match(frontend, /auth\/change-password/);
  assert.match(frontend, /As outras sessões serão encerradas após a alteração/);
});

test('visão administrativa calcula receita de consulta pela ordem de pagamento', () => {
  assert.match(server, /FROM payments p JOIN payment_orders o ON o\.id=p\.order_id WHERE p\.status='PAID' AND o\.purchase_type='QUERY'/);
  assert.doesNotMatch(server, /FROM payments WHERE status='PAID' AND purchase_type='QUERY'/);
});

test('resposta bruta do provider fica desligada por padrão e credenciais de provider são documentadas', async () => {
  assert.match(config, /STORE_RAW_PROVIDER_RESPONSE: booleanFromEnv\.default\(false\)/);
  const envExample = await readFile(new URL('../../../.env.example', import.meta.url), 'utf8');
  for (const variable of ['APIBRASIL_BEARER_TOKEN', 'APIBRASIL_DEVICE_TOKEN', 'VEHICLE_API_DEVICE_TOKEN', 'VEHICLE_API_QUERY_METHOD', 'SUPER_ADMIN_BOOTSTRAP_ENABLED']) {
    assert.match(envExample, new RegExp(`^${variable}=`, 'm'));
  }
});
