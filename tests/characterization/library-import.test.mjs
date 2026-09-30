// tests/characterization/library-import.test.mjs
//
// A library lesson generated on the tutor's machine (scripts/library-local.mjs,
// Claude Code or opencode) enters the production library through
// /api/library/import: checked like any generated lesson, published like a
// preparation, and recorded as not a Codex run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, familySession } from './harness.mjs';

const KEY = 'test-cron-key';
const PLAN = {
  title: 'פונקציה לינארית וריבועית',
  gradeContext: '4 יח"ל, כיתה יא',
  slides: [1, 2, 3, 4].map(n => ({ heading: `שקף ${n}`, bullets: ['y = 2x + 1'] })),
  examples: [{ problem: 'מצאו את השיפוע של y = 3x - 2', steps: ['המקדם של x'], answer: '3' }],
  homework: [{ task: 'שרטטו y = x² - 4', why: 'תרגול', answer: 'חיתוך ב-(±2,0)' }, { task: 'מצאו קודקוד של y = x² - 2x', why: 'תרגול', answer: '(1,-1)' }],
  games: {
    quiz: { title: 'חידון', subject: 'מתמטיקה', questions: [
      { q: 'שיפוע y = 2x + 5?', options: ['2', '5', '7'], answer: 0, why: 'המקדם של x', hint: '' },
      { q: 'y = x² פתוחה', options: ['למטה', 'למעלה', 'ימינה'], answer: 1, why: 'מקדם חיובי', hint: '' },
      { q: 'חיתוך עם y של y = x + 3', options: ['(3,0)', '(0,-3)', '(0,3)'], answer: 2, why: 'x = 0', hint: '' },
    ] },
    sequence: { title: 'סדר', subject: 'מתמטיקה', steps: ['מציבים x = 0', 'מוצאים את y', 'מסמנים נקודה'] },
  },
};

const post = (baseUrl, body, headers = { 'x-cron-key': KEY }) => fetch(`${baseUrl}/api/library/import`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});

test('a lesson made elsewhere enters the library ready, and is recorded as not a Codex run', async () => {
  const { baseUrl, dbPath, stop } = await startServer({ env: { CRON_KEY: KEY } });
  try {
    const r = await post(baseUrl, { template: 'math-4u', skill: 'func.basics.linquad', plan: PLAN, engine: 'claude' });
    assert.equal(r.status, 200, await r.clone().text());
    const { item } = await r.json();
    assert.equal(item.status, 'ready');
    assert.match(item.slug, /^lib-math-4u-func-basics-linquad-/);

    const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 5000 });
    assert.deepEqual({ ...db.prepare(`SELECT engine FROM lesson_engines WHERE lesson_slug = ?`).get(item.slug) }, { engine: 'claude' });
    assert.equal(db.prepare(`SELECT status FROM lessons WHERE slug = ?`).get(item.slug).status, 'ready');
    const deck = await fetch(`${baseUrl}/lessons/${item.slug}`);
    assert.equal(deck.status, 200);
    assert.match(await deck.text(), /שקף 1/);
  } finally { await stop(); }
});

test('a lesson that fails the check is refused with its problems, and nothing is written', async () => {
  const { baseUrl, dbPath, stop } = await startServer({ env: { CRON_KEY: KEY } });
  try {
    const r = await post(baseUrl, { template: 'math-4u', skill: 'func.basics.linquad', plan: { ...PLAN, slides: PLAN.slides.slice(0, 2) }, engine: 'claude' });
    assert.equal(r.status, 422);
    assert.ok((await r.json()).problems.includes('פחות מ-4 שקפים'));
    const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 5000 });
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM library_items`).get().n, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM lessons`).get().n, 0);
  } finally { await stop(); }
});

test('who may import, and what', async () => {
  const { baseUrl, dbPath, stop } = await startServer({ env: { CRON_KEY: KEY } });
  try {
    const body = { template: 'math-4u', skill: 'func.basics.linquad', plan: PLAN, engine: 'claude' };
    assert.equal((await post(baseUrl, body, {})).status, 401, 'no key, no session');
    const booked = await fetch(`${baseUrl}/api/book`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'נוגה ישראלי', level: 'כיתה יא', phone: '0501234567', email: 'imp@example.com', durationMin: 90,
        start: '2027-05-03T10:00:00+03:00', end: '2027-05-03T11:30:00+03:00' }) }).then(x => x.json());
    const family = await familySession(booked.portal.link);
    assert.equal((await post(baseUrl, body, { Cookie: family })).status, 401, 'a family is not the tutor');

    assert.equal((await post(baseUrl, { ...body, engine: 'codex' })).status, 400, 'an import is never a Codex run');
    assert.equal((await post(baseUrl, { ...body, engine: undefined })).status, 400);
    assert.equal((await post(baseUrl, { ...body, skill: 'no.such' })).status, 404);
    assert.equal((await post(baseUrl, { ...body, plan: 'x' })).status, 400);

    const w = new DatabaseSync(dbPath, { timeout: 5000 });
    w.prepare(`INSERT INTO library_items (template_id, skill_key, slug, status, updated_at) VALUES ('math-4u', 'func.basics.graph', NULL, 'preparing', ?)`).run(new Date().toISOString());
    assert.equal((await post(baseUrl, { ...body, skill: 'func.basics.graph' })).status, 409, 'not over a preparation on its way');
  } finally { await stop(); }
});
