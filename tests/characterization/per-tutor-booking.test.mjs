// tests/characterization/per-tutor-booking.test.mjs
//
// Each lesson goes to its own tutor
// (docs/superpowers/specs/2026-10-17-per-tutor-booking-design.md): a new
// family to whoever is free, Nikol first; a returning family only ever to
// their own tutor. Lior "takes bookings" here through the database, with a
// busy feed on port 1: refused at once, so his calendar reads as free.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { startServer, familySession } from './harness.mjs';

const NIKOL = 1, LIOR = 2;
const HOUR = { start: '2027-03-15T10:00:00+02:00', end: '2027-03-15T11:30:00+02:00' };
const LATER = { start: '2027-03-16T10:00:00+02:00', end: '2027-03-16T11:30:00+02:00' };
const TAKEN = { error: 'השעה הזו כבר תפוסה' };

function run(dbPath, sql, ...params) {
  const db = new DatabaseSync(dbPath);
  try { db.prepare(sql).run(...params); } finally { db.close(); }
}
function rows(dbPath, sql, ...params) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { return db.prepare(sql).all(...params); } finally { db.close(); }
}
const liorTakesBookings = (dbPath) => run(dbPath,
  `UPDATE teachers SET calendar_id = 'lior-lessons@example.com', busy_ics = 'https://127.0.0.1:1/lior.ics' WHERE id = ?`, LIOR);
const tutorsOf = (dbPath, email) => rows(dbPath, `
  SELECT b.teacher_id AS t FROM bookings_v2 b
    JOIN students_v2 s ON s.id = b.student_id JOIN accounts a ON a.id = s.account_id
   WHERE a.email = ? AND b.status = 'confirmed' ORDER BY b.id`, email).map(r => r.t);
const confirmToken = (id, expMs) => {
  const payload = `p.${id}.${expMs}`;
  return `${payload}.${createHmac('sha256', 'test-secret-not-a-real-one').update(payload).digest('base64url')}`;
};
const book = (baseUrl, over = {}, headers = {}) => fetch(`${baseUrl}/api/book`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify({ name: 'דנה', subject: 'מתמטיקה', level: 'כיתה ח', phone: '0501234567',
    email: 'dana@example.com', durationMin: 90, ...HOUR, ...over }),
});

test('two new families at one hour: Nikol, then Lior, then nobody', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    liorTakesBookings(dbPath);
    assert.equal((await book(baseUrl, { email: 'a@example.com' })).status, 200);
    assert.equal((await book(baseUrl, { email: 'b@example.com' })).status, 200);
    const third = await book(baseUrl, { email: 'c@example.com' });
    assert.equal(third.status, 409);
    assert.deepEqual(await third.json(), TAKEN);
    assert.deepEqual(tutorsOf(dbPath, 'a@example.com'), [NIKOL]);
    assert.deepEqual(tutorsOf(dbPath, 'b@example.com'), [LIOR]);
  } finally { await stop(); }
});

test('until Lior takes bookings, everything goes to Nikol and a taken hour is refused, as today', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    assert.equal((await book(baseUrl, { email: 'a@example.com' })).status, 200);
    const second = await book(baseUrl, { email: 'b@example.com' });
    assert.equal(second.status, 409);
    assert.deepEqual(await second.json(), TAKEN);
    assert.deepEqual(tutorsOf(dbPath, 'a@example.com'), [NIKOL]);
  } finally { await stop(); }
});

test('two families booking one hour at the same moment land with two tutors', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    liorTakesBookings(dbPath);
    const [x, y] = await Promise.all([book(baseUrl, { email: 'x@example.com' }), book(baseUrl, { email: 'y@example.com' })]);
    assert.deepEqual([x.status, y.status], [200, 200]);
    assert.deepEqual([...tutorsOf(dbPath, 'x@example.com'), ...tutorsOf(dbPath, 'y@example.com')].sort(), [NIKOL, LIOR]);
  } finally { await stop(); }
});

test('a returning family whose tutor is busy is told so, and never handed the other tutor', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    liorTakesBookings(dbPath);
    const first = await (await book(baseUrl)).json();
    const cookie = await familySession(first.portal.link);
    const signedIn = await book(baseUrl, { name: 'נועה' }, { Cookie: cookie });
    assert.equal(signedIn.status, 409);
    assert.deepEqual(await signedIn.json(), { code: 'TUTOR_BUSY', error: 'השעה הזאת לא פנויה אצל המורה שלכם', tutorId: NIKOL });
    // Not signed in: the hold path decides the same way.
    const signedOut = await book(baseUrl, { name: 'נועה' });
    assert.equal(signedOut.status, 409);
    assert.equal((await signedOut.json()).code, 'TUTOR_BUSY');
    assert.deepEqual(tutorsOf(dbPath, 'dana@example.com'), [NIKOL], 'nothing was booked with Lior');
    assert.equal(rows(dbPath, `SELECT COUNT(*) AS n FROM pending_bookings`)[0].n, 0, 'nothing was held');
  } finally { await stop(); }
});

