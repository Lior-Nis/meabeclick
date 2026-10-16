// tests/characterization/booking-mode.test.mjs
//
// Online or in person, through the real /api/book (Todoist
// 6hmR35WgcWp7Mj2q). The choice is kept on the booking. Anything but the
// two is refused before a family is enrolled or an hour is claimed, because
// a lesson at the student's home is not on offer. A request with no mode at
// all (a page opened before this shipped, a confirmation held before it)
// still books, and records that it never said.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer } from './harness.mjs';

const body = (over) => JSON.stringify({
  name: 'נוגה ישראלי', level: 'כיתה ח', phone: '0501234567', durationMin: 45, ...over,
});
const post = (baseUrl, over) => fetch(`${baseUrl}/api/book`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(over),
});

test('the mode is kept on the booking; any other value is refused before anything is written', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const ok = await post(baseUrl, { email: 'mode1@example.com', mode: 'in_person',
      start: '2027-06-01T10:00:00+03:00', end: '2027-06-01T10:45:00+03:00' });
    assert.equal(ok.status, 200, await ok.clone().text());

    const bad = await post(baseUrl, { email: 'mode2@example.com', mode: 'home',
      start: '2027-06-02T10:00:00+03:00', end: '2027-06-02T10:45:00+03:00' });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /אונליין או פנים מול פנים/);

    const none = await post(baseUrl, { email: 'mode3@example.com',
      start: '2027-06-03T10:00:00+03:00', end: '2027-06-03T10:45:00+03:00' });
    assert.equal(none.status, 200, await none.clone().text());

    const db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare(`SELECT a.email, b.mode FROM bookings_v2 b
      JOIN students_v2 s ON s.id = b.student_id JOIN accounts a ON a.id = s.account_id ORDER BY b.id`).all();
    assert.deepEqual(rows.map((r) => ({ ...r })), [
      { email: 'mode1@example.com', mode: 'in_person' },
      { email: 'mode3@example.com', mode: null },
    ]);
    assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM accounts WHERE email = 'mode2@example.com'`).get().c, 0,
      'the refused request enrolled nobody');
  } finally { await stop(); }
});
