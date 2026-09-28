/**
 * A key that never moves is fixed by the generator's post-processing, not
 * by holding the lesson. In the library trial (2026-09-28) two of six
 * skills were held for «שתי אמיתות ושקר: המשפט השקרי תמיד באותו מקום» —
 * and the games shuffle at play time, so no child ever saw the fixed
 * position. Held means a new engine run and a broken gate streak.
 * validateLesson keeps the check; balancePositions makes it pass honestly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const P = await import('../../src/lib/server/lesson/prep.ts');

const plan = () => ({
  title: 'x', gradeContext: 'כיתה ח',
  slides: [1, 2, 3, 4].map(n => ({ heading: `שקף ${n}`, bullets: ['נקודה'] })),
  examples: [{ problem: '1', steps: ['1'], answer: '1' }],
  homework: [{ task: 'א', why: '', answer: '' }, { task: 'ב', why: '', answer: '' }],
  games: {
    quiz: { title: 'חידון', questions: [0, 1, 2, 3].map(i => ({ q: `ש${i}`, options: [`נכון${i}`, `לא${i}a`, `לא${i}b`], answer: 0 })) },
    twoTruths: { title: 'שקר', rounds: [0, 1, 2].map(i => ({ statements: [`אמת${i}a`, `שקר${i}`, `אמת${i}b`], lieIndex: 1, why: '' })) },
  },
});

test('every key in one place is spread out, and each still points at the same text', () => {
  const before = plan();
  const after = P.balancePositions(plan());
  assert.deepEqual(P.validateLesson(before).filter(p => p.includes('אותו מקום')).length, 2, 'the fixture is biased');
  assert.deepEqual(P.validateLesson(after), [], 'and after, clean');
  after.games.quiz.questions.forEach((q, i) => assert.equal(q.options[q.answer], `נכון${i}`));
  after.games.twoTruths.rounds.forEach((r, i) => assert.equal(r.statements[r.lieIndex], `שקר${i}`));
  assert.ok(new Set(after.games.quiz.questions.map(q => q.answer)).size > 1);
});

test('keys that already vary are left exactly as they were', () => {
  const p = plan();
  p.games.quiz.questions.forEach((q, i) => {
    q.answer = i % 3;
    q.options = [...q.options.slice(3 - (i % 3)), ...q.options.slice(0, 3 - (i % 3))];
  });
  const copy = JSON.parse(JSON.stringify(p.games.quiz));
  assert.deepEqual(P.balancePositions(p).games.quiz, copy);
});

test('generation applies it before anything validates the plan', () => {
  const src = readFileSync(join(process.cwd(), 'src/lib/server/lesson/prep.ts'), 'utf8');
  assert.match(src, /return balancePositions\(await generateOnce\(req\)\);[\s\S]*return balancePositions\(await generateOnce\(req\)\);/);
});
