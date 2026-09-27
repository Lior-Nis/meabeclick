// tests/unit/parent-portal-navigation.test.mjs
//
// The parent portal must load a child's board when the NAVIGATION changes,
// not only when the component mounts.
//
// The bug (Todoist id:6hW962W25vCfcfrq, p1): a parent booked a lesson,
// landed on the family overview, tapped their child, and got a spinner that
// never resolved. Refreshing fixed it. Reproduced in a browser against the
// production build: tapping a child navigated to /app/parent?s=<code>,
// SvelteKit re-ran the server load and swapped `data` — and made **zero**
// requests to /api/portal. Not a failed fetch; an uncalled function.
//
// The cause was `onMount`. /app/parent → /app/parent?s=<code> is a
// navigation within the SAME route, so SvelteKit reuses the component
// instance: `load` re-runs, `data` updates, and `onMount` does not fire
// again. A full reload remounts, which is exactly why refreshing appeared
// to fix it — and why the sibling <select>, which calls openStudent
// directly, worked the whole time.
//
// This is asserted against the source, and that is a weaker test than the
// browser reproduction that found it. The repo has no Playwright, jsdom or
// vitest, and adding a browser runner to CI is not something a p1 bugfix
// should drag in. So this pins the one property that distinguishes the bug
// from the fix — is the data load driven by navigation, or by mount? — and
// the end-to-end proof lives in the PR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const page = readFileSync(join(ROOT, 'src/routes/app/parent/+page.svelte'), 'utf8');

/** The `$effect(() => { ... })` block that opens a child's board. */
function boardEffect(src) {
  const start = src.indexOf('$effect(');
  if (start === -1) return null;
  // Brace-match from the effect's opening paren so the body is exact,
  // rather than grabbing a fixed number of characters and hoping.
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}

test('opening a child is driven by navigation, not by mount', () => {
  const effect = boardEffect(page);
  assert.ok(effect, 'the board load must live in an $effect');
  assert.match(effect, /openStudent\(/,
    'the effect must be what opens a child, or it is not the thing that reacts to navigation');
  assert.match(effect, /data\.selected/,
    'it must read the child named by the server load, so a same-route navigation re-runs it');
});

test('openStudent is not reached from onMount alone', () => {
  // The regression would be someone reinstating a mount-only load. onMount
  // may legitimately return for other work; what must never come back is
  // onMount being the thing that opens the board.
  const start = page.indexOf('onMount(');
  if (start === -1) return; // no onMount at all is the stronger outcome
  const body = page.slice(start, start + 600);
  assert.doesNotMatch(body, /openStudent\(/,
    'onMount does not re-run on a same-route navigation — /app/parent → /app/parent?s=<code>');
});

test('the family overview is still reachable without fetching a board', () => {
  const effect = boardEffect(page);
  assert.match(effect, /overview/,
    'the overview branch must end the spinner rather than fetching a child');
});
