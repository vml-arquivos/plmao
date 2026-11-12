import assert from 'node:assert/strict';
import fs from 'node:fs';
import { before, after, describe, it, test } from 'node:test';
import { integration, loadCore, useTestEnv } from './helpers/db.mjs';

useTestEnv();
const { CredifyVehicleProvider, resetCredifyTokenCache } = await import('../dist/providers/credifyProvider.js');
const { PRODUCT_CONTRACT, SOURCE_PATHS, BASE_PATH, allowedPaths, guaranteedPaths, contractFor, enforcedSources } = await import('../dist/lib/productContract.js');
const { sourcesForProduct, setProductSources } = await import('../dist/lib/dataSources.js');
const { Spend } = await import('../dist/report/layers.js');

const sample = JSON.parse(fs.readFileSync(new URL('./fixtures/exemplo-retorno-provedor.json', import.meta.url), 'utf8'));
const jwt = () => `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64url')}.s`;
const consulta = (id) => ({ CODIGORESPOSTA: '1', DATAHORA: '01/01/2026 10:00:00', LOGON: '1', IDCONSULTA: id });
const ok = (id, resposta) => ({ CONSULTA: consulta(id), RESPOSTA: { CODIGO: '1', ...resposta } });
const absent = (id, text) => ({ CONSULTA: consulta(id), RESPOSTA: { CODIGO: '2', DESCRICAORETORNO: text } });
const withFlags = (flags) => { const c = structuredClone(sample); Object.assign(c.RESPOSTA.VEICULOSBDRP.RETORNO, flags); return c; };

/** Todas as respostas possíveis da Credify; chamada fora da lista falha o teste. Rota pode ser uma lista (uma resposta por tentativa). */
function fakeFetch(overrides = {}) {
  const routes = {
    [BASE_PATH]: sample,
    '/indiciosinistro': ok('450', { DESCRICAORETORNO: 'Sucesso', INDICIODESINISTRO: '0' }),
    '/veicularbnacionalonline': ok('369', { DESCRICAORETORNO: 'SUCESSO', PLACA: 'AAA0000' }),
    '/leilaoconjugado': absent('448', 'O VEICULO NAO FOI APRESENTADO NA BASE DE LEILAO.'),
    '/historicoproprietario': ok('458', { DESCRICAORETORNO: 'SUCESSO', QUANTIDADE: '2' }),
    '/precificadorfipe': ok('454', { DESCRICAORETORNO: 'SUCESSO', PRECO: '50000' }),
    '/renainf': ok('536', { DESCRICAORETORNO: 'SUCESSO' }),
    '/veiculoproprietarioplaca': ok('514', { DESCRICAORETORNO: 'SUCESSO', NOME_PROPRIETARIO: 'FULANO DE TAL' }),
    '/historicoroubofurto': ok('456', { DESCRICAORETORNO: 'SUCESSO', OCORRENCIA: 'FURTO' }),
    '/recall': ok('452', { DESCRICAORETORNO: 'SUCESSO', MONTADORA: 'VW' }),
    '/gravame': ok('533', { GRAVAME: { PLACA: 'AAA0000', GRAVAMES: { REGISTRO_1: { NUMERO_RESTRICAO: '1' } } } }),
    '/renajud': ok('483', { RENAJUD: { REGISTRO_1: { NUMERODOPROCESSO: '1' } } }),
    ...overrides
  };
  const calls = [];
  const fn = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === '/auth') return new Response(JSON.stringify({ Success: true, Dados: jwt() }), { status: 200 });
    calls.push(path);
    const h = routes[path];
    if (!h) throw new Error(`chamada inesperada: ${path}`);
    if (typeof h === 'function') return h(calls.filter((c) => c === path).length);
    if (h.status && h.status >= 400) return new Response('{}', { status: h.status });
    return new Response(JSON.stringify(h), { status: 200 });
  };
  fn.paid = () => calls;
  fn.count = (p) => calls.filter((c) => c === p).length;
  return fn;
}
const opts = (fetchImpl) => ({ baseUrl: 'https://api.credify.test', clientId: 'cid', clientSecret: 'sec', method: 'post', timeoutMs: 3000, fetchImpl });
const run = (f, id, sources = sourcesForProduct(id)) => new CredifyVehicleProvider(opts(f)).queryByPlate('AAA0000', { productId: id, sources });

const FLAGGED = withFlags({ RECALL: 'POSSUI RECALL', RESFURTO: 'CONSTA OCORRENCIA', RESTRICAOFINAN: 'ALIENACAO FIDUCIARIA', RESJUDICIAL: 'CONSTA RESTRICAO JUDICIAL' });
const sorted = (l) => [...l].sort();

