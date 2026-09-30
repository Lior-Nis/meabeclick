/**
 * A matching game where two pairs share a side cannot be played: the child
 * cannot tell which term goes with «המשולש שווה שוקיים» when both
 * «∠B = ∠C» and «AB = AC» lead to it (the library trial, 2026-09-30:
 * geo.tri.isosceles held for «משחק התאמה: יש פריטים זהים בצד השני»).
 * Each pair is correct maths; the game can only hold one of them. The later
 * duplicate is dropped when at least three pairs remain — validateLesson's
 * own minimum — instead of holding the whole lesson.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const P = await import('../../src/lib/server/lesson/prep.ts');

const plan = (pairs) => ({
  title: 'x', gradeContext: 'כיתה ח',
  slides: [1, 2, 3, 4].map(n => ({ heading: `שקף ${n}`, bullets: ['נקודה'] })),
  examples: [{ problem: '1', steps: ['1'], answer: '1' }],
  homework: [{ task: 'א', why: '', answer: '' }, { task: 'ב', why: '', answer: '' }],
  games: {
    matching: { title: 'התאמה', subject: '', pairs },
    sequence: { title: 'סדר', subject: '', steps: ['א', 'ב', 'ג'] },
  },
});
const pair = (left, right) => ({ left, right, hint: '' });

test('a later pair that repeats a side is dropped, and the game passes', () => {
  const p = plan([
    pair('שוקיים', 'שתי הצלעות השוות'), pair('בסיס', 'הצלע השלישית'),
    pair('∠B = ∠C', 'המשולש שווה שוקיים'), pair('AB = AC', 'המשולש שווה שוקיים'),
    pair('תיכון', 'מחבר קדקוד לאמצע הצלע'),
  ]);
  assert.ok(P.validateLesson(p).some(x => x.includes('זהים')), 'the fixture is ambiguous');
  const fixed = P.dropAmbiguousPairs(p);
  assert.deepEqual(fixed.games.matching.pairs.map(x => x.left), ['שוקיים', 'בסיס', '∠B = ∠C', 'תיכון']);
  assert.deepEqual(P.validateLesson(fixed), []);
});

test('a repeated left side is dropped the same way', () => {
  const p = plan([pair('א', '1'), pair('ב', '2'), pair('ג', '3'), pair('א', '4')]);
  assert.deepEqual(P.dropAmbiguousPairs(p).games.matching.pairs.map(x => x.right), ['1', '2', '3']);
});

test('when dropping would leave fewer than three pairs, the game is left for validation to hold', () => {
  const p = plan([pair('א', 'זהה'), pair('ב', 'זהה'), pair('ג', 'אחר')]);
  assert.equal(P.dropAmbiguousPairs(p).games.matching.pairs.length, 3);
  assert.ok(P.validateLesson(p).some(x => x.includes('זהים')));
});

test('generation applies it before anything validates the plan', () => {
  const src = readFileSync(join(process.cwd(), 'src/lib/server/lesson/prep.ts'), 'utf8');
  assert.equal((src.match(/return dropAmbiguousPairs\(balancePositions\(await generateOnce\(req\)\)\);/g) ?? []).length, 2);
});
