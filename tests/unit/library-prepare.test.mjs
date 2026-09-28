// tests/unit/library-prepare.test.mjs
//
// Preparing the library: one master lesson per skill of a plan template,
// made once and reused — docs/superpowers/specs/2026-09-28-prepared-library-design.md.
// The generator is injected, so no engine runs here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = await mkdtemp(join(tmpdir(), 'library-'));
process.env.DATA_DIR = dir;
process.env.DB_PATH = join(dir, 'results.db');

const P = await import('../../src/lib/server/library/prepare.ts');
const S = await import('../../src/lib/server/library/store.ts');
const { readLessons } = await import('../../src/lib/server/db.ts');
const { latestPublished } = await import('../../src/lib/server/materials.ts');
const { readContent } = await import('../../src/lib/server/content.ts');
const { assertPathSegment } = await import('../../src/lib/server/urls.ts');
const { LessonGenerationError } = await import('../../src/lib/server/lesson/engine.ts');

const plan = (title) => ({
  title,
  gradeContext: 'כיתה ח',
  slides: [1, 2, 3, 4].map(n => ({ heading: `שקף ${n}`, bullets: ['נקודה'] })),
  examples: [{ problem: '2+2', steps: ['מחברים'], answer: '4' }],
  homework: [{ task: 'תרגיל א', why: 'תרגול', answer: 'א' }, { task: 'תרגיל ב', why: 'תרגול', answer: 'ב' }],
  games: {
    quiz: { title: 'חידון', questions: [
      { q: 'שאלה 1', options: ['א', 'ב', 'ג'], answer: 0 },
      { q: 'שאלה 2', options: ['א', 'ב', 'ג'], answer: 1 },
      { q: 'שאלה 3', options: ['א', 'ב', 'ג'], answer: 2 },
    ] },
    sequence: { title: 'סדר', steps: ['ראשון', 'שני', 'שלישי'] },
  },
});

test('a master is named for its skill, and its slug is a legal path segment', () => {
  const slug = P.masterSlug('math-8', 'alg.eq.word', 1790000000000);
  assert.doesNotThrow(() => assertPathSegment('slug', slug));
  assert.match(slug, /^lib-math-8-alg-eq-word-/);
  assert.equal(P.isLibrarySlug(slug), true);
  assert.equal(P.isLibrarySlug('noga-matematika-abc'), false);
});

test("preparing a skill generates its master once, at the template's grade, aimed at that skill", async () => {
  const asked = [];
  const item = await P.prepareSkill('math-8', 'alg.eq.word', {
    generate: async (req) => { asked.push(req); return plan('שאלות מילוליות'); },
  });
  assert.equal(item.status, 'ready');
  assert.equal(asked.length, 1);
  assert.equal(asked[0].skill, 'שאלות מילוליות בעזרת משוואות ממעלה ראשונה');
  assert.equal(asked[0].level, 'כיתה ח');
  assert.equal(asked[0].subject, 'מתמטיקה');

  // An ordinary lesson underneath: row, published plan, slides on disk.
  const row = readLessons().find(l => l.slug === item.slug);
  assert.equal(row.status, 'ready');
  assert.equal(JSON.parse(latestPublished(item.slug, 'plan').content).title, 'שאלות מילוליות');
  assert.match((await readContent('lessons', item.slug)).toString('utf8'), /שקף 1/);
  assert.equal(S.itemFor('math-8', 'alg.eq.word').slug, item.slug);
});

test('a master that fails validation is held, not ready', async () => {
  const broken = plan('שבור');
  broken.slides = [];
  const item = await P.prepareSkill('math-8', 'alg.eq.ineq', { generate: async () => broken });
  assert.equal(item.status, 'held');
  assert.ok(item.problem);
});

test('an engine failure is recorded as failed, with fixed words', async () => {
  const item = await P.prepareSkill('math-8', 'alg.func.rate', {
    generate: async () => { throw new LessonGenerationError('engine-quota', 'quota detail that must not leak'); },
  });
  assert.equal(item.status, 'failed');
  assert.doesNotMatch(item.problem, /must not leak/);
});

test('a topic is prepared one skill at a time, skipping skills that are already ready', async () => {
  const order = [];
  let inFlight = 0, maxInFlight = 0;
  await P.prepareTopic('math-8', 'alg', {
    generate: async (req) => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      order.push(req.skill);
      await new Promise(r => setTimeout(r, 5));
      inFlight--;
      return plan(req.skill);
    },
  });
  assert.equal(maxInFlight, 1, 'one engine run at a time');
  assert.equal(order.length, 5, 'alg.eq.word was ready already: six skills, five runs');
  assert.ok(!order.includes('שאלות מילוליות בעזרת משוואות ממעלה ראשונה'));
  const items = S.itemsForTemplate('math-8');
  assert.equal(items.filter(i => i.status === 'ready').length, 6);
});

test('an unknown template or skill is refused before anything is written', async () => {
  await assert.rejects(P.prepareSkill('math-99', 'x', { generate: async () => plan('x') }));
  await assert.rejects(P.prepareSkill('math-8', 'no.such.skill', { generate: async () => plan('x') }));
  assert.equal(S.itemFor('math-8', 'no.such.skill'), null);
});

test("the tutor's library view lists a template's topics and skills with their items", async () => {
  const V = await import('../../src/lib/server/library/view.ts');
  const view = V.libraryView('math-8');
  const alg = view.topics.find(t => t.key === 'alg');
  assert.equal(alg.skills.length, 6);
  assert.equal(alg.skills.find(s => s.key === 'alg.eq.word').item.status, 'ready');
  assert.ok(view.templates.some(t => t.id === 'math-5u'));
  assert.equal(V.libraryView('nope'), null);
  assert.equal(V.topicSkillKeys('math-8', 'nope'), null);
  assert.equal(V.skillExists('math-8', 'alg.eq.word'), true);
});
