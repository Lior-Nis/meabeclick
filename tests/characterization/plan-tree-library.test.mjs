// tests/characterization/plan-tree-library.test.mjs
//
// From the student's plan, a skill with a ready library lesson links to it:
// the tutor finds a skill's material from the student, not only from the
// library page. Only ready masters, and only on the tutor's page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, login } from './harness.mjs';

test("a skill's ready library lesson is linked from the student's plan", async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const tutor = await login(baseUrl);
    const booked = await fetch(`${baseUrl}/api/book`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'נוגה ישראלי', subject: 'מתמטיקה', level: 'כיתה ח', phone: '0501234567', email: 'tree@example.com',
        durationMin: 90, start: '2027-05-03T10:00:00+03:00', end: '2027-05-03T11:30:00+03:00' }),
    }).then(r => r.json());
    const created = await fetch(`${baseUrl}/api/plans`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: tutor },
      body: JSON.stringify({ code: booked.portal.code, subject: 'מתמטיקה', templateId: 'math-8', goal: 'כיתה ח' }),
    });
    assert.equal(created.status, 200);

    const db = new DatabaseSync(dbPath);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO library_items (template_id, skill_key, slug, status, updated_at) VALUES ('math-8', 'alg.eq.word', 'lib-math-8-alg-eq-word-tree', 'ready', ?)`).run(now);
    db.prepare(`INSERT INTO library_items (template_id, skill_key, slug, status, updated_at) VALUES ('math-8', 'alg.eq.ineq', 'lib-math-8-alg-eq-ineq-held', 'held', ?)`).run(now);
    const node = db.prepare(`SELECT n.id FROM plan_nodes n JOIN plans p ON p.id = n.plan_id WHERE n.key = 'alg.eq.word'`).get();

    const data = await (await fetch(`${baseUrl}/app/plan/${booked.portal.code}/__data.json`, { headers: { Cookie: tutor } })).text();
    assert.match(data, /lib-math-8-alg-eq-word-tree/, 'the ready master reaches the page');
    assert.doesNotMatch(data, /lib-math-8-alg-eq-ineq-held/, 'a held one is not offered');
    assert.ok(node, 'the plan has the skill');
  } finally { await stop(); }
});
