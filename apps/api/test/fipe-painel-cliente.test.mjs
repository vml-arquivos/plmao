import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const web = (p) => readFile(new URL(`../../web/src/client/${p}`, import.meta.url), 'utf8');

test('a FIPE grátis aparece dentro da área do cliente: rota, menu, Nova consulta e Painel', async () => {
  const [app, layouts, newQuery, dashboard, fipe] = await Promise.all([web('App.tsx'), web('layouts.tsx'), web('pages/NewQuery.tsx'), web('pages/Dashboard.tsx'), web('pages/Fipe.tsx')]);
  assert.match(app, /<Route path="fipe" element=\{<Fipe inApp \/>\} \/>/, 'rota /app/fipe');
  assert.match(layouts, /to: '\/app\/fipe', label: 'FIPE grátis'/, 'item no menu da conta');
  assert.match(newQuery, /Consultar FIPE grátis/, 'cartão na Nova consulta');
  assert.match(newQuery, /\/app\/fipe/, 'o cartão leva para a FIPE dentro da conta');
  assert.match(dashboard, /to="\/app\/fipe"/, 'atalho no Painel');
  assert.match(fipe, /inApp \? '\/app\/consultar' : '\/consultar'/, 'dentro da conta o link de situação do veículo fica na área logada');
  assert.match(fipe, /quote && !inApp/, 'sem captura de lead para quem já tem conta');
});

test('a FIPE do painel não vira compra: a Nova consulta paga continua só com os produtos pagos', async () => {
  const newQuery = await web('pages/NewQuery.tsx');
  assert.match(newQuery, /products\.filter\(\(p\) => !p\.isFree\)|filter\(\(p\) => !p\.isFree\)/, 'produtos grátis seguem fora da lista paga');
});
