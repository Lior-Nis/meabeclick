// tests/characterization/library-editing.test.mjs
//
// The tutor rewrites a library master's check questions and homework, and
// the next booking copied from it carries them to the child. Publishing a
// master that the booking check would hold is refused up front, and a
// student's own lesson still keeps its questions as generated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, login, familySession } from './harness.mjs';

const MASTER = 'lib-math-8-num-ratio-prop-seed';
const plan = {
  title: 'יחס ופרופורציה — מהספרייה',
  gradeContext: 'כיתה ח',
  slides: [1, 2, 3, 4].map(n => ({ heading: `שקף ${n}`, bullets: ['נקודה'] })),
  examples: [{ problem: '2:3 = x:9', steps: ['מכפלה בהצלבה'], answer: '6' }],
  homework: [{ task: 'פתרו 2:3 = x:12', why: 'תרגול', answer: 'x=8' }, { task: 'פתרו 5:x = 10:4', why: 'תרגול', answer: 'x=2' }],
  games: {
    quiz: { title: 'חידון', subject: 'מתמטיקה', questions: [
      { q: 'שאלה 1', options: ['א', 'ב', 'ג'], answer: 0, why: '', hint: '' },
      { q: 'שאלה 2', options: ['א', 'ב', 'ג'], answer: 1, why: '', hint: '' },
      { q: 'שאלה 3', options: ['א', 'ב', 'ג'], answer: 2, why: '', hint: '' },
    ] },
    sequence: { title: 'סדר', subject: 'מתמטיקה', steps: ['ראשון', 'שני', 'שלישי'] },
  },
};
const core = {
  title: plan.title, slides: plan.slides, examples: plan.examples, teacherOnly: null,
};
const harder = [
  { q: 'פתרו: 3:x = 12:20', options: ['4', '5', '6'], answer: 1, why: 'מכפלה בהצלבה: 12x = 60', hint: 'מה מכפילים בהצלבה?' },
  { q: 'שאלה 2', options: ['א', 'ב', 'ג'], answer: 0, why: '', hint: '' },
  { q: 'שאלה 3', options: ['א', 'ב', 'ג'], answer: 2, why: '', hint: '' },
];
const newHomework = [
  { task: 'מתכון ל-4 אנשים דורש 300 גרם קמח. כמה קמח ל-10 אנשים?', why: 'יחס במילים', answer: '750 גרם' },
  { task: 'פתרו 7:x = 21:9', why: 'תרגול', answer: 'x=3' },
];

const book = (baseUrl, day, cookie) => fetch(`${baseUrl}/api/book`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify({ name: 'נוגה', subject: 'מתמטיקה', level: 'כיתה ח', phone: '0501234567', email: 'libedit@example.com',
    durationMin: 90, start: `2027-03-${day}T10:00:00+02:00`, end: `2027-03-${day}T11:30:00+02:00` }),
}).then(r => r.json());

async function setup() {
  const s = await startServer();
  const tutor = await login(s.baseUrl);
  const db = new DatabaseSync(s.dbPath);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO library_items (template_id, skill_key, slug, status, updated_at) VALUES ('math-8', 'num.ratio.prop', ?, 'ready', ?)`).run(MASTER, now);
  db.prepare(`INSERT INTO lessons (slug, student, subject, level, title, status, at) VALUES (?, 'ספרייה', 'מתמטיקה', 'כיתה ח', ?, 'ready', ?)`).run(MASTER, plan.title, now);
  db.prepare(`INSERT INTO lesson_materials (lesson_slug, kind, version, content, origin, published_at, created_at) VALUES (?, 'plan', 1, ?, 'generated', ?, ?)`)
    .run(MASTER, JSON.stringify(plan), now, now);
  const post = (slug, body) => fetch(`${s.baseUrl}/api/lessons/${slug}/materials`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: tutor }, body: JSON.stringify(body),
  });
  return { ...s, tutor, db, post };
}

test("the master's edited questions and homework reach the next booking's child", async () => {
  const t = await setup();
  try {
    const r = await t.post(MASTER, { type: 'publish-plan', edit: { ...core, quiz: harder, homework: newHomework } });
    assert.equal(r.status, 200, await r.clone().text());

    const first = await book(t.baseUrl, '01');
    const family = await familySession(first.portal.link);
    const created = await fetch(`${t.baseUrl}/api/plans`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: t.tutor },
      body: JSON.stringify({ code: first.portal.code, subject: 'מתמטיקה', templateId: 'math-8', goal: 'כיתה ח' }),
    });
    assert.equal(created.status, 200);
    await book(t.baseUrl, '08', family);

    const copy = await (async () => {
      for (let i = 0; i < 300; i++) {
        const row = t.db.prepare(`SELECT l.slug, l.status FROM lessons l JOIN library_uses u ON u.lesson_slug = l.slug`).get();
        if (row?.status === 'ready') return row;
        await new Promise(res => setTimeout(res, 100));
      }
      return null;
    })();
    assert.ok(copy, 'a lesson copied from the library, finished');

    const quiz = await readFile(join(t.dataDir, 'games-data', `${copy.slug}-quiz.json`), 'utf8');
    assert.match(quiz, /3:x = 12:20/, "the child's quiz is the edited one");
    assert.match(quiz, /מה מכפילים בהצלבה/);
    const homework = t.db.prepare(`SELECT task, answer FROM homework WHERE booking_id IS NOT NULL ORDER BY id`).all().map(h => ({ ...h }));
    assert.deepEqual(homework, newHomework.map(h => ({ task: h.task, answer: h.answer })));
  } finally { await t.stop(); }
});

test('a master the booking check would hold is not published', async () => {
  const t = await setup();
  try {
    const stuck = harder.map(q => ({ ...q, answer: 0 }));
    const r = await t.post(MASTER, { type: 'publish-plan', edit: { ...core, quiz: stuck } });
    assert.equal(r.status, 422);
    assert.match((await r.json()).error, /כל התשובות הנכונות באותו מקום/);
    const live = t.db.prepare(`SELECT version FROM lesson_materials WHERE lesson_slug = ? AND kind = 'plan' AND published_at IS NOT NULL ORDER BY version DESC`).get(MASTER);
    assert.equal(live.version, 1, 'the published master is unchanged');

    const draft = await t.post(MASTER, { type: 'save-plan', edit: { ...core, quiz: stuck } });
    assert.equal(draft.status, 200, 'a draft is hers to finish later');
  } finally { await t.stop(); }
});

test("a student's own lesson refuses a question edit", async () => {
  const t = await setup();
  try {
    const booked = await book(t.baseUrl, '15');
    assert.ok(booked.portal);
    const slug = t.db.prepare(`SELECT slug FROM lessons WHERE student <> 'ספרייה'`).get().slug;
    assert.equal((await t.post(slug, { type: 'save', kind: 'plan', content: JSON.stringify(plan), publish: true })).status, 200);
    const r = await t.post(slug, { type: 'publish-plan', edit: { ...core, quiz: harder } });
    assert.equal(r.status, 400);
  } finally { await t.stop(); }
});
