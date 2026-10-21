#!/usr/bin/env node
/**
 * Gera o seed compacto do catálogo de frota (Senatran) a partir do CSV público.
 * Uso: node scripts/build-senatran-seed.mjs <frota.csv> <saida.json.gz> <AAAA-MM>
 * Cabeçalho esperado: marca_modelo_original;ano_fabricacao_original;quantidade_veiculos_frota_<mês>_<ano>
 * Nada é interpretado: o nome fica como o Senatran publicou. Ano não numérico vira 0 ("sem ano informado").
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const [, , input, output, snapshot] = process.argv;
if (!input || !output || !/^\d{4}-\d{2}$/.test(snapshot ?? '')) {
  console.error('Uso: node scripts/build-senatran-seed.mjs <frota.csv> <saida.json.gz> <AAAA-MM>');
  process.exit(1);
}
const lines = readFileSync(input, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
const header = lines.shift().split(';');
if (header.length !== 3 || !/^marca_modelo/.test(header[0])) throw new Error('Cabeçalho inesperado: ' + header.join(';'));
const byName = new Map();
let total = 0;
for (const line of lines) {
  const i1 = line.lastIndexOf(';'); const i0 = line.lastIndexOf(';', i1 - 1);
  const name = line.slice(0, i0).trim(); const yearRaw = line.slice(i0 + 1, i1).trim(); const qty = Number(line.slice(i1 + 1));
  if (!name || !Number.isInteger(qty) || qty < 0) throw new Error('Linha inválida: ' + line);
  const y = /^\d{4}$/.test(yearRaw) && Number(yearRaw) >= 1900 && Number(yearRaw) <= 2100 ? Number(yearRaw) : 0;
  const m = byName.get(name) ?? new Map(); m.set(y, (m.get(y) ?? 0) + qty); byName.set(name, m); total += qty;
}
const rows = [...byName.entries()].map(([n, m]) => [n, [...m.entries()].sort((a, b) => a[0] - b[0])]);
rows.sort((a, b) => a[0] < b[0] ? -1 : 1);
const payload = { snapshot, total, rows };
writeFileSync(output, gzipSync(Buffer.from(JSON.stringify(payload)), { level: 9 }));
console.log(`nomes=${rows.length} frota=${total} -> ${output}`);
