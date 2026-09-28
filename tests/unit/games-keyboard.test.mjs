/**
 * NumberLine and Labelling could only be played with a pointer: the line
 * took pointerdown/pointermove and nothing else, and the diagram's parts were
 * SVG shapes with click listeners. Todoist 6hfHrC2VgpWJM62H, found while
 * fixing the games' accessibility (#6).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f) => readFileSync(join(process.cwd(), f), 'utf8');
const E = await import('../../src/lib/games/engine.ts');

test('arrow keys move the marker a step; the line runs left to right, so → is larger', () => {
  assert.equal(E.nudge(null, 'ArrowRight', -3, 3, 0.2), 0, 'an unplaced marker starts in the middle');
  assert.equal(E.nudge(1, 'ArrowRight', -3, 3, 0.5), 1.5);
  assert.equal(E.nudge(1, 'ArrowLeft', -3, 3, 0.5), 0.5);
  assert.equal(E.nudge(1, 'PageUp', -3, 3, 0.1), 2, 'ten steps');
  assert.equal(E.nudge(1, 'Home', -3, 3, 0.1), -3);
  assert.equal(E.nudge(1, 'End', -3, 3, 0.1), 3);
  assert.equal(E.nudge(2.9, 'ArrowRight', -3, 3, 0.5), 3, 'kept on the line');
  assert.equal(E.nudge(0.1, 'ArrowRight', 0, 1, 0.1), 0.2, 'no float drift: 0.1 + 0.1 is 0.2');
  assert.equal(E.nudge(1, 'Tab', -3, 3, 0.1), null, 'not a key the line uses');
});

test('the number line is a slider a keyboard can move and check', () => {
  const s = read('src/lib/games/NumberLine.svelte');
  assert.match(s, /role="slider"/);
  assert.match(s, /tabindex="0"/);
  assert.match(s, /aria-valuemin=\{lo\}/);
  assert.match(s, /aria-valuemax=\{hi\}/);
  assert.match(s, /aria-valuetext=/);
  assert.match(s, /onkeydown=\{onLineKey\}/);
  assert.match(s, /nudge\(guess, e\.key/);
  assert.match(s, /e\.key === 'Enter'/);
});

test("the diagram's parts are buttons a keyboard can reach, named without giving the answer away", () => {
  const s = read('src/lib/games/Labelling.svelte');
  assert.match(s, /setAttribute\('tabindex', '0'\)/);
  assert.match(s, /setAttribute\('role', 'button'\)/);
  assert.match(s, /setAttribute\('aria-label', `חלק \$\{/);
  assert.match(s, /addEventListener\('keydown'/);
  assert.match(s, /:focus-visible/);
});
