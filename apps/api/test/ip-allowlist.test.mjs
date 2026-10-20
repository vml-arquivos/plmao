process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test-jwt-secret-test-jwt-secret-test-jwt-secret-0001';
import assert from 'node:assert/strict';
import test from 'node:test';
const { ipAllowed } = await import('../dist/auth.js');

test('lista vazia libera; IPv4 exato e CIDR; IPv4 mapeado em IPv6', () => {
  assert.equal(ipAllowed('1.2.3.4', []), true);
  assert.equal(ipAllowed('1.2.3.4', ['1.2.3.4']), true);
  assert.equal(ipAllowed('1.2.3.5', ['1.2.3.4']), false);
  assert.equal(ipAllowed('203.0.113.77', ['203.0.113.0/24']), true);
  assert.equal(ipAllowed('203.0.114.1', ['203.0.113.0/24']), false);
  assert.equal(ipAllowed('::ffff:203.0.113.9', ['203.0.113.0/24']), true);
  assert.equal(ipAllowed(undefined, ['1.2.3.4']), false);
});
test('IPv6 com CIDR /64', () => {
  assert.equal(ipAllowed('2001:db8:1:2::5', ['2001:db8:1:2::/64']), true);
  assert.equal(ipAllowed('2001:db8:1:3::5', ['2001:db8:1:2::/64']), false);
  assert.equal(ipAllowed('::1', ['::1']), true);
});
