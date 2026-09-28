/**
 * Games, from the pre-launch review, 2026-09-28 (Todoist 6hfCvVhH7QRwv5MH):
 * right and wrong were told by colour alone, and nothing was said to a
 * screen reader — no game had a live region.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f) => readFileSync(join(process.cwd(), f), 'utf8');
const game = (name) => read(`src/lib/games/${name}.svelte`);
const E = await import('../../src/lib/games/engine.ts');

const TEMPLATES = ['Quiz', 'TwoTruths', 'SpeedDrill', 'Sort', 'GraphMatch', 'ErrorHunt', 'NumberLine', 'Matching', 'Sequence', 'Memory', 'Table', 'Labelling'];

test('a verdict says right or wrong first, the right answer only when it was missed, then the note', () => {
  assert.equal(E.verdict(true), 'נכון!');
  assert.equal(E.verdict(true, { answer: '12', note: 'כי 3 כפול 4.' }), 'נכון! כי 3 כפול 4.');
  assert.equal(E.verdict(false), 'לא נכון.');
  assert.equal(E.verdict(false, { answer: '12', note: 'כי 3 כפול 4.' }), 'לא נכון. התשובה: 12. כי 3 כפול 4.');
});

test('every game has one polite live region, and says what happened after each answer', () => {
  const shell = read('src/lib/games/GameShell.svelte');
  // Outside {#if !done}: a region inserted together with its text is not read.
  const region = shell.indexOf('aria-live="polite"');
  assert.ok(region > 0, 'GameShell has a live region');
  assert.ok(region < shell.indexOf('{#if !done}'), 'the region exists before any game renders');
  assert.match(shell, /say,/, 'say() reaches the templates through the context');
  for (const name of TEMPLATES) assert.match(game(name), /engine\.say\(/, `${name} says what happened`);
});

test('the finish screen takes the focus, so a keyboard or screen-reader user is not left on a removed button', () => {
  const shell = read('src/lib/games/GameShell.svelte');
  assert.match(shell, /id="done"[^>]*tabindex="-1"|tabindex="-1"[^>]*id="done"/);
  assert.match(shell, /doneEl\?\.focus\(\)/);
});

test('right and wrong are marked by a sign as well as a colour', () => {
  const marked = {
    Quiz: /o\.state === 'correct'\}<span class="mark">✓<\/span>\{:else if o\.state === 'wrong'\}<span class="mark">✗<\/span>/,
    TwoTruths: /it\.state === 'wrong'\}<span class="mark">✗<\/span>/,
    SpeedDrill: /o\.state === 'correct'\}<span class="mark">✓<\/span>\{:else if o\.state === 'wrong'\}<span class="mark">✗<\/span>/,
    Sort: /b\.state === 'right'\}<span class="mark">✓<\/span>\{:else if b\.state === 'wrong'\}<span class="mark">✗<\/span>/,
    GraphMatch: /o\.state === 'correct'\}<span class="mark">✓<\/span>\{:else if o\.state === 'wrong'\}<span class="mark">✗<\/span>/,
    ErrorHunt: /s\.state === 'found'\}<span class="mark">✓<\/span>\{:else if s\.state === 'missed'\}<span class="mark">✗<\/span>/,
    Matching: /c\.state === 'done'\}<span class="mark">✓<\/span>\{:else if c\.state === 'miss'\}<span class="mark">✗<\/span>/,
    Sequence: /s\.state === 'miss' \? '✗' : '\?'/,
    Memory: /c\.matched\}<span class="mark">✓<\/span>\{:else if c\.wrong\}<span class="mark">✗<\/span>/,
  };
  for (const [name, re] of Object.entries(marked)) assert.match(game(name), re, `${name} marks its answers`);
});

test('the table marks a wrong cell for every reader, and names each cell by row and column', () => {
  const t = game('Table');
  assert.match(t, /aria-invalid=\{checked && b\.state === 'wrong'\}/);
  assert.match(t, /aria-label=\{`\$\{r\.label\}, \$\{cols\[ci\]\}`\}/);
  assert.doesNotMatch(t, /האדומים/, '"fix the red ones" is an instruction by colour');
});

test('a wrong label is said in words, not only a red flash', () => {
  assert.match(game('Labelling'), /tell\('לא התווית הזאת — נסו אחרת'\)/);
});
