// tests/unit/validate-lesson.test.mjs
//
// validateLesson is the only gate between the model and a child, and until
// now it had no test of its own.
//
// The checks added here come from grading 12 real generations (2 subjects ×
// 4 levels, plus 4 repeats) against docs/quality/lesson-generation-rubric.md.
// None of them fired on that corpus — generation was clean. They are here
// anyway, and the distinction matters: each one guards a failure that is
// SEVERE and SILENT. A quiz whose answers all sit at the same index is
// winnable without the skill it claims to test, and it looks perfectly
// normal in the database, on the page, and in every existing check. Nothing
// downstream would ever report it.
//
// A gate against a failure that cannot happen is waste. A gate against one
// that has not happened YET, would go unnoticed if it did, and costs one
// array comparison, is cheap insurance against a prompt change nobody
// connected to game quality.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLesson } from '../../src/lib/server/lesson/prep.ts';

/** A lesson that passes every existing structural check, so each test below
 *  varies exactly one thing and the failure it asserts is unambiguous. */
const base = () => ({
  title: 'שיעור',
  gradeContext: 'כיתה ז',
  slides: [1, 2, 3, 4].map(n => ({ heading: `שקף ${n}`, bullets: ['נקודה'] })),
  examples: [{ problem: '2+2', steps: ['מחברים'], answer: '4' }],
  homework: [{ task: 'תרגיל א', why: 'תרגול' }, { task: 'תרגיל ב', why: 'תרגול' }],
  games: {
    quiz: {
      questions: [
        { q: 'שאלה 1', options: ['א', 'ב', 'ג'], answer: 0 },
        { q: 'שאלה 2', options: ['א', 'ב', 'ג'], answer: 1 },
        { q: 'שאלה 3', options: ['א', 'ב', 'ג'], answer: 2 },
      ],
    },
    sequence: { steps: ['ראשון', 'שני', 'שלישי'] },
  },
});

test('a well-formed lesson passes', () => {
  assert.deepEqual(validateLesson(base()), [],
    'the fixture must be clean, or every test below is testing the fixture');
});

// ── Answer-position bias ────────────────────────────────────────────────
// The failure this catches is not a broken game; it is a game that works
// perfectly and teaches nothing, because the child learns the position
// rather than the material.

test('a quiz whose answers are all at the same index is rejected', () => {
  const plan = base();
  plan.games.quiz.questions.forEach(q => { q.answer = 1; });
  const problems = validateLesson(plan);
  assert.ok(problems.some(p => p.includes('אותו מקום')),
    `expected a position-bias problem, got: ${JSON.stringify(problems)}`);
});

test('two questions sharing an index is not bias', () => {
  // Real quizzes repeat an index by chance. Only a run of THREE or more
  // with no variation at all is evidence of a pattern rather than luck —
  // the same threshold the rubric used when grading.
  const plan = base();
  plan.games.quiz.questions = plan.games.quiz.questions.slice(0, 2);
  plan.games.quiz.questions.forEach(q => { q.answer = 1; });
  assert.deepEqual(validateLesson(plan), []);
});

test('a two-truths round set with the lie always in one slot is rejected', () => {
  const plan = base();
  plan.games.twoTruths = {
    rounds: [0, 1, 2].map(() => ({
      statements: ['אמת', 'שקר', 'אמת'], lieIndex: 1,
    })),
  };
  const problems = validateLesson(plan);
  assert.ok(problems.some(p => p.includes('אותו מקום')),
    `expected a position-bias problem, got: ${JSON.stringify(problems)}`);
});

// ── Ambiguity ───────────────────────────────────────────────────────────
// These make a correct answer indistinguishable from a wrong one. A child
// who picks the duplicate is told they are wrong, and they are not.

test('a quiz question with two identical options is rejected', () => {
  const plan = base();
  plan.games.quiz.questions[0].options = ['א', 'א', 'ג'];
  const problems = validateLesson(plan);
  assert.ok(problems.some(p => p.includes('אפשרויות זהות')),
    `expected a duplicate-option problem, got: ${JSON.stringify(problems)}`);
});

test('a matching game repeating a side is rejected', () => {
  const plan = base();
  plan.games.matching = {
    pairs: [
      { left: 'א', right: '1' },
      { left: 'א', right: '2' },
      { left: 'ג', right: '3' },
    ],
  };
  const problems = validateLesson(plan);
  assert.ok(problems.some(p => p.includes('התאמה')),
    `expected a duplicate-pair problem, got: ${JSON.stringify(problems)}`);
});

test('a memory game repeating a face is rejected', () => {
  // memory uses a/b, matching uses left/right. The first version of the
  // grading script read left/right for both, compared a list of empty
  // strings, and reported every lesson as duplicated — so this test pins
  // the shape as well as the rule.
  const plan = base();
  plan.games.memory = {
    pairs: [
      { a: 'זהה', b: '1' }, { a: 'זהה', b: '2' }, { a: 'ג', b: '3' },
      { a: 'ד', b: '4' }, { a: 'ה', b: '5' }, { a: 'ו', b: '6' },
    ],
  };
  const problems = validateLesson(plan);
  assert.ok(problems.some(p => p.includes('זיכרון')),
    `expected a duplicate-pair problem, got: ${JSON.stringify(problems)}`);
});

test('a sequence with a repeated step is rejected', () => {
  // A repeated step has no single correct ordering, so the game cannot be
  // won except by luck — and it will mark a correct ordering wrong.
  const plan = base();
  plan.games.sequence.steps = ['ראשון', 'ראשון', 'שלישי'];
  const problems = validateLesson(plan);
  assert.ok(problems.some(p => p.includes('רצף')),
    `expected a duplicate-step problem, got: ${JSON.stringify(problems)}`);
});

// ── The existing gate, now covered ──────────────────────────────────────

test('the existing structural checks still fire', () => {
  const thin = { title: 'x', gradeContext: 'y', slides: [], examples: [], homework: [], games: {} };
  const problems = validateLesson(thin);
  assert.ok(problems.length >= 4, `expected several problems, got: ${JSON.stringify(problems)}`);
});

test('a quiz answer index outside its options is still rejected', () => {
  const plan = base();
  plan.games.quiz.questions[0].answer = 9;
  assert.ok(validateLesson(plan).some(p => p.includes('מחוץ לתחום')));
});
