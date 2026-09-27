/**
 * Moving between two games without a full page load.
 *
 * /app/play/[template] picks a component from `data.template` and hands it
 * `data.gameData`. Every one of the twelve templates reads that prop ONCE
 * at init — `const questions = data.questions ?? []` in Quiz.svelte, and
 * the same shape in the other eleven — and keeps its progress in $state
 * initialised to zero. svelte-check has been saying so for a while, in
 * nineteen `state_referenced_locally` warnings that sat in the accepted
 * baseline.
 *
 * That is fine as long as every game gets a fresh component. It does not,
 * when a child opens a second game of the SAME template: SvelteKit
 * navigates on the client, `data` changes, the derived `Board` is still
 * Quiz, so Svelte reuses the instance and only updates its prop — which
 * the component never re-reads.
 *
 * Reproduced in a browser on 2026-09-21, navigating quiz→quiz: the URL,
 * the page title and the header all said the second game, while the
 * question on screen was the first game's. The timer kept counting from
 * the first game too, because GameShell's `secs` is its own $state.
 *
 * It is not cosmetic. GameShell reports the result against the `dataId`
 * prop it was given — the NEW game — so a child answering the old game's
 * questions has their score written to the new game's record.
 *
 * Keying on the dataset destroys and rebuilds the whole shell, which is
 * what makes this one line fix all twelve templates and the timer at once,
 * rather than twelve separate $derived rewrites.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const page = readFileSync(join(root, 'src/routes/app/play/[template]/+page.svelte'), 'utf8');

test('a new dataset gets a new game, not a reused one', () => {
  // Tolerant of a template literal in the key, whose `${...}` carries its
  // own braces.
  const keyed = /\{#key .*data\.dataId.*/.exec(page);
  assert.ok(
    keyed,
    'without {#key data.dataId} a client-side move between two games of the same '
    + 'template keeps the first game on screen under the second game\'s name',
  );

  // The key has to be OUTSIDE GameShell: the shell owns the clock and the
  // result it files. Keying only the inner <Board> would hand the second
  // game the first game's running timer.
  const keyAt = page.indexOf(keyed[0]);
  const shellAt = page.indexOf('<GameShell');
  assert.ok(shellAt > keyAt, 'the key must wrap GameShell, not just the board inside it');
});

test('every template still reads its data once, which is why the key matters', () => {
  // Not a rule against it — reading a prop once is ordinary. This pins the
  // ASSUMPTION the fix relies on: if a template is ever rewritten to track
  // its prop reactively, that is fine, but the key is still what resets the
  // clock and the score, so it must not be removed as newly redundant.
  const games = readdirSync(join(root, 'src/lib/games'))
    .filter(f => f.endsWith('.svelte') && f !== 'GameShell.svelte');
  assert.ok(games.length >= 12, `expected the full template set, found ${games.length}`);

  const readsPropAtInit = games.filter(f => {
    const src = readFileSync(join(root, 'src/lib/games', f), 'utf8');
    return /^\s*const\s+\w+\s*=\s*\(?\s*data\./m.test(src);
  });
  assert.ok(
    readsPropAtInit.length > 0,
    'if no template captures data at init any more, re-check whether the key is still load-bearing '
    + '(it is, for GameShell\'s timer and the per-template score state)',
  );
});
