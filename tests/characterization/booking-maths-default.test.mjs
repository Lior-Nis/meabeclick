// tests/characterization/booking-maths-default.test.mjs
//
// The form no longer sends a subject it asked for; the server records every
// booking without one as maths (Todoist 6hfrX4XvwJRjccRq).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer } from './harness.mjs';

test('a booking with no subject is a maths booking', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/book`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'נוגה ישראלי', level: 'כיתה ח', phone: '0501234567', email: 'nosubject@example.com',
        durationMin: 90, start: '2027-06-01T10:00:00+03:00', end: '2027-06-01T11:30:00+03:00' }),
    });
    assert.equal(r.status, 200, await r.clone().text());
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare(`SELECT e.subject FROM bookings_v2 b JOIN enrollments e ON e.id = b.enrollment_id`).get();
    assert.equal(row?.subject, 'מתמטיקה', "the booking's enrollment is maths");
  } finally { await stop(); }
});