test('a known email that is not signed in is held with their tutor, and confirms with that tutor', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    await book(baseUrl);
    liorTakesBookings(dbPath);
    const answer = await (await book(baseUrl, { name: 'נועה', ...LATER })).json();
    assert.equal(answer.awaitingConfirmation, true);
    const [hold] = rows(dbPath, `SELECT id, teacher_id, expires_at FROM pending_bookings`);
    assert.equal(hold.teacher_id, NIKOL);
    // Meanwhile the family moves to Lior. The held lesson stays Nikol's.
    run(dbPath, `UPDATE enrollments SET teacher_id = ?`, LIOR);
    const confirmed = await fetch(`${baseUrl}/api/book`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: confirmToken(hold.id, Date.parse(hold.expires_at)) }),
    });
    assert.equal(confirmed.status, 200, await confirmed.clone().text());
    assert.deepEqual(tutorsOf(dbPath, 'dana@example.com'), [NIKOL, NIKOL]);
  } finally { await stop(); }
});

test("booking again keeps the tutor; a moved student's next lesson goes to the new tutor, the earlier one stays", async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    liorTakesBookings(dbPath);
    const first = await (await book(baseUrl)).json();
    const cookie = await familySession(first.portal.link);
    run(dbPath, `UPDATE enrollments SET teacher_id = ?`, LIOR);
    assert.equal((await book(baseUrl, LATER, { Cookie: cookie })).status, 200);
    assert.deepEqual(tutorsOf(dbPath, 'dana@example.com'), [NIKOL, LIOR]);
    assert.deepEqual(rows(dbPath, `SELECT teacher_id FROM enrollments`).map(r => r.teacher_id), [LIOR],
      'booking again did not put her back with Nikol');
  } finally { await stop(); }
});

test("a family booked with Lior has his name on their page", async () => {
  const { baseUrl, dbPath, dataDir, stop } = await startServer();
  try {
    liorTakesBookings(dbPath);
    await book(baseUrl, { email: 'a@example.com' });
    const b = await (await book(baseUrl, { email: 'b@example.com', name: 'יואב' })).json();
    const page = JSON.parse(readFileSync(join(dataDir, 'portal', `${b.portal.code}.json`), 'utf8'));
    assert.equal(page.tutor, 'ליאור');
  } finally { await stop(); }
});

/* Final review, Important #1. Confirming a hold releases its hour, so the
   held tutor's calendars must be read BEFORE the claim: an await between
   the claim and the reservation let another family take the hour this
   family was holding. Nikol's feed here answers 500 after 1.5s, so every
   calendar read is slow (failures are never cached). */
test('confirming a hold keeps the hour, even when another family books it while the calendars are read', async () => {
  const slow = createServer((req, res) => setTimeout(() => { res.writeHead(500); res.end(); }, 1500));
  await new Promise(r => slow.listen(0, '127.0.0.1', r));
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    await book(baseUrl);                                           // Dana, with Nikol
    assert.equal((await (await book(baseUrl, { name: 'נועה', ...LATER })).json()).awaitingConfirmation, true);
    const [hold] = rows(dbPath, `SELECT id, expires_at FROM pending_bookings`);
    run(dbPath, `UPDATE teachers SET busy_ics = ? WHERE id = ?`, `http://127.0.0.1:${slow.address().port}/slow.ics`, NIKOL);

    const other = book(baseUrl, { email: 'other@example.com', name: 'אחר', ...LATER });
    await new Promise(r => setTimeout(r, 500));
    const confirmed = fetch(`${baseUrl}/api/book`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: confirmToken(hold.id, Date.parse(hold.expires_at)) }),
    });
    const [o, c] = await Promise.all([other, confirmed]);
    assert.equal(c.status, 200, `the held family keeps their hour: ${await c.clone().text()}`);
    assert.equal(o.status, 409, 'the other family is told the hour is taken');
    assert.deepEqual(tutorsOf(dbPath, 'dana@example.com'), [NIKOL, NIKOL]);
    assert.deepEqual(tutorsOf(dbPath, 'other@example.com'), []);
  } finally { await stop(); slow.close(); }
});
