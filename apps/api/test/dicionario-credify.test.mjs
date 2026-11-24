import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { useTestEnv } from './helpers/db.mjs';

useTestEnv();
const { CredifyVehicleProvider, resetCredifyTokenCache } = await import('../dist/providers/credifyProvider.js');
const { buildReportV2 } = await import('../dist/report/normalizeV2.js');

// Respostas de exemplo publicadas na documentação da Credify (valores anonimizados), passadas pelo caminho real: provedor → relatório.
const DOC = JSON.parse(fs.readFileSync(new URL('./fixtures/credify-exemplos-documentacao.json', import.meta.url), 'utf8'));
const base = JSON.parse(fs.readFileSync(new URL('./fixtures/exemplo-retorno-provedor.json', import.meta.url), 'utf8'));
const jwt = () => `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64url')}.s`;
const fakeFetch = (routes) => async (url) => {
  const path = new URL(String(url)).pathname;
  if (path === '/auth') return new Response(JSON.stringify({ Success: true, Dados: jwt() }), { status: 200 });
  const h = routes[path];
  if (!h) throw new Error(`chamada inesperada: ${path}`);
  return new Response(JSON.stringify(h), { status: 200 });
};
const opts = (routes) => ({ baseUrl: 'https://api.credify.test', clientId: 'cid', clientSecret: 'sec', method: 'post', timeoutMs: 3000, fetchImpl: fakeFetch(routes) });
const { boletoCents, fineCents } = await import('../dist/report/vehicleTotal.js');
const items = (r) => new Map(r.sections.flatMap((s) => s.items).map((i) => [i.key, i]));
const veiculoTotal = JSON.parse(fs.readFileSync(new URL('./fixtures/veiculototal-sucesso.json', import.meta.url), 'utf8'));
// Veículo Total sem a base de gravame, para ver o que o /gravame acrescenta.
const semBdrp = () => { const x = structuredClone(veiculoTotal); x.RESPOSTA.CODIGO = ['2', '1', '1', '1', '1', '1', '2', '2']; x.RESPOSTA.VEICULOSBDRP = { DESCRICAORETORNO: 'NAO FOI POSSIVEL LOCALIZAR', RETORNO: {} }; return x; };
const COM_RECALL = (() => { const c = structuredClone(base); c.RESPOSTA.VEICULOSBDRP.RETORNO.RECALL = 'POSSUI RECALL'; return c; })();
const COM_FURTO = (() => { const c = structuredClone(base); c.RESPOSTA.VEICULOSBDRP.RETORNO.RESFURTO = 'CONSTA FURTO'; return c; })();
const run = async (routes, sources, baseResp = base) => {
  resetCredifyTokenCache();
  const out = await new CredifyVehicleProvider(opts({ '/debitosrestricoesproprietarios': baseResp, ...routes })).queryByPlate('AAA0000', { productId: 'BASIC', sources });
  return items(buildReportV2(out.raw));
};

test('documentação: gravame baixado (lista GRAVAMES) não vira restrição ativa e mostra o histórico', () => {
  const m = items(buildReportV2({ placa: 'ABC1234', idConsulta: '467', data: semBdrp(), gravame: { data: DOC['/gravame example1'] } }));
  assert.equal(m.get('RESTRICAOFINAN').state, 'CLEAR');
  assert.match(m.get('GR_SITUACAO').value, /baixado/i);
  assert.match(m.get('GR_DETALHES').value, /contrato nº 1111111/);
});

test('documentação: "ESTE VEICULO NÃO POSSUI GRAVAME" é veículo sem gravame', () => {
  const m = items(buildReportV2({ placa: 'ABC1234', idConsulta: '467', data: semBdrp(), gravame: { data: DOC['/gravame example2'] } }));
  assert.equal(m.get('RESTRICAOFINAN').state, 'CLEAR');
  assert.match(m.get('GR_SITUACAO').value, /Sem gravame/);
});

test('documentação: sinistro com indício (1) alerta; sem indício (0) fica limpo', async () => {
  const com = await run({ '/indiciosinistro': DOC['/indiciosinistro sucesso'] }, ['SINISTRO']);
  assert.equal(com.get('VT_SINISTRO').state, 'ALERT');
  const sem = await run({ '/indiciosinistro': DOC['/indiciosinistro sucessoSemDados'] }, ['SINISTRO']);
  assert.equal(sem.get('VT_SINISTRO').state, 'CLEAR');
});

test('documentação: leilão com registro alerta; "não apresentado na base" é limpo', async () => {
  const com = await run({ '/leilaoconjugado': DOC['/leilaoconjugado sucesso'] }, ['AUCTION']);
  assert.equal((com.get('AU_LEILAO') ?? com.get('VT_LEILAO')).state, 'ALERT');
  const sem = await run({ '/leilaoconjugado': DOC['/leilaoconjugado sucessoSemDados'] }, ['AUCTION']);
  assert.equal((sem.get('AU_LEILAO') ?? sem.get('VT_LEILAO')).state, 'CLEAR');
});

test('documentação: recall (exemplo vem com RECALL dentro de CONSULTA) alerta quando o cadastro indica recall; sem veículo localizado não alerta', async () => {
  const com = await run({ '/recall': DOC['/recall sucesso'] }, ['RECALL'], COM_RECALL);
  assert.equal(com.get('VT_RECALL').state, 'ALERT');
  const sem = await run({ '/recall': DOC['/recall sucessoSemDados'] }, ['RECALL'], COM_RECALL);
  assert.notEqual(sem.get('VT_RECALL').state, 'ALERT');
});

