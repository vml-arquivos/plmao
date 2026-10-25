import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { TEST_DATABASE_URL } from './db.mjs';

function freePort() {
  return new Promise((resolve) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
}

/** Sobe o servidor compilado (dist/server.js) numa porta livre com o ambiente de teste. */
export async function startServer(extraEnv = {}) {
  const port = await freePort();
  const entry = fileURLToPath(new URL('../../dist/server.js', import.meta.url));
  const env = {
    ...process.env,
    NODE_ENV: 'test', PORT: String(port), DATABASE_URL: TEST_DATABASE_URL,
    JWT_SECRET: 'test-jwt-secret-test-jwt-secret-test-jwt-secret-0001',
    ADMIN_JWT_SECRET: 'test-admin-jwt-secret-test-admin-jwt-secret-0002',
    DATA_ENCRYPTION_KEY: 'test-data-encryption-key-0123456789abcdef',
    RATE_LIMIT_ENABLED: 'false', STORE_RAW_PROVIDER_RESPONSE: 'true', TEAM_TOTP_REQUIRED: 'true', DATA_PROVIDER: 'mock', PAYMENT_PROVIDER: 'disabled', SANDBOX_SEED_ENABLED: 'true',
    WEB_ORIGIN: `http://127.0.0.1:${port}`, ...extraEnv
  };
  const child = spawn(process.execPath, [entry], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  const base = `http://127.0.0.1:${port}`;
  const started = Date.now();
  for (;;) {
    if (child.exitCode !== null) throw new Error(`servidor encerrou: ${output.slice(-2000)}`);
    try { const r = await fetch(`${base}/health`); if (r.ok) break; } catch { /* aguardando */ }
    if (Date.now() - started > 30000) { child.kill(); throw new Error(`timeout subindo servidor: ${output.slice(-2000)}`); }
    await new Promise((r) => setTimeout(r, 150));
  }
  return {
    base,
    logs: () => output,
    async stop() { if (process.env.DEBUG_SERVER_LOGS) console.error(output); child.kill('SIGTERM'); await new Promise((r) => child.once('exit', r)); },
    request: (path, { method = 'GET', body, token, headers = {} } = {}) => fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined })
  };
}

/** Cria um usuário de equipe, cumpre o 2FA e devolve um token de admin válido. */
export async function adminSession({ server, pool, role = 'SUPER_ADMIN', host = 'admin.placanamao.test' }) {
  const bcrypt = (await import('bcryptjs')).default;
  const { totpCodeAt } = await import('../../dist/totp.js');
  const email = `adm-${Math.random().toString(36).slice(2, 9)}@painel.local`;
  const password = 'Senha-Forte-123!';
  await pool.query(`INSERT INTO users(email,password_hash,name,role) VALUES($1,$2,'Admin Teste',$3)`, [email, await bcrypt.hash(password, 4), role]);
  const call = (path, opts = {}) => hostRequest(server.base, path, { ...opts, host });
  const login = await call('/api/admin/auth/login', { method: 'POST', body: { email, password } });
  const secret = login.json.setup.secret;
  const ok = await call('/api/admin/auth/totp/enroll/confirm', { method: 'POST', body: { challenge: login.json.challenge, code: totpCodeAt(secret) } });
  return { email, token: ok.json.token, call: (path, opts = {}) => call(path, { token: ok.json.token, ...opts }) };
}

import http from 'node:http';
export function hostRequest(base, path, { method = 'GET', body, token, host, headers: extraHeaders = {} } = {}) {
  const url = new URL(base + path);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers: { 'content-type': 'application/json', ...(body ? { 'content-length': Buffer.byteLength(JSON.stringify(body)) } : {}), ...extraHeaders, ...(host ? { host } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) } }, (res) => {
      let data = ''; res.on('data', (d) => { data += d; });
      res.on('end', () => { let json = null; try { json = data ? JSON.parse(data) : null; } catch { json = data; } resolve({ status: res.statusCode, json, text: data, headers: res.headers }); });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}