test('contrato: as seis consultas de linha fixa estão declaradas com as APIs combinadas', () => {
  assert.deepEqual(Object.keys(PRODUCT_CONTRACT).sort(), ['AUCTION', 'BASIC', 'CADASTRAL', 'COMPLETE', 'LIEN', 'PREMIUM']);
  assert.equal(PRODUCT_CONTRACT.CADASTRAL.sources, null);
  assert.deepEqual([...PRODUCT_CONTRACT.AUCTION.sources], ['NATIONAL', 'AUCTION']);
  assert.deepEqual([...PRODUCT_CONTRACT.COMPLETE.sources], ['SINISTRO', 'NATIONAL', 'THEFT', 'RECALL', 'AUCTION', 'FIPE', 'OWNER_PLATE']);
  assert.ok(!PRODUCT_CONTRACT.COMPLETE.sources.includes('GRAVAME') && !PRODUCT_CONTRACT.COMPLETE.sources.includes('OWNERS'));
  assert.ok(PRODUCT_CONTRACT.BASIC.sources.includes('GRAVAME') && PRODUCT_CONTRACT.BASIC.sources.includes('RENAINF') && !PRODUCT_CONTRACT.BASIC.sources.includes('OWNERS'));
  assert.ok(PRODUCT_CONTRACT.PREMIUM.sources.includes('OWNERS'));
  for (const c of Object.values(PRODUCT_CONTRACT)) for (const s of c.sources ?? []) assert.ok(SOURCE_PATHS[s], `fonte ${s} sem caminho`);
});

test('o painel não muda as APIs: mesmo com outro valor guardado, vale o contrato', () => {
  setProductSources(new Map([['BASIC', ['SINISTRO']], ['COMPLETE', ['TOTAL']], ['CADASTRAL', ['AUCTION']], ['MEU_PRODUTO', ['SINISTRO']]]));
  try {
    assert.deepEqual(sourcesForProduct('BASIC'), [...PRODUCT_CONTRACT.BASIC.sources]);
    assert.deepEqual(sourcesForProduct('COMPLETE'), [...PRODUCT_CONTRACT.COMPLETE.sources]);
    assert.equal(sourcesForProduct('CADASTRAL'), null);
    assert.deepEqual(sourcesForProduct('MEU_PRODUTO'), ['SINISTRO'], 'produto criado no painel continua livre');
  } finally { setProductSources(new Map()); }
  assert.equal(enforcedSources('BASIC', ['SINISTRO']).drift, true);
  assert.equal(enforcedSources('BASIC', [...PRODUCT_CONTRACT.BASIC.sources]).drift, false);
  assert.equal(contractFor('x'), undefined);
});

for (const id of ['CADASTRAL', 'LIEN', 'AUCTION', 'BASIC', 'COMPLETE', 'PREMIUM']) {
  test(`${id}, placa sem ocorrência: compra exatamente as APIs do contrato, nenhuma a mais`, async () => {
    resetCredifyTokenCache();
    const f = fakeFetch();
    await run(f, id);
    assert.deepEqual(sorted(f.paid()), sorted(guaranteedPaths(id)));
    for (const p of f.paid()) assert.ok(allowedPaths(id).has(p), `${id} chamou ${p} fora do contrato`);
    assert.ok(!f.paid().includes('/veiculototal'));
  });
}

test('Completa e Premium, placa com ocorrências: só soma o que o contrato permite (Completa nunca compra gravame/Renajud)', async () => {
  for (const [id, extra] of [['COMPLETE', ['/recall', '/historicoroubofurto']], ['PREMIUM', ['/recall', '/historicoroubofurto', '/gravame', '/renajud']], ['BASIC', ['/recall', '/historicoroubofurto', '/gravame', '/renajud']]]) {
    resetCredifyTokenCache();
    const f = fakeFetch({ [BASE_PATH]: FLAGGED });
    await run(f, id);
    assert.deepEqual(sorted(f.paid()), sorted([...guaranteedPaths(id), ...extra]), id);
    for (const p of f.paid()) assert.ok(allowedPaths(id).has(p), `${id} chamou ${p}`);
  }
});

test('Cadastral só compra a base e Gravame só base + gravame, mesmo com ocorrências no cadastro', async () => {
  resetCredifyTokenCache();
  const c = fakeFetch({ [BASE_PATH]: FLAGGED });
  await run(c, 'CADASTRAL');
  assert.deepEqual(c.paid(), [BASE_PATH]);
  resetCredifyTokenCache();
  const l = fakeFetch({ [BASE_PATH]: FLAGGED });
  await run(l, 'LIEN');
  assert.deepEqual(sorted(l.paid()), sorted([BASE_PATH, '/gravame']));
});

test('cerca do contrato: chamada fora da lista do produto é barrada antes de sair', () => {
  const spend = new Spend(undefined, undefined);
  spend.fence(allowedPaths('COMPLETE'));
  spend.assertAllowed('/indiciosinistro');
  for (const p of ['/veiculototal', '/gravame', '/renajud', '/historicoproprietario', '/renainf']) {
    assert.throws(() => spend.assertAllowed(p), (e) => e.code === 'PRODUCT_CONTRACT_VIOLATION', p);
  }
  const free = new Spend(undefined, undefined);
  free.assertAllowed('/qualquer');
});

