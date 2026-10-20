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
    RATE_LIMIT_ENABLED: 'false', DATA_PROVIDER: 'mock', PAYMENT_PROVIDER: 'disabled', SANDBOX_SEED_ENABLED: 'true',
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
