/**
 * Two teaching judgements the generator is now told, rather than left to
 * choose (decided by Lior, 2026-09-25):
 *
 *   1. Which game fits which goal comes from games/registry.json's
 *      selection rules — the file used to say so while nothing read it
 *      (see its $comment and docs/quality/game-standard.md), and the prompt
 *      carried its own hand-written, drifting copy of the mapping.
 *   2. How long the deck is follows the lesson's plan: a 45-minute lesson
 *      and a 135-minute one used to be asked for the same "6-10 slides".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { gameSelectionLines, slideTarget } = await import('../../src/lib/server/lesson/prep.ts');
const { TEMPLATE_FILES } = await import('../../src/lib/server/lesson/prep.ts');
const { PLANS } = await import('../../src/lib/plans.ts');

const registry = JSON.parse(readFileSync(join(process.cwd(), 'games', 'registry.json'), 'utf8'));
const keyFor = Object.fromEntries(Object.entries(TEMPLATE_FILES).map(([k, t]) => [t, k]));

test('every selection rule names a game the generator can actually produce', () => {
  for (const r of registry.selection.rules) {
    assert.ok(keyFor[r.use], `rule "${r.when}" uses ${r.use}, which has no plan key in TEMPLATE_FILES`);
  }
  assert.ok(keyFor[registry.selection.fallback]);
});

test('the prompt carries the registry rules, in order, under the plan\'s own keys', () => {
  const lines = gameSelectionLines().join('\n');
  let at = -1;
  for (const r of registry.selection.rules) {
    const i = lines.indexOf(`${r.when} → ${keyFor[r.use]}`);
    assert.ok(i > at, `rule for ${r.use} missing or out of order`);
    at = i;
  }
  assert.match(lines, new RegExp(`\\b${keyFor[registry.selection.fallback]}\\b`), 'the fallback is stated');
});

test('there is one copy of the mapping, not a registry and a hand-written paraphrase', () => {
  const src = readFileSync(join(process.cwd(), 'src/lib/server/lesson/prep.ts'), 'utf8');
  assert.doesNotMatch(src, /בחר\/י לפי מטרת התרגול/);
});

test('the registry no longer claims to be unenforced', () => {
  assert.doesNotMatch(registry.selection.$comment, /NOT ENFORCED/);
});

test('every plan says how long its deck is, and longer lessons get longer decks', () => {
  const counts = PLANS.map(p => p.slides);
  for (const n of counts) assert.ok(Number.isInteger(n) && n >= 4, 'validateLesson refuses fewer than 4');
  assert.deepEqual([...counts].sort((a, b) => a - b), counts);
  assert.equal(PLANS.find(p => p.minutes === 45).slides, 8);
  assert.equal(PLANS.find(p => p.minutes === 135).slides, 14);
});

test('the slide instruction follows the plan, and keeps the old range when there is none', () => {
  assert.equal(slideTarget(45), 'בערך 8 שקפים');
  assert.equal(slideTarget(135), 'בערך 14 שקפים');
  assert.equal(slideTarget(undefined), '6-10 שקפים');
  assert.equal(slideTarget(50), '6-10 שקפים', 'a duration with no plan is not guessed at');
});
