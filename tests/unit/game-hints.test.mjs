/**
 * Hints in the round-based games — Todoist 6hRhqRvfX7VHgh9q step 3
 * («לאפשר רמזים ... ותיעוד שימוש בעזרה»).
 *
 * matching was the only template that offered help (#104). The five games
 * with a "stuck on THIS question" moment now do too: quiz, twoTruths,
 * errorHunt, graphMatch, numberLine. memory and speedDrill deliberately do
 * not — turning cards IS the memory game, and a speed drill measures
 * unaided recall.
 *
 * The rule from #104 that must survive: a play reports `hints` only when
 * its data offered any. Null means "none were on offer", which the
 * suggestion engine reads as silence; a 0 from old, hint-less data would be
 * a claim that the child needed no help when none was ever available.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (f) => readFileSync(join(process.cwd(), f), 'utf8');
const { offersHints } = await import('../../src/lib/games/engine.ts');
const { validateLesson } = await import('../../src/lib/server/lesson/prep.ts');

const WITH_HINTS = { Quiz: 'questions', TwoTruths: 'rounds', ErrorHunt: 'rounds', GraphMatch: 'rounds', NumberLine: 'rounds' };

test('offersHints: only a non-blank hint counts as help on offer', () => {
  assert.equal(offersHints([{ hint: 'x' }, {}]), true);
  assert.equal(offersHints([{}, { hint: '  ' }]), false);
  assert.equal(offersHints([]), false);
  assert.equal(offersHints(undefined), false);
});

for (const [name, list] of Object.entries(WITH_HINTS)) {
  test(`${name} offers a hint per round, locked once answered, and reports use only when offered`, () => {
    const s = src(`src/lib/games/${name}.svelte`);
    assert.match(s, /import RoundHint from '\.\/RoundHint\.svelte'/);
    assert.match(s, /\{#key idx\}\s*<RoundHint hint=\{[^}]*\.hint\} locked=\{answered\} onuse=\{\(\) => hintsUsed\+\+\} \/>\s*\{\/key\}/);
    assert.match(s, new RegExp(`\\.\\.\\.\\(offersHints\\(${list}\\) \\? \\{ hints: hintsUsed \\} : \\{\\}\\)`));
  });
}

test('memory and speed drill offer no hints, by design', () => {
  for (const name of ['Memory', 'SpeedDrill']) assert.doesNotMatch(src(`src/lib/games/${name}.svelte`), /RoundHint|hints:/);
});

test('one press shows the hint once; a second press cannot count twice', () => {
  const s = src('src/lib/games/RoundHint.svelte');
  assert.match(s, /disabled=\{!hint \|\| locked \|\| !!shown\}/);
});

test('the generator is asked for a hint on every round of those five games', () => {
  const prep = src('src/lib/server/lesson/prep.ts');
  for (const key of ['quiz', 'twoTruths', 'errorHunt', 'graphMatch', 'numberLine']) {
    const at = prep.indexOf(`        ${key}: {`);
    assert.ok(at > 0, key);
    const block = prep.slice(at, prep.indexOf('\n        },', at));
    assert.match(block, /required: \[[^\]]*'hint'[^\]]*\]/, `${key} requires hint`);
  }
  assert.match(prep, /hint הוא רמז שמכוון לדרך בלי לגלות את התשובה/);
});

test('a quiz hint that gives the answer away is held', () => {
  const plan = {
    title: 't', gradeContext: 'g',
    slides: Array.from({ length: 4 }, () => ({ heading: 'h', bullets: ['b'] })),
    examples: [{ problem: 'p', steps: ['s'], answer: 'a' }],
    homework: [{ task: 'a', why: 'w' }, { task: 'b', why: 'w' }],
    games: {
      quiz: { title: 'q', subject: 's', questions: [
        { q: 'כמה זה 1/2+1/4?', options: ['שלושה רבעים', 'חצי'], answer: 0, why: 'w', hint: 'התשובה היא שלושה רבעים' },
        { q: 'q2', options: ['א', 'ב'], answer: 1, why: 'w', hint: 'חשבו על מכנה משותף' },
        { q: 'q3', options: ['א', 'ב'], answer: 0, why: 'w', hint: 'x' },
      ] },
      sequence: { title: 's', subject: 's', steps: ['1', '2', '3'] },
    },
  };
  const problems = validateLesson(plan);
  assert.ok(problems.some(p => /חידון 1: הרמז חושף את התשובה/.test(p)), problems.join(' | '));
  assert.ok(!problems.some(p => /חידון 2: הרמז/.test(p)));
});
