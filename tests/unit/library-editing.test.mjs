/**
 * A library master's check questions and homework are the tutor's to edit.
 * No child has played a master, and every booking copied from it later
 * takes its published plan, so an edit there reaches every lesson that
 * follows. A student's own lesson keeps them as generated: its games are
 * already published and never rewritten (queue.ts, 'wx').
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = await mkdtemp(join(tmpdir(), 'library-editing-'));
process.env.DB_PATH = join(process.env.DATA_DIR, 'results.db');
const { normalizeEdit, applyEdit, editedPlan, formPlan, masterProblems } =
  await import('../../src/lib/server/lesson/editing.ts');
const M = await import('../../src/lib/server/materials.ts');

const core = () => ({
  title: 'יחס', slides: [{ heading: 'h', bullets: ['b'] }],
  examples: [{ problem: 'p', steps: [], answer: 'a' }], teacherOnly: null,
});
const quiz = () => [
  { q: '  כמה זה 2+3?  ', options: [' 5 ', '6', '7'], answer: 0, why: ' חיבור ', hint: ' ספרו מ-2 ' },
  { q: 'כמה זה 3+3?', options: ['5', '6', '7'], answer: 1, why: '', hint: '' },
];
const homework = () => [
  { task: '  פתרו 2:3 = x:12 ', why: ' תרגול ', answer: ' x=8 ' },
  { task: 'פתרו 5:x = 10:4', why: '', answer: '' },
];

test('check questions and homework are trimmed; an empty answer key is no key', () => {
  const r = normalizeEdit({ ...core(), quiz: quiz(), homework: homework() });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.edit.quiz[0], { q: 'כמה זה 2+3?', options: ['5', '6', '7'], answer: 0, why: 'חיבור', hint: 'ספרו מ-2' });
  assert.equal(r.edit.quiz[1].hint, '', 'a blank hint offers no hint (engine.offersHints)');
  assert.deepEqual(r.edit.homework[0], { task: 'פתרו 2:3 = x:12', why: 'תרגול', answer: 'x=8' });
  assert.equal('answer' in r.edit.homework[1], false);
});

test('an edit without them leaves both out, so the plan keeps its own', () => {
  const r = normalizeEdit(core());
  assert.equal(r.ok, true);
  assert.equal(r.edit.quiz, undefined);
  assert.equal(r.edit.homework, undefined);
});

const refuses = (mut, why) => test(`refused: ${why}`, () => {
  const e = { ...core(), quiz: quiz(), homework: homework() }; mut(e);
  const r = normalizeEdit(e);
  assert.equal(r.ok, false);
  assert.ok(r.error.length > 0);
});
refuses(e => { e.quiz[0].q = ' '; }, 'a question without text');
refuses(e => { e.quiz[0].options = ['5']; }, 'a question with one option');
/* Dropping it would shift every later index, and the marked answer with them. */
refuses(e => { e.quiz[0].options[1] = ' '; }, 'an empty option');
refuses(e => { e.quiz[0].answer = 3; }, 'a correct answer that is not one of the options');
refuses(e => { e.quiz[0].answer = '0'; }, 'a correct answer that is not an index');
refuses(e => { e.quiz = 'x'; }, 'questions that are not a list');
refuses(e => { e.homework[0].task = ''; }, 'a homework task without text');
refuses(e => { e.homework = {}; }, 'homework that is not a list');

test('applied, they replace the questions and the homework, and nothing else', () => {
  const base = {
    title: 'old', gradeContext: 'כיתה ח', slides: [], examples: [], homework: [{ task: 'ישן', why: 'w' }],
    games: { quiz: { title: 'חידון', subject: 'מתמטיקה', questions: [] }, sequence: { title: 's', subject: 'm', steps: ['1', '2', '3'] } },
  };
  const r = normalizeEdit({ ...core(), quiz: quiz(), homework: homework() });
  const merged = applyEdit(base, r.edit);
  assert.equal(merged.games.quiz.title, 'חידון');
  assert.equal(merged.games.quiz.questions[0].q, 'כמה זה 2+3?');
  assert.deepEqual(merged.games.sequence, base.games.sequence);
  assert.equal(merged.homework[0].task, 'פתרו 2:3 = x:12');
  assert.equal(merged.gradeContext, 'כיתה ח');
});

const stored = (slug, plan) => M.addMaterial({ slug, kind: 'plan', content: JSON.stringify(plan), origin: 'generated', publish: true });
const planWithQuiz = () => ({
  title: 'מקור', gradeContext: 'כיתה ח', slides: [], examples: [], homework: [{ task: 't', why: 'w' }],
  games: { quiz: { title: 'חידון', subject: 'מתמטיקה', questions: [] } },
});

test('on a library master, an edit to them is applied', () => {
  stored('lib-math-8-num-ratio-prop-a', planWithQuiz());
  const r = editedPlan('lib-math-8-num-ratio-prop-a', { ...core(), quiz: quiz(), homework: homework() });
  assert.equal(r.error, undefined);
  assert.equal(r.plan.games.quiz.questions.length, 2);
  assert.equal(r.plan.homework[1].task, 'פתרו 5:x = 10:4');
});

test("on a student's own lesson, it is refused — the child's games are already out", () => {
  stored('noga-2027-02-01', planWithQuiz());
  const r = editedPlan('noga-2027-02-01', { ...core(), quiz: quiz() });
  assert.equal(r.status, 400);
  assert.match(r.error, /ספרייה/);
  assert.equal(editedPlan('noga-2027-02-01', core()).error, undefined, 'the rest of the lesson stays editable');
});

test('questions for a master that has no quiz are refused, not dropped', () => {
  stored('lib-math-8-num-ratio-scale-a', { ...planWithQuiz(), games: { sequence: { title: 's', subject: 'm', steps: ['1', '2', '3'] } } });
  const r = editedPlan('lib-math-8-num-ratio-scale-a', { ...core(), quiz: quiz() });
  assert.equal(r.status, 400);
});

test("a master is checked like the lessons copied from it; a student's lesson is not", () => {
  const thin = { ...planWithQuiz(), slides: [{ heading: 'h', bullets: ['b'] }] };
  assert.ok(masterProblems('lib-math-8-num-ratio-prop-a', thin).includes('פחות מ-4 שקפים'));
  assert.deepEqual(masterProblems('noga-2027-02-01', thin), [], 'the tutor is the judge of her own lesson');
});

test('the form gets the questions and the homework, shaped whatever was stored', () => {
  const f = formPlan({ ...planWithQuiz(), games: { quiz: { questions: [{ q: 'ש', options: ['א', 7], answer: 1, hint: null }] } }, homework: [{ task: 't', answer: 'k' }] });
  assert.deepEqual(f.quiz, [{ q: 'ש', options: ['א', ''], answer: 1, why: '', hint: '' }]);
  assert.deepEqual(f.homework, [{ task: 't', why: '', answer: 'k' }]);
  assert.equal(formPlan({ games: {} }).quiz, null, 'no quiz is not an empty quiz');
});
