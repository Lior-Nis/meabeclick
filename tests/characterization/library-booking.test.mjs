// tests/characterization/library-booking.test.mjs
//
// End to end: a family books, the tutor gives the child a grade-8 plan, the
// plan's next skill has a ready master in the library, and the family books
// again. The harness has no engine, so the second lesson can only reach the
// child's page by coming from the library.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, login, familySession } from './harness.mjs';

const plan = {
  title: 'יחס ופרופורציה — מהספרייה',
  gradeContext: 'כיתה ח',
  slides: [1, 2, 3, 4].map(n => ({ heading: `שקף ${n}`, bullets: ['נקודה'] })),
  examples: [{ problem: '2:3 = x:9', steps: ['מכפלה בהצלבה'], answer: '6' }],
  homework: [{ task: 'פתרו 2:3 = x:12', why: 'תרגול', answer: 'x=8' }, { task: 'פתרו 5:x = 10:4', why: 'תרגול', answer: 'x=2' }],
  games: {
    quiz: { title: 'חידון', questions: [
      { q: 'שאלה 1', options: ['א', 'ב', 'ג'], answer: 0 },
      { q: 'שאלה 2', options: ['א', 'ב', 'ג'], answer: 1 },
      { q: 'שאלה 3', options: ['א', 'ב', 'ג'], answer: 2 },
    ] },
    sequence: { title: 'סדר', steps: ['ראשון', 'שני', 'שלישי'] },
  },
};

const book = (baseUrl, day, cookie) => fetch(`${baseUrl}/api/book`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify({ name: 'נוגה', subject: 'מתמטיקה', level: 'כיתה ח', phone: '0501234567', email: 'lib@example.com',
    durationMin: 90, start: `2027-02-${day}T10:00:00+02:00`, end: `2027-02-${day}T11:30:00+02:00` }),
}).then(r => r.json());

test('a prepared skill reaches the child with no engine', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const first = await book(baseUrl, '01');
    const family = await familySession(first.portal.link);
    const tutor = await login(baseUrl);
    const created = await fetch(`${baseUrl}/api/plans`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: tutor },
      body: JSON.stringify({ code: first.portal.code, subject: 'מתמטיקה', templateId: 'math-8', goal: 'כיתה ח' }),
    });
    assert.equal(created.status, 200);

    // The master, as a preparation would leave it: a ready item whose lesson has a published plan.
    const db = new DatabaseSync(dbPath);
    const now = new Date().toISOString();
    const MASTER = 'lib-math-8-num-ratio-prop-seed';
    db.prepare(`INSERT INTO library_items (template_id, skill_key, slug, status, updated_at) VALUES ('math-8', 'num.ratio.prop', ?, 'ready', ?)`).run(MASTER, now);
    db.prepare(`INSERT INTO lesson_materials (lesson_slug, kind, version, content, origin, published_at, created_at) VALUES (?, 'plan', 1, ?, 'generated', ?, ?)`)
      .run(MASTER, JSON.stringify(plan), now, now);

    await book(baseUrl, '08', family);
    const copy = await (async () => {
      // Up to 30s: generous, because the whole suite runs servers in parallel.
      for (let i = 0; i < 300; i++) {
        const row = db.prepare(`SELECT l.slug, l.status, l.title FROM lessons l JOIN library_uses u ON u.lesson_slug = l.slug`).get();
        if (row?.status === 'ready') return row;
        await new Promise(r => setTimeout(r, 100));
      }
      return null;
    })();
    assert.ok(copy, 'a lesson copied from the library, finished');
    assert.equal(copy.title, plan.title);

    const portal = await (await fetch(`${baseUrl}/api/portal/${first.portal.code}?kind=student`, { headers: { Cookie: family } })).json();
    assert.ok(portal.lessons.some(l => l.topic === plan.title), "on the child's page");
    const slides = await fetch(`${baseUrl}/lessons/${copy.slug}`);
    assert.equal(slides.status, 200);
    assert.match(await slides.text(), /שקף 1/);
  } finally { await stop(); }
});