describe('base obrigatória que não responde: não entrega relatório incompleto', () => {
  const BAD = { status: 503 };

  for (const [id, path, label] of [['COMPLETE', '/precificadorfipe', 'FIPE'], ['COMPLETE', '/veiculoproprietarioplaca', 'proprietário'], ['COMPLETE', '/indiciosinistro', 'sinistro'], ['COMPLETE', '/leilaoconjugado', 'leilão'], ['BASIC', '/renainf', 'multas'], ['PREMIUM', '/historicoproprietario', 'histórico de proprietários'], ['AUCTION', '/leilaoconjugado', 'leilão']]) {
    it(`${id}: ${label} indisponível (duas tentativas) derruba a consulta para estornar`, async () => {
      resetCredifyTokenCache();
      const f = fakeFetch({ [path]: BAD });
      await assert.rejects(run(f, id), (e) => e.code === 'DATA_PROVIDER_INCOMPLETE', `${id} ${path}`);
      assert.equal(f.count(path), 2, 'uma segunda tentativa para indisponibilidade');
    });
  }

  it('falha momentânea que se recupera na segunda tentativa entrega o relatório completo', async () => {
    resetCredifyTokenCache();
    const f = fakeFetch({ '/precificadorfipe': (n) => (n === 1 ? new Response('{}', { status: 503 }) : new Response(JSON.stringify(ok('454', { DESCRICAORETORNO: 'SUCESSO', PRECO: '50000' })), { status: 200 })) });
    const out = await run(f, 'COMPLETE');
    assert.equal(f.count('/precificadorfipe'), 2);
    assert.equal(out.raw.parcial, undefined, 'sem marca de parcial');
  });

  it('sem resposta (timeout) não é repetido: pode ter sido cobrado; a consulta cai e estorna', async () => {
    resetCredifyTokenCache();
    const f = fakeFetch({ '/precificadorfipe': () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }); } });
    await assert.rejects(run(f, 'COMPLETE'), (e) => e.code === 'DATA_PROVIDER_INCOMPLETE');
    assert.equal(f.count('/precificadorfipe'), 1);
  });

  it('"não encontrado" é resposta válida (nada consta): entrega normalmente', async () => {
    resetCredifyTokenCache();
    const f = fakeFetch({ '/veiculoproprietarioplaca': { status: 404 }, '/precificadorfipe': { status: 404 } });
    const out = await run(f, 'COMPLETE');
    assert.equal(out.raw.parcial, undefined);
  });

  it('gravame que o cadastro pede e falha derruba a Avançada e a Premium; na Completa nem é consultado', async () => {
    for (const id of ['BASIC', 'PREMIUM']) {
      resetCredifyTokenCache();
      const f = fakeFetch({ [BASE_PATH]: withFlags({ RESTRICAOFINAN: 'ALIENACAO FIDUCIARIA' }), '/gravame': BAD });
      await assert.rejects(run(f, id), (e) => String(e.code).startsWith('DATA_PROVIDER_'), id);
    }
    resetCredifyTokenCache();
    const f = fakeFetch({ [BASE_PATH]: withFlags({ RESTRICAOFINAN: 'ALIENACAO FIDUCIARIA' }), '/gravame': BAD });
    await run(f, 'COMPLETE');
    assert.ok(!f.paid().includes('/gravame'));
  });

  it('o Gravame (produto) continua derrubando quando o /gravame falha', async () => {
    resetCredifyTokenCache();
    const f = fakeFetch({ '/gravame': BAD });
    await assert.rejects(run(f, 'LIEN'), (e) => String(e.code).startsWith('DATA_PROVIDER_'));
  });

  it('produto criado no painel (fora do contrato) mantém o comportamento antigo: entrega com a base faltando marcada como parcial', async () => {
    resetCredifyTokenCache();
    const f = fakeFetch({ '/precificadorfipe': BAD });
    const out = await run(f, 'MEU_PRODUTO', ['SINISTRO', 'FIPE']);
    assert.equal(out.raw.parcial, true);
  });
});

describe('banco migrado = contrato', integration, () => {
  let pool;
  before(async () => { ({ pool } = await loadCore()); });
  after(async () => { await pool.end(); });

  it('data_sources de cada produto de linha fixa é exatamente o do contrato', async () => {
    const rows = (await pool.query(`SELECT id,data_sources FROM query_products WHERE id = ANY($1)`, [Object.keys(PRODUCT_CONTRACT)])).rows;
    assert.equal(rows.length, 6);
    for (const r of rows) {
      const want = PRODUCT_CONTRACT[r.id].sources;
      if (want) assert.deepEqual(r.data_sources, [...want], r.id);
      else assert.ok(!r.data_sources || r.data_sources.length === 0, `${r.id} sem fontes marcadas`);
    }
  });
});
