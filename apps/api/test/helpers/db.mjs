// Testes de integração usam um PostgreSQL real e isolado: TEST_DATABASE_URL (ex.: postgresql://postgres@127.0.0.1:54329/plmao_test).
// Sem a variável, as suítes de integração são puladas (nunca tocam em nenhum outro banco).
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const integration = TEST_DATABASE_URL ? {} : { skip: 'TEST_DATABASE_URL não definido' };

export function useTestEnv(extra = {}) {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-jwt-secret-test-jwt-secret-test-jwt-secret-0001';
  process.env.ADMIN_JWT_SECRET = 'test-admin-jwt-secret-test-admin-jwt-secret-0002';
  process.env.DATA_ENCRYPTION_KEY = 'test-data-encryption-key-0123456789abcdef';
  process.env.RATE_LIMIT_ENABLED = 'false';
  process.env.AUDIT_LOG_ENABLED = 'true';
  for (const [k, v] of Object.entries(extra)) process.env[k] = v;
}

export async function loadCore() {
  const { ensureSchema } = await import('../../dist/schema.js');
  const db = await import('../../dist/db.js');
  await ensureSchema();
  return db;
}

export function uid(prefix = 'u') { return `${prefix}-${Math.random().toString(36).slice(2, 10)}`; }
