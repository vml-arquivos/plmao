import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { useTestEnv } from './helpers/db.mjs';

useTestEnv();
const { CredifyVehicleProvider, resetCredifyTokenCache } = await import('../dist/providers/credifyProvider.js');
const { buildReportV2 } = await import('../dist/report/normalizeV2.js');
const { mergeOwnerPlate } = await import('../dist/report/layers.js');

const sample = JSON.parse(fs.readFileSync(new URL('./fixtures/exemplo-retorno-provedor.json', import.meta.url), 'utf8'));
const jwt = () => `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64url')}.s`;
const consulta = (id) => ({ CODIGORESPOSTA: '1', DATAHORA: '01/01/2026 10:00:00', LOGON: '1', IDCONSULTA: id });
const ok = (id, resposta) => ({ CONSULTA: consulta(id), RESPOSTA: { CODIGO: '1', ...resposta } });
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    if (path === '/auth') return new Response(JSON.stringify({ Success: true, Dados: jwt() }), { status: 200 });
    const h = routes[path];
    if (!h) throw new Error(`chamada inesperada: ${path}`);
    return new Response(JSON.stringify(h), { status: 200 });
  };
  fn.paid = () => calls.filter((c) => c !== '/auth');
  return fn;
}
const opts = (fetchImpl) => ({ baseUrl: 'https://api.credify.test', clientId: 'cid', clientSecret: 'sec', method: 'post', timeoutMs: 3000, fetchImpl });
const LIMPO = { RESTRICAOFINAN: 'NADA CONSTA', RESTRICAONOMEAGENTE: [], NUMEROCONTRATOFINANCEIRA: [], RESTRICAODATAINCLUSAO: [], CGCFINANCEIRA: [] };
// Caso real: a base não traz o nome e o CPF vem de zeros.
const baseSemNome = () => {
  const c = structuredClone(sample);
  Object.assign(c.RESPOSTA.VEICULOSBDRP.RETORNO, LIMPO, { PRONOME: [], CPF_CNPJ_PROPRIETARIO: '00000000000', TIPODOCUMENTOPROPRIETARIO: 'FISICA' });
  return c;
};
const DONO = ok('514', { VEICULOPROPRIETARIOPLACA: { PLACA: 'AAA0000', NOME_PROPRIETARIO: 'MARIA DE SOUZA LIMA', NUMERO_DOCUMENTO_PROPRIETARIO: '98765432100', TIPO_DOCUMENTO_PROPRIETARIO: 'FISICA', NUMERO_IDENTIFICACAO_FATURADO: '59275792000826', TIPO_DOCUMENTO_FATURADO: 'JURIDICA' } });
const itensDe = (raw) => new Map(buildReportV2(raw).sections.flatMap((s) => s.items).map((i) => [i.key, i]));

test('proprietário pela placa: completa nome e CPF que a base não trouxe, e só compra a consulta quando o produto a usa', async () => {
  resetCredifyTokenCache();
  const f = fakeFetch({ '/debitosrestricoesproprietarios': baseSemNome(), '/veiculoproprietarioplaca': DONO });
  const out = await new CredifyVehicleProvider(opts(f)).queryByPlate('AAA0000', { productId: 'BASIC', sources: ['OWNER_PLATE'] });
  assert.deepEqual([...f.paid()].sort(), ['/debitosrestricoesproprietarios', '/veiculoproprietarioplaca']);
  const it = itensDe(out.raw);
  assert.equal(it.get('PRONOME').value, 'MARIA DE SOUZA LIMA');
  assert.equal(it.get('CPF_CNPJ_PROPRIETARIO').value, '987.654.321-00');
  assert.equal(it.get('CPFCNPJFATURADO').value, '59.275.792/0008-26');

  resetCredifyTokenCache();
  const g = fakeFetch({ '/debitosrestricoesproprietarios': baseSemNome() });
  const sem = await new CredifyVehicleProvider(opts(g)).queryByPlate('AAA0000', { productId: 'BASIC', sources: ['GRAVAME'] });
  assert.deepEqual(g.paid(), ['/debitosrestricoesproprietarios']);
  assert.equal(itensDe(sem.raw).get('PRONOME')?.state ?? 'NOT_PROVIDED', 'NOT_PROVIDED');
});

test('proprietário pela placa: documento de zeros não aparece e dado que a base trouxe nunca é trocado', () => {
  const bdrp = { RETORNO: { PRONOME: 'NOME DA BASE', CPF_CNPJ_PROPRIETARIO: '11122233344' } };
  const merged = mergeOwnerPlate(bdrp, { kind: 'data', resposta: DONO.RESPOSTA });
  assert.equal(merged.RETORNO.PRONOME, 'NOME DA BASE');
  assert.equal(merged.RETORNO.CPF_CNPJ_PROPRIETARIO, '11122233344');
  assert.equal(merged.RETORNO.TIPODOCUMENTOPROPRIETARIO, 'FISICA');
  const zeros = buildReportV2(baseSemNome());
  assert.equal(zeros.sections.flatMap((s) => s.items).find((i) => i.key === 'CPF_CNPJ_PROPRIETARIO')?.state ?? 'NOT_PROVIDED', 'NOT_PROVIDED');
  const falha = mergeOwnerPlate(bdrp, { kind: 'none' });
  assert.equal(falha, bdrp);
});

test('proprietário pela placa: se a consulta falhar, o relatório sai com o que a base trouxe', async () => {
  resetCredifyTokenCache();
  const f = fakeFetch({ '/debitosrestricoesproprietarios': baseSemNome() });
  const out = await new CredifyVehicleProvider(opts(f)).queryByPlate('AAA0000', { productId: 'BASIC', sources: ['OWNER_PLATE'] });
  assert.equal(out.raw.parcial, true);
  assert.ok(itensDe(out.raw).get('TIPODOCUMENTOPROPRIETARIO'));
});
