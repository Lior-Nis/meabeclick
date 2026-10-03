// tests/characterization/library-due-ahead.test.mjs
//
// What the library should have ready next, for every student with a plan:
// read by scripts/library-local.mjs --due on the box with its cron key, so
// it names skills, never students.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, login, familySession } from './harness.mjs';

const KEY = 'test-cron-key';

test('the next skills every plan needs, and which are ready — no names', async () => {
  const { baseUrl, dbPath, stop } = await startServer({ env: { CRON_KEY: KEY } });
  try {
    const booked = await fetch(`${baseUrl}/api/book`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'נוגה ישראלי', level: 'כיתה ח', phone: '0501234567', email: 'ahead@example.com', durationMin: 90,
        start: '2027-05-03T10:00:00+03:00', end: '2027-05-03T11:30:00+03:00' }) }).then(r => r.json());
    const tutor = await login(baseUrl);
    await fetch(`${baseUrl}/api/plans`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: tutor },
      body: JSON.stringify({ code: booked.portal.code, subject: 'מתמטיקה', templateId: 'math-8', goal: 'כיתה ח' }) });

    const due = () => fetch(`${baseUrl}/api/library/due?ahead=3`, { headers: { 'x-cron-key': KEY } });
    let body = await (await due()).json();
    assert.equal(body.due.length, 3);
    assert.ok(body.due.every(d => d.templateId === 'math-8' && typeof d.skillKey === 'string' && d.ready === false));
    assert.doesNotMatch(JSON.stringify(body), /נוגה|ahead@/, 'no student in it');

    const db = new DatabaseSync(dbPath, { timeout: 5000 });
    db.prepare(`INSERT INTO library_items (template_id, skill_key, slug, status, updated_at) VALUES ('math-8', ?, 'lib-x', 'ready', ?)`)
      .run(body.due[0].skillKey, new Date().toISOString());
    body = await (await due()).json();
    assert.equal(body.due[0].ready, true);

    assert.equal((await fetch(`${baseUrl}/api/library/due`)).status, 401);
    const family = await familySession(booked.portal.link);
    assert.equal((await fetch(`${baseUrl}/api/library/due`, { headers: { Cookie: family } })).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/library/due`, { headers: { Cookie: tutor } })).status, 200, 'the tutor too');
  } finally { await stop(); }
});