test('documentação: multas do RENAINF com débito mostram descrição, local, vencimento e situação; sem débito é limpo', async () => {
  const com = await run({ '/renainf': DOC['/renainf Codigo 1 - Veiculo com Débitos'] }, ['RENAINF']);
  const m = com.get('RN_MULTAS');
  assert.equal(m.state, 'ALERT');
  assert.match(JSON.stringify(m.table.rows), /Descrição do débito.*Local: Rua Exemplo, 123.*31\/12\/2024.*Em aberto/);
  const sem = await run({ '/renainf': DOC['/renainf Codigo 1 - Veiculo sem Débitos'] }, ['RENAINF']);
  assert.equal(sem.get('RN_MULTAS').state, 'CLEAR');
});

test('valor da multa: vírgula é sempre reais; sem vírgula, o código de barras do boleto decide entre reais e centavos', () => {
  // boleto de banco (44 dígitos): valor nas posições 10 a 19, em centavos — R$ 195,23
  const banco = `0019${'9'}${'1234'}${'0000019523'}${'0'.repeat(25)}`.slice(0, 44);
  assert.equal(banco.length, 44);
  assert.equal(boletoCents({ CODIGO_BARRAS: banco }), 19523);
  assert.equal(fineCents({ TOTAL: '19523', CODIGO_BARRAS: banco }, 'TOTAL'), 19523, 'centavos confirmados pelo boleto');
  assert.equal(fineCents({ TOTAL: '195', CODIGO_BARRAS: banco }, 'TOTAL'), 19500, 'não bate com o boleto: mantém reais');
  assert.equal(fineCents({ TOTAL: '195,23', CODIGO_BARRAS: banco }, 'TOTAL'), 19523);
  assert.equal(fineCents({ TOTAL: '195.23' }, 'TOTAL'), 19523);
  assert.equal(fineCents({ TOTAL: '10000' }, 'TOTAL'), 1000000, 'sem boleto: mantém a leitura em reais');
  // linha digitável de banco (47 dígitos): os 10 últimos são o valor
  assert.equal(boletoCents({ LINHA_DIGITAVEL: `${'1'.repeat(37)}0000019523` }), 19523);
  // arrecadação (44 dígitos, começa com 8, 3º dígito 6): valor nas posições 5 a 15
  assert.equal(boletoCents({ CODIGO_BARRAS: `86${'6'}0${'00000019523'}${'0'.repeat(29)}`.slice(0, 44) }), 19523);
  assert.equal(boletoCents({ CODIGO_BARRAS: '123' }), 0);
});

// Exemplos do portal novo da Credify (docs.credify.com.br)
test('portal novo: recall com POSSUI_RECALL e vários REGISTRO_n mostra todas as campanhas', async () => {
  const m = await run({ '/recall': DOC['/recall novo portal'] }, ['RECALL'], COM_RECALL);
  assert.equal(m.get('VT_RECALL').state, 'ALERT');
  const d = m.get('VT_RECALL_DETALHES').value;
  assert.match(d, /COMPONENTE DO SISTEMA DE FREIOS/);
  assert.match(d, /COMPONENTE DO SISTEMA ELETRICO/);
  assert.match(d, /MONTADORA EXEMPLO LTDA/);
});

test('portal novo: roubo e furto mostra todas as ocorrências (alerta, encontrado, devolvido)', async () => {
  const m = await run({ '/historicoroubofurto': DOC['/historicoroubofurto novo portal'] }, ['THEFT'], COM_FURTO);
  const d = m.get('VT_ROUBOFURTO_DETALHES').value;
  for (const t of ['ALERTA DE ROUBO/FURTO', 'ENCONTRADO', 'DEVOLVIDO']) assert.match(d, new RegExp(t));
});

test('portal novo: RENAJUD com bloqueio ativo mostra tribunal, vara, processo e data', () => {
  const m = items(buildReportV2({ placa: 'ABC1234', idConsulta: '467', data: semBdrp(), renajud: { data: DOC['/renajud novo portal'] } }));
  assert.equal(m.get('RESRENAJUD').state, 'ALERT');
  const d = m.get('RJ_DETALHES').value;
  assert.match(d, /TRIBUNAL DE JUSTICA DE SAO PAULO/);
  assert.match(d, /1ª VARA CIVEL DE SAO PAULO/);
  assert.match(d, /0001234-56\.2023\.8\.26\.0100/);
  assert.match(d, /15\/03\/2023/);
});

test('portal novo: leilão mostra data, lote, leiloeiro e comitente', async () => {
  const m = await run({ '/leilaoconjugado': DOC['/leilaoconjugado novo portal'] }, ['AUCTION']);
  assert.equal(m.get('VT_LEILAO').state, 'ALERT');
  assert.match(JSON.stringify(m.get('VT_LEILAO_DETALHES').table.rows), /02\/10\/2024.*2915.*DETRAN SP DNUC/);
});

test('texto do gravame ativo não termina com ponto duplicado quando o banco termina em ponto (S.A.)', () => {
  const raw = semBdrp();
  raw.RESPOSTA.VEICULOSBDRP = { DESCRICAORETORNO: 'SUCESSO', RETORNO: { RESTRICAOFINAN: 'ALIENACAO FIDUCIARIA', RESTRICAONOMEAGENTE: 'BANCO EXEMPLO S.A.', NUMEROCONTRATOFINANCEIRA: '1', RESTRICAODATAINCLUSAO: '10/03/2023', CGCFINANCEIRA: '00000000000191' } };
  raw.RESPOSTA.CODIGO = ['2', '1', '1', '1', '1', '1', '1', '2'];
  const m = items(buildReportV2({ placa: 'ABC1234', idConsulta: '467', data: raw }));
  const t = String(m.get('GR_SITUACAO')?.value ?? '');
  assert.match(t, /BANCO EXEMPLO S\.A\.$/);
  assert.doesNotMatch(t, /\.\./);
});
