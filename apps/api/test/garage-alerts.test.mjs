import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import test from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';

useTestEnv();
let pool;
const { runGarageAlerts, stageOf } = await import('../dist/lib/garageAlerts.js');

const day = (offset, base = new Date('2026-11-01T12:00:00Z')) => new Date(base.getTime() + offset * 86_400_000).toISOString().slice(0, 10);

test('etapas: vencido, perto de vencer e longe', () => {
  const today = '2026-11-01'; const soon = '2026-11-08';
  assert.equal(stageOf({ due_date: '2026-10-31', due_km: null, vehicle_km: null }, today, soon), 'OVERDUE');
  assert.equal(stageOf({ due_date: '2026-11-05', due_km: null, vehicle_km: null }, today, soon), 'SOON');
  assert.equal(stageOf({ due_date: '2026-12-30', due_km: null, vehicle_km: null }, today, soon), null);
  assert.equal(stageOf({ due_date: null, due_km: 50000, vehicle_km: 49800 }, today, soon), 'SOON');
  assert.equal(stageOf({ due_date: null, due_km: 50000, vehicle_km: 50100 }, today, soon), 'OVERDUE');
  assert.equal(stageOf({ due_date: null, due_km: 50000, vehicle_km: null }, today, soon), null);
});

describe('alertas da garagem', integration, () => {
  before(async () => { ({ pool } = await loadCore()); });
  after(async () => { await pool.end(); });
  it('avisa uma vez por etapa, respeita quem desligou e quem concluiu', async () => {
  const now = new Date('2026-11-01T12:00:00Z');
  const mk = async (alerts = true) => {
    const id = randomUUID(); const email = `g-${id.slice(0, 8)}@cliente.local`;
    await pool.query(`INSERT INTO users(id,email,password_hash,name,role,garage_email_alerts) VALUES($1,$2,'x','Cliente Garagem','CLIENTE',$3)`, [id, email, alerts]);
    const v = await pool.query(`INSERT INTO saved_vehicles(user_id,plate,model_label,km) VALUES($1,$2,'Uno Mille',50000) RETURNING id`, [id, `G${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${Math.floor(Math.random() * 10)}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${Math.floor(Math.random() * 100).toString().padStart(2, '0')}`]);
    return { id, email, vehicle: v.rows[0].id };
  };
  const item = (u, title, due, extra = '') => pool.query(`INSERT INTO garage_items(user_id,vehicle_id,kind,title,due_date${extra ? ',done_at' : ''}) VALUES($1,$2,'REMINDER',$3,$4${extra ? ',now()' : ''}) RETURNING id`, [u.id, u.vehicle, title, due]).then((r) => r.rows[0].id);

  const a = await mk(); const off = await mk(false); const done = await mk();
  await item(a, 'Trocar óleo', day(3)); await item(a, 'Licenciamento', day(-2)); await item(a, 'Revisão longe', day(60));
  await item(off, 'Desligado', day(1)); await item(done, 'Já feito', day(1), 'done');

  const first = await runGarageAlerts(now);
  assert.ok(first.emails >= 1);
  const mails = await pool.query(`SELECT to_email,subject,payload FROM email_outbox WHERE related_type='GARAGE_ALERT' AND related_id=$1`, [a.id]);
  assert.equal(mails.rowCount, 1, 'um resumo só para a pessoa');
  const msg = JSON.stringify(mails.rows[0].payload);
  assert.match(msg, /Trocar óleo/); assert.match(msg, /Licenciamento/); assert.doesNotMatch(msg, /Revisão longe/);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM email_outbox WHERE related_type='GARAGE_ALERT' AND related_id = ANY($1::text[])`, [[off.id, done.id]])).rows[0].n, 0);

  const again = await runGarageAlerts(now);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM email_outbox WHERE related_type='GARAGE_ALERT' AND related_id=$1`, [a.id])).rows[0].n, 1, 'não repete o aviso');
  assert.ok(again.items >= 0);

  // Dias depois, o item que estava perto de vencer venceu: novo aviso, uma vez.
  const later = new Date('2026-11-06T12:00:00Z');
  await runGarageAlerts(later);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM email_outbox WHERE related_type='GARAGE_ALERT' AND related_id=$1`, [a.id])).rows[0].n, 2);
  await runGarageAlerts(later);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM email_outbox WHERE related_type='GARAGE_ALERT' AND related_id=$1`, [a.id])).rows[0].n, 2);
});
});
