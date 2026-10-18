// tests/characterization/booking-times.test.mjs
//
// A booking whose times are not real times, or end before they start, is
// refused plainly before anything is written — it used to reach a server
// error (an unparseable time) or book a nonsense lesson (an end before the
// start). Found in the per-tutor booking review, 2026-10-18.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer } from './harness.mjs';

const book = (baseUrl, times) => fetch(`${baseUrl}/api/book`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'דנה', subject: 'מתמטיקה', level: 'כיתה ח', phone: '0501234567',
    email: 'dana@example.com', durationMin: 90, ...times }),
});

test('a lesson time that is not a time, or ends before it starts, is refused and nothing is written', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    for (const times of [
      { start: 'tomorrow', end: '2027-03-15T11:30:00+02:00' },
      { start: '2027-03-15T10:00:00+02:00', end: 'later' },
      { start: '2027-03-15T11:30:00+02:00', end: '2027-03-15T10:00:00+02:00' },
      { start: '2027-03-15T10:00:00+02:00', end: '2027-03-15T10:00:00+02:00' },
    ]) {
      const r = await book(baseUrl, times);
      assert.equal(r.status, 400, JSON.stringify(times));
      assert.deepEqual(await r.json(), { error: 'המועד שנבחר לא תקין' });
    }
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM accounts`).get().n, 0, 'no family was created');
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM bookings_v2`).get().n, 0);
    } finally { db.close(); }
  } finally { await stop(); }
});
