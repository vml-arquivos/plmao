import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const web = (p) => readFile(new URL(`../../web/src/${p}`, import.meta.url), 'utf8');

test('cadastro de cliente e de empresa: CNPJ e CEP preenchem sozinhos', async () => {
  const [customers, companies, lookups] = await Promise.all([web('admin/pages/Customers.tsx'), web('admin/pages/Companies.tsx'), web('admin/lookups.tsx')]);
  for (const src of [customers, companies]) {
    assert.match(src, /useCepAutofill\(f\.zip/, 'CEP');
    assert.match(src, /useCnpjAutofill\(/, 'CNPJ');
    assert.match(src, /LookupNote/, 'aviso do que foi preenchido');
  }
  assert.match(lookups, /\/admin\/cep\//); assert.match(lookups, /\/admin\/cnpj\//);
  assert.match(lookups, /cnpjLooksValid/, 'só busca CNPJ que pode ser real');
  assert.match(customers, /p\.type === 'PARTICULAR' \? 'EMPRESA'/, 'CNPJ muda o tipo para empresa');
});

test('ficha do cliente tem Pacote e acessos (loja e recursos) e Nova loja escolhe cliente ou cadastra novo', async () => {
  const [customers, access, stores] = await Promise.all([web('admin/pages/Customers.tsx'), web('admin/pages/CustomerAccess.tsx'), web('admin/pages/Dealerships.tsx')]);
  assert.match(customers, /<CustomerAccessCard customerId=\{c\.id\}/);
  assert.match(access, /\/store`/); assert.match(access, /\/store\/disable`/); assert.match(access, /\/access`/);
  assert.match(stores, /CustomerPicker/, 'escolher cliente já cadastrado');
  assert.match(stores, /Cadastrar novo cliente/); assert.match(stores, /onCreated/);
  assert.match(stores, /Preencher com uma empresa já cadastrada/);
  assert.match(stores, /\/admin\/customers\/\$\{owner\.id\}\/store/, 'a loja nasce pelo cadastro do cliente');
});

test('menu do cliente esconde o recurso desligado e mantém tudo quando não há informação', async () => {
  const layouts = await web('client/layouts.tsx');
  assert.match(layouts, /feature: 'GARAGE'/); assert.match(layouts, /feature: 'WATCHES'/);
  assert.match(layouts, /features\?\.\[i\.feature\] !== false/);
  assert.match(layouts, /sectionsFor\(profile, me\.features\)/);
});
