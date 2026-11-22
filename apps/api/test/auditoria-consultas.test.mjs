import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { TEST_DATABASE_URL, integration } from './helpers/db.mjs';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../scripts/auditoria-consultas.mjs');

// Roda a auditoria sem custo (Credify de mentira): contrato de APIs, relatório e PDF de cada consulta.
test('auditoria das consultas: APIs do contrato, sem repetição, sem nome de fonte nem custo no relatório e no PDF', integration, () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'auditoria-')), 'auditoria.md');
  const r = spawnSync(process.execPath, [script, out], { env: { ...process.env, AUDIT_DATABASE_URL: TEST_DATABASE_URL }, encoding: 'utf8', timeout: 120_000 });
  const resumo = (r.stdout || '').split('\n').filter((l) => !l.startsWith('{"timestamp')).join('\n');
  assert.equal(r.status, 0, resumo || r.stderr);
  assert.ok(fs.readFileSync(out, 'utf8').includes('Nenhum problema encontrado'));
});
