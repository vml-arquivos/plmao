import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';
process.env.JWT_SECRET ??= 'test-jwt-secret-for-totp-regression';

const {
  verifyTotpCode,
  encryptTotpSecret,
  decryptTotpSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
} = await import('../dist/totp.js');

const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('verifica vetores RFC 6238 com janela de tolerância de relógio', () => {
  assert.equal(verifyTotpCode(RFC_SECRET, '287082', 59_000), true);
  assert.equal(verifyTotpCode(RFC_SECRET, '081804', 1_111_111_109_000), true);
  assert.equal(verifyTotpCode(RFC_SECRET, '279037', 2_000_000_000_000), true);
  assert.equal(verifyTotpCode(RFC_SECRET, '287082', 90_000), false);
  assert.equal(verifyTotpCode(RFC_SECRET, '12345', 59_000), false);
});

test('protege o segredo TOTP com payload autenticado e não retorna o segredo em claro', () => {
  const secret = 'JBSWY3DPEHPK3PXP';
  const encrypted = encryptTotpSecret(secret);
  assert.notEqual(encrypted, secret);
  assert.match(encrypted, /^v1:[^:]+:[^:]+:[^:]+$/);
  assert.equal(decryptTotpSecret(encrypted), secret);
  assert.throws(() => decryptTotpSecret(`${encrypted}x`));
});

test('gera códigos de recuperação formatados e normaliza o mesmo código para hash único', () => {
  const codes = generateRecoveryCodes(8);
  assert.equal(codes.length, 8);
  assert.equal(new Set(codes).size, 8);
  for (const code of codes) {
    assert.match(code, /^[A-F0-9]{5}-[A-F0-9]{5}$/);
    assert.equal(normalizeRecoveryCode(code), code.replace('-', ''));
    assert.equal(hashRecoveryCode(code), hashRecoveryCode(code.replace('-', '')));
  }
});

test('não aceita segredo TOTP inválido', () => {
  assert.throws(() => verifyTotpCode('INVALID0', '000000', 0));
});
