/**
 * What the tutor's editor may change, and how an edit becomes a lesson
 * again. Spec: docs/superpowers/specs/2026-09-25-lesson-editor-design.md.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = await mkdtemp(join(tmpdir(), 'editing-'));
const { normalizeEdit, applyEdit } = await import('../../src/lib/server/lesson/editing.ts');

const good = () => ({
  title: '  שברים  ',
  slides: [{ heading: 'מה זה שבר', bullets: ['חלק מתוך שלם', '', '  מונה ומכנה '], note: '' }],
  examples: [{ problem: '1/2+1/4', steps: ['מכנה משותף', ''], answer: '3/4' }],
  teacherOnly: '  לחזור על זה בשבוע הבא ',
});

test('a good edit is trimmed, and blank lines are not bullets', () => {
  const r = normalizeEdit(good());
  assert.equal(r.ok, true);
  assert.equal(r.edit.title, 'שברים');
  assert.deepEqual(r.edit.slides[0].bullets, ['חלק מתוך שלם', 'מונה ומכנה']);
  assert.equal(r.edit.slides[0].note, undefined, 'an empty note is no note');
  assert.deepEqual(r.edit.examples[0].steps, ['מכנה משותף']);
  assert.equal(r.edit.teacherOnly, 'לחזור על זה בשבוע הבא');
});

const refuses = (mut, why) => test(`refused: ${why}`, () => {
  const e = good(); mut(e);
  const r = normalizeEdit(e);
  assert.equal(r.ok, false);
  assert.ok(r.error.length > 0);
});
refuses(e => { e.title = '   '; }, 'no title');
refuses(e => { e.slides = []; }, 'no slides');
refuses(e => { e.slides[0].heading = ''; }, 'a slide without a heading');
refuses(e => { e.slides[0].bullets = ['', ' ']; }, 'a slide without a bullet');
refuses(e => { e.examples[0].problem = ''; }, 'an example without a problem');
refuses(e => { e.examples[0].answer = ' '; }, 'an example without an answer');
refuses(e => { e.slides = 'nope'; }, 'slides that are not a list');

test('not an object at all is refused, not thrown', () => {
  assert.equal(normalizeEdit(null).ok, false);
  assert.equal(normalizeEdit('x').ok, false);
});

test('an edit changes title, slides and examples — and keeps everything else', () => {
  const base = {
    title: 'old', gradeContext: 'כיתה ז', slides: [{ heading: 'h', bullets: ['b'] }],
    examples: [], homework: [{ task: 't', why: 'w' }], games: { quiz: { title: 'q', subject: 's', questions: [] } },
  };
  const r = normalizeEdit(good());
  const merged = applyEdit(base, r.edit);
  assert.equal(merged.title, 'שברים');
  assert.equal(merged.slides[0].heading, 'מה זה שבר');
  assert.deepEqual(merged.games, base.games, 'games are not the editor\'s to drop');
  assert.deepEqual(merged.homework, base.homework);
  assert.equal(merged.gradeContext, 'כיתה ז');
  assert.equal('teacherOnly' in merged, false, 'internal notes never enter the plan the deck is rendered from');
});

/* Final review, Important: an unpublished REGENERATION must not become
   what she edits — one publish would send it out over her published edit,
   the outcome recordGenerated exists to prevent. */
test('the edit base skips an unpublished regeneration, and a version that does not parse', async () => {
  process.env.DB_PATH = join(process.env.DATA_DIR, 'results.db');
  const M = await import('../../src/lib/server/materials.ts');
  const { editBase } = await import('../../src/lib/server/lesson/editing.ts');
  const slug = 'base-rule';
  const plan = (title) => JSON.stringify({ title, slides: [], examples: [], homework: [], games: {} });

  M.recordGenerated(slug, { plan: plan('generated v1') });                                   // v1 published
  M.addMaterial({ slug, kind: 'plan', content: plan('her edit'), origin: 'edited', publish: true }); // v2
  M.recordGenerated(slug, { plan: plan('regenerated') });                                    // v3, unpublished
  let base = editBase(slug);
  assert.equal(base.version, 2);
  assert.equal(base.plan.title, 'her edit');
  assert.equal(base.pendingRegeneration, 3, 'and the page can say a regeneration is waiting');

  M.addMaterial({ slug, kind: 'plan', content: plan('her draft'), origin: 'edited' });       // v4, draft
  assert.equal(editBase(slug).plan.title, 'her draft', 'her own draft is her work');

  M.addMaterial({ slug, kind: 'plan', content: '{not json', origin: 'edited' });             // v5, broken
  assert.equal(editBase(slug).version, 4, 'a broken version is skipped, not a dead end');

  assert.equal(editBase('no-such-lesson'), null);
});

/* Deferred from #131's review, closed 2026-09-27. */

test('text over the limit is refused with a reason, never cut silently', () => {
  const e = good(); e.teacherOnly = 'א'.repeat(2001);
  const r = normalizeEdit(e);
  assert.equal(r.ok, false);
  assert.match(r.error, /2000/);
  const b = good(); b.slides[0].bullets = Array.from({ length: 41 }, (_, i) => `נקודה ${i}`);
  const r2 = normalizeEdit(b);
  assert.equal(r2.ok, false);
  assert.match(r2.error, /40/);
});

test('a malformed stored plan is shaped for the form instead of crashing it', async () => {
  const { formPlan } = await import('../../src/lib/server/lesson/editing.ts');
  assert.deepEqual(formPlan({ title: 7, slides: [null, { heading: 'h', bullets: 'לא רשימה', note: 3 }], examples: 'x' }), {
    title: '', slides: [{ heading: '', bullets: [], note: '' }, { heading: 'h', bullets: ['לא רשימה'], note: '' }], examples: [],
  });
  assert.deepEqual(formPlan(null), { title: '', slides: [], examples: [] });
});
