import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, useTestEnv } from './helpers/db.mjs';

useTestEnv();

describe('migração 071: custo por consulta e piso de preço', integration, () => {
  let pool;
  before(async () => { ({ pool } = await loadCore()); });
  after(async () => { await pool.end(); });

  const CUSTOS = { CADASTRAL: 215, LIEN: 352, BASIC: 352, AUCTION: 1891, COMPLETE: 2152, PREMIUM: 3313 };

  // Outros testes da bateria mexem nos produtos no mesmo banco; por isso a migração é reexecutada aqui, numa transação desfeita.
  async function aplicar(preparar) {
    const { migrations } = await import('../dist/migrations.js');
    const mig = migrations.find((x) => x.id === '071_custos_por_consulta');
    assert.ok(mig, 'migração 071 registrada');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE query_products SET provider_cost_cents=NULL, floor_price_cents=NULL WHERE id = ANY($1::text[])`, [Object.keys(CUSTOS)]);
      if (preparar) await preparar(client);
      await mig.up(client);
      return (await client.query(`SELECT id,name,price_cents,provider_cost_cents,floor_price_cents FROM query_products WHERE id = ANY($1::text[])`, [Object.keys(CUSTOS)])).rows;
    } finally { await client.query('ROLLBACK'); client.release(); }
  }

  it('cada consulta à venda recebe o custo da Credify', async () => {
    const rows = await aplicar();
    assert.equal(rows.length, 6);
    for (const row of rows) assert.equal(Number(row.provider_cost_cents), CUSTOS[row.id], row.id);
  });

  it('os custos batem com a soma das chamadas de cada consulta (tabela do contrato)', () => {
    const base = 215; const gravame = 137; const leilao = 1676;
    assert.equal(CUSTOS.CADASTRAL, base);
    assert.equal(CUSTOS.LIEN, base + gravame);
    assert.equal(CUSTOS.BASIC, base + gravame);
    assert.equal(CUSTOS.AUCTION, base + leilao);
    assert.equal(CUSTOS.COMPLETE, base + 133 + 117 + leilao + 11);
    assert.equal(CUSTOS.PREMIUM, CUSTOS.COMPLETE + gravame + 160 + 800 + 64);
  });

  it('o preço mínimo gravado nunca passa do preço de venda e garante a margem mínima', async () => {
    const { loadPaymentSettings } = await import('../dist/pricing/settings.js');
    const { floorPriceFor, marginAtPrice } = await import('../dist/pricing/productPricing.js');
    const settings = await loadPaymentSettings();
    const rows = await aplicar();
    for (const row of rows) {
      const p = { id: row.id, name: row.name, providerCostCents: Number(row.provider_cost_cents), supplierCostCents: 0 };
      const floor = Number(row.floor_price_cents);
      assert.ok(floor > 0 && floor <= Number(row.price_cents), `${row.id}: piso ${floor} x preço ${row.price_cents}`);
      assert.equal(floor, floorPriceFor(settings, p).floorCents, row.id);
      for (const m of marginAtPrice(settings, p, floor)) {
        if (settings.enabledMethods.includes(m.method)) assert.ok(m.marginBps >= settings.minMarginBps - 5, `${row.id} ${m.method} ${m.marginBps}`);
      }
    }
  });

  it('os preços de venda não são alterados pela migração', async () => {
    const antes = Object.fromEntries((await pool.query(`SELECT id,price_cents FROM query_products WHERE id = ANY($1::text[])`, [Object.keys(CUSTOS)])).rows.map((x) => [x.id, Number(x.price_cents)]));
    const rows = await aplicar();
    for (const r of rows) assert.equal(Number(r.price_cents), antes[r.id], r.id);
  });

  it('não sobrescreve custo que o responsável já tenha informado', async () => {
    const rows = await aplicar((c) => c.query(`UPDATE query_products SET provider_cost_cents=999 WHERE id='CADASTRAL'`));
    assert.equal(Number(rows.find((r) => r.id === 'CADASTRAL').provider_cost_cents), 999);
    assert.equal(Number(rows.find((r) => r.id === 'LIEN').provider_cost_cents), 352);
  });
});
