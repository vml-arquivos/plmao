import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { useTestEnv } from './helpers/db.mjs';

useTestEnv();
const { buildReportV2 } = await import('../dist/report/normalizeV2.js');
const { leilaoLevel, leilaoAnalyses } = await import('../dist/report/analiseLeilao.js');
const sample = JSON.parse(fs.readFileSync(new URL('./fixtures/exemplo-retorno-provedor.json', import.meta.url), 'utf8'));

const reg = (extra = {}) => ({ data: { LEILAOCONJUGADO: { DESCRICAORETORNO: 'SUCESSO', REGISTRO_1: { DATA_LEILAO: '2023-05-10', LEILOEIRO: 'Leiloeiro Teste', LOTE: '12', ...extra } } } });
const analyses = (leilao) => {
  const r = buildReportV2({ ...structuredClone(sample), leilao });
  return new Map(r.sections.flatMap((s) => s.items).filter((i) => i.key.startsWith('AN_')).map((i) => [i.key, i]));
};

describe('análises de leilão (nível, desvalorização, CSV e seguro)', () => {
  it('sem leilão: nível muito baixo e seguro sem impedimento, sem desvalorização nem CSV', () => {
    const a = analyses({ notFound: true });
    assert.match(a.get('AN_SCORE_LEILAO').value, /^Muito baixo/);
    assert.equal(a.get('AN_SCORE_LEILAO').state, 'CLEAR');
    assert.equal(a.get('AN_SEGURO').state, 'CLEAR');
    assert.ok(!a.has('AN_DESVALORIZACAO') && !a.has('AN_CSV_INMETRO'));
  });

  it('um registro simples: razoável, com desvalorização, CSV e aviso de seguro', () => {
    const a = analyses(reg());
    assert.match(a.get('AN_SCORE_LEILAO').value, /^Razoável/);
    assert.match(a.get('AN_DESVALORIZACAO').value, /abaixo da tabela FIPE/);
    assert.match(a.get('AN_CSV_INMETRO').value, /Inmetro/);
    assert.match(a.get('AN_SEGURO').value, /recusa/);
  });

  it('registro com dano informado ou vários registros: alto', () => {
    assert.match(analyses(reg({ CONDICAO: 'SUCATA' })).get('AN_SCORE_LEILAO').value, /^Alto/);
    const dois = { data: { LEILAOCONJUGADO: { DESCRICAORETORNO: 'SUCESSO', REGISTRO_1: { DATA_LEILAO: '2022-01-10', LEILOEIRO: 'A', LOTE: '1' }, REGISTRO_2: { DATA_LEILAO: '2023-02-10', LEILOEIRO: 'B', LOTE: '2' } } } };
    assert.match(analyses(dois).get('AN_SCORE_LEILAO').value, /^Alto — 2 registros/);
  });

  it('sem percentual inventado e sem nota de terceiros', () => {
    for (const leilao of [reg(), reg({ CONDICAO: 'SUCATA' })]) {
      for (const [, i] of analyses(leilao)) assert.doesNotMatch(String(i.value), /\d+\s?%|\d+\s?a\s?\d+\s?%/);
    }
  });

  it('níveis pela regra: sinistro sem leilão é baixo; leilão com sinistro é alto; sem leilão consultado não calcula nada', () => {
    assert.equal(leilaoLevel({ state: 'CLEAR' }, { state: 'ALERT' }).level, 'Baixo');
    assert.equal(leilaoLevel({ state: 'ALERT', table: { columns: ['Data'], rows: [['01/01/2023']] } }, { state: 'ALERT' }).level, 'Alto');
    assert.equal(leilaoLevel({ state: 'CLEAR' }, { state: 'CLEAR' }).level, 'Muito baixo');
    assert.equal(leilaoLevel(undefined, { state: 'ALERT' }), null);
    assert.equal(leilaoAnalyses({ state: 'NOT_PROVIDED' }, undefined).size, 0);
  });

  it('sem leilão consultado, o relatório não traz as análises', () => {
    const r = buildReportV2(structuredClone(sample));
    assert.ok(!r.sections.flatMap((s) => s.items).some((i) => i.key.startsWith('AN_') && i.state !== 'NOT_PROVIDED'));
  });
});

