import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// Carrega a configuração em produção num processo à parte e lê só os códigos de erro de provedor veicular.
function issues(extra) {
  const base = { PATH: process.env.PATH, NODE_ENV: 'production', DATA_PROVIDER: 'real', DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/x', JWT_SECRET: 'x'.repeat(40) };
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./apps/api/dist/config.js')"], { env: { ...base, ...extra }, encoding: 'utf8', cwd: new URL('../../..', import.meta.url) });
  const m = /Error: PRODUCTION_CONFIGURATION_INVALID:([^\r\n]+)/.exec(`${r.stderr}${r.stdout}`);
  return m ? m[1].split(',') : [];
}

test('ConsultarPlaca com e-mail e chave não exige VEHICLE_API_* genérico', () => {
  const list = issues({ VEHICLE_API_PROVIDER: 'consultarplaca', CONSULTARPLACA_EMAIL: 'a@b.com', CONSULTARPLACA_API_KEY: 'x' });
  assert.ok(list.length > 0, 'outras exigências de produção seguem valendo');
  assert.ok(!list.some((i) => i.startsWith('VEHICLE_PROVIDER_') || i.startsWith('CONSULTARPLACA_')), list.join(','));
});

test('ConsultarPlaca sem chave pede as credenciais dela', () => {
  const list = issues({ VEHICLE_API_PROVIDER: 'consultarplaca' });
  assert.ok(list.includes('CONSULTARPLACA_CREDENTIALS_REQUIRED'), list.join(','));
  assert.ok(!list.includes('VEHICLE_PROVIDER_ENDPOINT_REQUIRED'));
});

test('Credify não exige VEHICLE_API_* genérico', () => {
  const list = issues({ VEHICLE_API_PROVIDER: 'credify' });
  assert.ok(list.includes('CREDIFY_CREDENTIALS_REQUIRED'), list.join(','));
  assert.ok(!list.some((i) => i.startsWith('VEHICLE_PROVIDER_')), list.join(','));
});

test('adaptador genérico continua exigindo endereço e credenciais', () => {
  const list = issues({ VEHICLE_API_PROVIDER: 'generic' });
  assert.ok(list.includes('VEHICLE_PROVIDER_ENDPOINT_REQUIRED'), list.join(','));
});

test('Credify: o corpo do Veículo Total é padrão (não exige CREDIFY_QUERY_BODY_TEMPLATE); caminho próprio exige corpo', () => {
  const padrao = issues({ VEHICLE_API_PROVIDER: 'credify', CREDIFY_CLIENT_ID: 'a', CREDIFY_CLIENT_SECRET: 'b' });
  assert.ok(!padrao.includes('CREDIFY_QUERY_BODY_TEMPLATE_INVALID') && !padrao.includes('CREDIFY_CREDENTIALS_REQUIRED'), padrao.join(','));
  const outro = issues({ VEHICLE_API_PROVIDER: 'credify', CREDIFY_CLIENT_ID: 'a', CREDIFY_CLIENT_SECRET: 'b', CREDIFY_QUERY_PATH: '/outra' });
  assert.ok(outro.includes('CREDIFY_QUERY_BODY_TEMPLATE_INVALID'), outro.join(','));
});

test('Credify sem credencial: o erro diz qual variável falta e lista só os nomes recebidos, nunca os valores', () => {
  const list = issues({ VEHICLE_API_PROVIDER: 'credify', CREDIFY_CLIENT_ID: 'valor-secreto-123' });
  assert.ok(list.includes('FALTA_CREDIFY_CLIENT_SECRET') && !list.includes('FALTA_CREDIFY_CLIENT_ID'), list.join(','));
  const seen = list.find((i) => i.startsWith('VARIAVEIS_PARECIDAS_RECEBIDAS'));
  assert.ok(seen, list.join(','));
  assert.ok(!list.join(',').includes('valor-secreto-123'));
});
