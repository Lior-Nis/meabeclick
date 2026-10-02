// tests/characterization/library-editing-games.test.mjs
//
// A master's two truths, error hunt, sequence and matching, edited and
// published, reach the next booking copied from it; a published edit the
// booking check would hold is refused first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, login, familySession } from './harness.mjs';

const MASTER = 'lib-math-8-num-ratio-prop-games';
const games = {
  twoTruths: { title: 'שתיים', subject: 'מתמטיקה', rounds: [
    { statements: ['א', 'ב', 'ג'], lieIndex: 0, why: '', hint: '' },
    { statements: ['ד', 'ה', 'ו'], lieIndex: 1, why: '', hint: '' },
    { statements: ['ז', 'ח', 'ט'], lieIndex: 2, why: '', hint: '' },
  ] },
  errorHunt: { title: 'ציד', subject: 'מתמטיקה', rounds: [{ problem: '2:3 = x:9', steps: ['3x = 18', 'x = 5'], badStep: 1, why: '18:3=6', hint: '' }] },
  sequence: { title: 'סדר', subject: 'מתמטיקה', steps: ['כופלים בהצלבה', 'מחלקים', 'בודקים'] },
  matching: { title: 'התאמה', subject: 'מתמטיקה', pairs: [{ left: '1:2', right: '2:4', hint: '' }, { left: '1:3', right: '3:9', hint: '' }, { left: '2:5', right: '4:10', hint: '' }] },
};
const plan = {
  title: 'יחס ופרופורציה', gradeContext: 'כיתה ח',
  slides: [1, 2, 3, 4].map(n => ({ heading: `שקף ${n}`, bullets: ['נקודה'] })),
  examples: [{ problem: '2:3 = x:9', steps: ['מכפלה בהצלבה'], answer: '6' }],
  homework: [{ task: 'פתרו 2:3 = x:12', why: 'תרגול', answer: 'x=8' }, { task: 'פתרו 5:x = 10:4', why: 'תרגול', answer: 'x=2' }],
  games,
};
const core = { title: plan.title, slides: plan.slides, examples: plan.examples, teacherOnly: null };
const newTruths = [
  { statements: ['1:2 שווה ל-2:4', '3:4 שווה ל-6:8', '2:3 שווה ל-3:2'], lieIndex: 2, why: 'הסדר ביחס חשוב', hint: '' },
  ...games.twoTruths.rounds.slice(1),
];

test("a master's edited games reach the next booking, and a stuck lie is refused", async () => {
  const s = await startServer();
  try {
    const tutor = await login(s.baseUrl);
    const db = new DatabaseSync(s.dbPath, { timeout: 5000 });
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO library_items (template_id, skill_key, slug, status, updated_at) VALUES ('math-8', 'num.ratio.prop', ?, 'ready', ?)`).run(MASTER, now);
    db.prepare(`INSERT INTO lessons (slug, student, subject, level, title, status, at) VALUES (?, 'ספרייה', 'מתמטיקה', 'כיתה ח', ?, 'ready', ?)`).run(MASTER, plan.title, now);
    db.prepare(`INSERT INTO lesson_materials (lesson_slug, kind, version, content, origin, published_at, created_at) VALUES (?, 'plan', 1, ?, 'generated', ?, ?)`).run(MASTER, JSON.stringify(plan), now, now);
    const post = (body) => fetch(`${s.baseUrl}/api/lessons/${MASTER}/materials`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: tutor }, body: JSON.stringify(body) });

    const stuck = games.twoTruths.rounds.map(r => ({ ...r, lieIndex: 0 }));
    const refused = await post({ type: 'publish-plan', edit: { ...core, twoTruths: stuck } });
    assert.equal(refused.status, 422);
    assert.match((await refused.json()).error, /המשפט השקרי תמיד באותו מקום/);

    const ok = await post({ type: 'publish-plan', edit: { ...core, twoTruths: newTruths,
      errorHunt: [{ ...games.errorHunt.rounds[0], steps: ['3x = 18', 'x = 9'] }],
      sequence: ['כופלים בהצלבה', 'מחלקים בשני האגפים', 'בודקים בהצבה'],
      matching: [...games.matching.pairs.slice(0, 2), { left: '5:10', right: '1:2', hint: 'מצמצמים' }] } });
    assert.equal(ok.status, 200, await ok.clone().text());

    const first = await fetch(`${s.baseUrl}/api/book`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'נוגה', level: 'כיתה ח', phone: '0501234567', email: 'games@example.com', durationMin: 90,
        start: '2027-03-01T10:00:00+02:00', end: '2027-03-01T11:30:00+02:00' }) }).then(r => r.json());
    const family = await familySession(first.portal.link);
    await fetch(`${s.baseUrl}/api/plans`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: tutor },
      body: JSON.stringify({ code: first.portal.code, subject: 'מתמטיקה', templateId: 'math-8', goal: 'כיתה ח' }) });
    await fetch(`${s.baseUrl}/api/book`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: family },
      body: JSON.stringify({ name: 'נוגה', level: 'כיתה ח', phone: '0501234567', email: 'games@example.com', durationMin: 90,
        start: '2027-03-08T10:00:00+02:00', end: '2027-03-08T11:30:00+02:00' }) });

    let copy = null;
    for (let i = 0; i < 300 && !copy; i++) {
      const row = db.prepare(`SELECT l.slug, l.status FROM lessons l JOIN library_uses u ON u.lesson_slug = l.slug`).get();
      if (row?.status === 'ready') copy = row; else await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(copy, 'a copy from the library');
    const file = (t) => readFile(join(s.dataDir, 'games-data', `${copy.slug}-${t}.json`), 'utf8');
    assert.match(await file('two-truths'), /2:3 שווה ל-3:2/);
    assert.match(await file('error-hunt'), /x = 9/);
    assert.match(await file('sequence'), /מחלקים בשני האגפים/);
    assert.match(await file('matching'), /5:10/);
  } finally { await s.stop(); }
});
