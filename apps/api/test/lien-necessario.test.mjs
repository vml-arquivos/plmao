import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { useTestEnv } from './helpers/db.mjs';

useTestEnv();
const { lienDetailNeeded } = await import('../dist/lib/lienNeeded.js');
const base = JSON.parse(fs.readFileSync(new URL('./fixtures/veiculototal-sucesso.json', import.meta.url), 'utf8'));
const com = (flags) => { const c = structuredClone(base); Object.assign(c.RESPOSTA.VEICULOSBDRP.RETORNO, flags); return c; };

test('gravame só é buscado quando a base não trouxe banco, contrato, data ou CNPJ', () => {
  const completo = { RESTRICAOFINAN: 'ALIENACAO FIDUCIARIA', RESTRICAONOMEAGENTE: 'BANCO X', NUMEROCONTRATOFINANCEIRA: '1', RESTRICAODATAINCLUSAO: '10/01/2024', CGCFINANCEIRA: '60746948000112' };
  assert.equal(lienDetailNeeded(com(completo)), false, 'dados completos: não compra');
  assert.equal(lienDetailNeeded(com({ ...completo, RESTRICAONOMEAGENTE: '' })), true, 'sem banco: compra');
  assert.equal(lienDetailNeeded(com({ ...completo, NUMEROCONTRATOFINANCEIRA: [] })), true, 'sem contrato: compra');
  assert.equal(lienDetailNeeded(com({ RESTRICAOFINAN: 'NADA CONSTA' })), false, 'sem alienação: não compra');
  assert.equal(lienDetailNeeded(com({ RESTRICAOFINAN: 'GRAVAME BAIXADO' })), true, 'baixado: confere o histórico');
  assert.equal(lienDetailNeeded(com({ RESTRICAOFINAN: 'NADA CONSTA' }), true), true, 'modo "sempre": compra');
  assert.equal(lienDetailNeeded({ foo: 1 }), false, 'resposta que não é do pacote: não compra');
});
