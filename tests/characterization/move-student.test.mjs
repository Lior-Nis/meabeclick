// tests/characterization/move-student.test.mjs
//
// Moving a student from their card changes that enrollment's tutor and
// nothing else: the lesson already booked stays with its tutor, and the
// next booking goes to the new one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, login, familySession } from './harness.mjs';

const NIKOL = 1, LIOR = 2;
const HOUR = { start: '2027-03-15T10:00:00+02:00', end: '2027-03-15T11:30:00+02:00' };
const LATER = { start: '2027-03-16T10:00:00+02:00', end: '2027-03-16T11:30:00+02:00' };
const markup = (h) => h.split(/<script nonce=/)[0];

function sql(dbPath, query, ...params) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { return db.prepare(query).all(...params); } finally { db.close(); }
}
function run(dbPath, query, ...params) {
  const db = new DatabaseSync(dbPath);
  try { db.prepare(query).run(...params); } finally { db.close(); }
}
const book = (baseUrl, over = {}, headers = {}) => fetch(`${baseUrl}/api/book`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify({ name: 'דנה', subject: 'מתמטיקה', level: 'כיתה ח', phone: '0501234567',
    email: 'dana@example.com', durationMin: 90, ...HOUR, ...over }),
});
const move = (baseUrl, id, teacherId, cookie) => fetch(`${baseUrl}/api/enrollments/${id}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ teacherId }),
});

test('moving a student: the card shows the new tutor, the booked lesson keeps its own, the next goes to the new one', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    run(dbPath, `UPDATE teachers SET calendar_id = 'lior-lessons@example.com', busy_ics = 'https://127.0.0.1:1/lior.ics' WHERE id = ?`, LIOR);
    const first = await (await book(baseUrl)).json();
    const cookie = await login(baseUrl);
    const [{ id }] = sql(dbPath, `SELECT id FROM enrollments`);

    assert.equal((await move(baseUrl, id, LIOR)).status, 401);
    const moved = await move(baseUrl, id, LIOR, cookie);
    assert.equal(moved.status, 200);
    assert.deepEqual((await moved.json()).enrollment, { id, subject: 'מתמטיקה', teacherId: LIOR });

    const { students } = await (await fetch(`${baseUrl}/api/students`, { headers: { cookie } })).json();
    assert.deepEqual(students[0].enrollments, [{ id, subject: 'מתמטיקה', teacherId: LIOR }]);
    assert.match(markup(await (await fetch(`${baseUrl}/app/dashboard`, { headers: { cookie } })).text()), /מתמטיקה · ליאור/);

    const activity = await (await fetch(`${baseUrl}/api/students/${first.portal.code}/activity`, { headers: { cookie } })).json();
    assert.equal(activity.nextLesson.tutor, 'ניקול', 'the lesson already booked is still Nikol\'s');

    const family = await familySession(first.portal.link);
    assert.equal((await book(baseUrl, LATER, { Cookie: family })).status, 200);
    assert.deepEqual(sql(dbPath, `SELECT teacher_id AS t FROM bookings_v2 ORDER BY id`).map(r => r.t), [NIKOL, LIOR]);
  } finally { await stop(); }
});

test('a tutor who is not active, or an enrollment that does not exist, is refused', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    await book(baseUrl);
    const cookie = await login(baseUrl);
    const [{ id }] = sql(dbPath, `SELECT id FROM enrollments`);
    assert.equal((await move(baseUrl, id, 999, cookie)).status, 400);
    assert.equal((await move(baseUrl, 999, LIOR, cookie)).status, 404);
    assert.deepEqual(sql(dbPath, `SELECT teacher_id AS t FROM enrollments`).map(r => r.t), [NIKOL]);
  } finally { await stop(); }
});
