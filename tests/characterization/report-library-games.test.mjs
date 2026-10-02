// tests/characterization/report-library-games.test.mjs
//
// The tutor reports that a lesson covered a skill other than the one it was
// planned for; that skill has a ready library lesson; its games appear on
// the child's page, playable, with no engine run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, login, familySession } from './harness.mjs';

const post = (url, body, cookie) => fetch(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body),
});

test('after a report, the covered skill\'s library games reach the child\'s page', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const booked = await post(`${baseUrl}/api/book`, { name: 'נוגה ישראלי', level: 'כיתה ח', phone: '0501234567', email: 'rg@example.com',
      durationMin: 90, start: '2027-05-03T10:00:00+03:00', end: '2027-05-03T11:30:00+03:00' }).then(r => r.json());
    const family = await familySession(booked.portal.link);
    const tutor = await login(baseUrl);
    const created = await (await post(`${baseUrl}/api/plans`, { code: booked.portal.code, subject: 'מתמטיקה', templateId: 'math-8', goal: 'כיתה ח' }, tutor)).json();

    const db = new DatabaseSync(dbPath, { timeout: 5000 });
    // In the past, so it can be reported: the booking and its lesson together.
    const past = '2026-01-05T10:00:00.000Z';
    const bookingId = Number(db.prepare(`SELECT id FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get().id);
    db.prepare(`UPDATE lessons SET lesson_at = ? WHERE lesson_at = (SELECT start FROM bookings_v2 WHERE id = ?)`).run(past, bookingId);
    db.prepare(`UPDATE bookings_v2 SET start = ?, "end" = '2026-01-05T11:30:00.000Z' WHERE id = ?`).run(past, bookingId);

    const covered = created.tree.flatMap(t => t.branches).flatMap(b => b.skills).find(s => s.title.includes('אי שוויונות'))
      ?? created.tree[0].branches[0].skills[1];
    const key = db.prepare(`SELECT key FROM plan_nodes WHERE id = ?`).get(covered.id).key;
    const now = new Date().toISOString();
    const plan = { title: 'm', gradeContext: 'c', slides: [], examples: [], homework: [], games: {
      twoTruths: { title: 'שתי אמיתות מהספרייה', subject: 'מתמטיקה', rounds: [{ statements: ['א', 'ב', 'ג'], lieIndex: 1, why: '', hint: '' }] },
    } };
    db.prepare(`INSERT INTO library_items (template_id, skill_key, slug, status, updated_at) VALUES ('math-8', ?, 'lib-math-8-rg', 'ready', ?)`).run(key, now);
    db.prepare(`INSERT INTO lesson_materials (lesson_slug, kind, version, content, origin, published_at, created_at) VALUES ('lib-math-8-rg', 'plan', 1, ?, 'generated', ?, ?)`).run(JSON.stringify(plan), now, now);

    const filed = await post(`${baseUrl}/api/reports`, { bookingId, note: null, entries: [{ nodeId: covered.id, status: 'guided' }] }, tutor);
    assert.equal(filed.status, 200, await filed.clone().text());

    let game = null;
    for (let i = 0; i < 100 && !game; i++) {
      const portal = await (await fetch(`${baseUrl}/api/portal/${booked.portal.code}?kind=student`, { headers: { Cookie: family } })).json();
      game = (portal.games ?? []).find(g => g.title === 'שתי אמיתות מהספרייה');
      if (!game) await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(game, "on the child's page");
    /* A signed link to this copy, for this child. (The page itself is
       checked in a browser: node's fetch of the play page does not end.) */
    assert.match(game.url, new RegExp(`^/app/play/two-truths\\?d=[^&]+-lib-[a-z0-9-]+-two-truths&s=${booked.portal.code}&t=`));
  } finally { await stop(); }
});
