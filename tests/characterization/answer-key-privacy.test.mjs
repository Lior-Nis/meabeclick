// tests/characterization/answer-key-privacy.test.mjs
//
// The homework answer key (migration 022) is the tutor's. The family's
// portal API carries the task and never the key; the tutor's activity API
// carries both. Asserted on the wire, not on the source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, login, familySession } from './harness.mjs';

const KEY = 'תשובון-סודי: x=4';

test('the family never receives the answer key; the tutor does', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const booked = await (await fetch(`${baseUrl}/api/book`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'נוגה', subject: 'מתמטיקה', level: 'כיתה ח', phone: '0501234567', email: 'key@example.com',
        durationMin: 90, start: '2027-06-01T10:00:00+03:00', end: '2027-06-01T11:30:00+03:00' }),
    })).json();
    const db = new DatabaseSync(dbPath);
    const sid = db.prepare('SELECT id FROM students_v2 WHERE code = ?').get(booked.portal.code).id;
    db.prepare('INSERT INTO homework (student_id, task, assigned_at, answer) VALUES (?, ?, ?, ?)')
      .run(sid, 'פתרו 2x+3=11', new Date().toISOString(), KEY);

    const family = await familySession(booked.portal.link);
    for (const kind of ['student', 'parent']) {
      const body = await (await fetch(`${baseUrl}/api/portal/${booked.portal.code}?kind=${kind}`, { headers: { Cookie: family } })).text();
      assert.match(body, /פתרו 2x\+3=11/, `${kind}: the task is there`);
      assert.ok(!body.includes(KEY), `${kind}: the key is not`);
    }

    const tutor = await login(baseUrl);
    const activity = await (await fetch(`${baseUrl}/api/students/${booked.portal.code}/activity`, { headers: { Cookie: tutor } })).json();
    assert.equal(activity.homework.find(h => h.task === 'פתרו 2x+3=11')?.answer, KEY);
  } finally { await stop(); }
});
