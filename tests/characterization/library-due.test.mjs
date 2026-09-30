// tests/characterization/library-due.test.mjs
//
// The library page names the skill each student's next lesson will target,
// with whether it is prepared: a booking on a prepared skill is built from
// the library, and on any other it waits for a generation run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, login, familySession } from './harness.mjs';

const book = (baseUrl, name, email, day) => fetch(`${baseUrl}/api/book`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name, subject: 'מתמטיקה', level: 'כיתה ח', phone: '0501234567', email,
    durationMin: 90, start: `2027-04-${day}T10:00:00+03:00`, end: `2027-04-${day}T11:30:00+03:00` }),
}).then(r => r.json());

test("the library lists each student's next skill, and whether it is ready", async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const tutor = await login(baseUrl);
    const withPlan = await book(baseUrl, 'נוגה ישראלי', 'due1@example.com', '01');
    await book(baseUrl, 'אלון כהן', 'due2@example.com', '02');   // no plan: nothing to target
    const created = await fetch(`${baseUrl}/api/plans`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: tutor },
      body: JSON.stringify({ code: withPlan.portal.code, subject: 'מתמטיקה', templateId: 'math-8', goal: 'כיתה ח' }),
    });
    assert.equal(created.status, 200);

    const library = async () => (await fetch(`${baseUrl}/api/library?template=math-9`, { headers: { Cookie: tutor } })).json();
    let { due } = await library();
    assert.equal(due.length, 1, 'one student has a plan');
    assert.equal(due[0].templateId, 'math-8', 'across templates, not only the one on screen');
    assert.match(due[0].track, /כיתה ח/);
    assert.ok(due[0].skillKey && due[0].skillTitle);
    assert.deepEqual(due[0].students, ['נוגה'], 'first names only');
    assert.equal(due[0].item, null, 'not prepared yet');

    const db = new DatabaseSync(dbPath);
    db.prepare(`INSERT INTO library_items (template_id, skill_key, slug, status, updated_at) VALUES ('math-8', ?, 'lib-math-8-due-seed', 'ready', ?)`)
      .run(due[0].skillKey, new Date().toISOString());
    ({ due } = await library());
    assert.equal(due[0].item.status, 'ready');
    assert.equal(due[0].item.slug, 'lib-math-8-due-seed');

    const family = await familySession(withPlan.portal.link);
    const denied = await fetch(`${baseUrl}/api/library?template=math-8`, { headers: { Cookie: family } });
    assert.ok([401, 403].includes(denied.status), 'students are named here: tutor only');
  } finally { await stop(); }
});
