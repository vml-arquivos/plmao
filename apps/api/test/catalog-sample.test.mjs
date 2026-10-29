import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, useTestEnv } from './helpers/db.mjs';
import { startServer } from './helpers/server.mjs';

useTestEnv();

describe('modelo de relatório e detalhes das consultas (público)', integration, () => {
  let server, pool;
  before(async () => { ({ pool } = await loadCore()); server = await startServer(); });
  after(async () => { await server.stop(); await pool.end(); });

  it('lista, por consulta, os itens que o cliente recebe, sem dados de proprietário nem internos', async () => {
    const r = await server.request('/api/catalog/details');
    assert.equal(r.status, 200);
    const { products } = await r.json();
    const ids = products.map((p) => p.id);
    assert.ok(ids.includes('COMPLETE') && ids.includes('BASIC'));
    const labels = (id) => products.find((p) => p.id === id).sections.flatMap((s) => s.items);
    assert.ok(labels('COMPLETE').length > labels('BASIC').length, 'a Completa traz mais itens que a Básica');
    assert.ok(labels('COMPLETE').includes('Indício de sinistro'));
    assert.ok(!labels('BASIC').includes('Indício de sinistro'));
    for (const id of ids) {
      const all = labels(id).join('|');
      assert.doesNotMatch(all, /Nome do proprietário|CPF|Chave de retorno|Controle interno/i);
    }
  });

  it('serve o PDF de modelo com marca de exemplo, sem exigir login', async () => {
    const r = await server.request('/api/catalog/COMPLETE/modelo.pdf');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') ?? '', /application\/pdf/);
    const buf = Buffer.from(await r.arrayBuffer());
    assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.ok(buf.length > 10000);
    assert.equal((await server.request('/api/catalog/NAO_EXISTE/modelo.pdf')).status, 404);
  });
});
