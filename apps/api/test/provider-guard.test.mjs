import assert from 'node:assert/strict';
import test from 'node:test';
import { useTestEnv } from './helpers/db.mjs';

useTestEnv();
const { runExclusive, resetExclusiveLocks, exclusiveRunning, CallBudget } = await import('../dist/lib/providerGuard.js');

test('runExclusive: a mesma chave não roda duas vezes ao mesmo tempo e a trava é solta ao terminar', async () => {
  resetExclusiveLocks();
  let release; let calls = 0;
  const gate = new Promise((r) => { release = r; });
  const first = runExclusive('k', async () => { calls += 1; await gate; return 'ok'; });
  await assert.rejects(() => runExclusive('k', async () => { calls += 1; return 'dup'; }), (e) => e.code === 'QUERY_IN_PROGRESS' && e.http === 409);
  assert.equal(await runExclusive('outra', async () => 'livre'), 'livre');
  release();
  assert.equal(await first, 'ok');
  assert.equal(calls, 1);
  assert.equal(exclusiveRunning(), 0);
  assert.equal(await runExclusive('k', async () => 'de novo'), 'de novo');
});

test('runExclusive: solta a trava também quando a tarefa falha', async () => {
  resetExclusiveLocks();
  await assert.rejects(() => runExclusive('f', async () => { throw new Error('x'); }), /x/);
  assert.equal(exclusiveRunning(), 0);
});

test('runExclusive: trava vencida não bloqueia para sempre e não solta a trava da execução nova', async () => {
  resetExclusiveLocks();
  let t = 0; const now = () => t;
  let releaseOld; const gate = new Promise((r) => { releaseOld = r; });
  const old = runExclusive('s', async () => { await gate; }, 1000, now);
  t = 5000;
  let releaseNew; const gate2 = new Promise((r) => { releaseNew = r; });
  const fresh = runExclusive('s', async () => { await gate2; }, 1000, now);
  releaseOld(); await old;
  assert.equal(exclusiveRunning(), 1, 'a trava da execução nova continua');
  await assert.rejects(() => runExclusive('s', async () => 1, 1000, now), (e) => e.code === 'QUERY_IN_PROGRESS');
  releaseNew(); await fresh;
  assert.equal(exclusiveRunning(), 0);
});

test('CallBudget: respeita o teto por hora e por dia e libera com o passar do tempo; 0 = sem limite', () => {
  let t = 1_000_000; const b = new CallBudget(() => t);
  b.take({ perHour: 2, perDay: 3 }); b.take({ perHour: 2, perDay: 3 });
  assert.throws(() => b.take({ perHour: 2, perDay: 3 }), (e) => e.code === 'PROVIDER_BUDGET_EXCEEDED' && /última hora/.test(e.detail));
  assert.deepEqual(b.usage(), { lastHour: 2, lastDay: 2 });
  t += 3_600_001;
  b.take({ perHour: 2, perDay: 3 });
  assert.throws(() => b.take({ perHour: 2, perDay: 3 }), (e) => e.code === 'PROVIDER_BUDGET_EXCEEDED' && /24 horas/.test(e.detail));
  t += 86_400_001;
  assert.deepEqual(b.usage(), { lastHour: 0, lastDay: 0 });
  for (let i = 0; i < 50; i += 1) b.take({ perHour: 0, perDay: 0 });
  b.reset();
  assert.equal(b.usage().lastDay, 0);
});
