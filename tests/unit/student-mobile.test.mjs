// tests/unit/student-mobile.test.mjs
//
// Two defects found by driving the student portal at 320px, the narrowest
// width the house rules cover (Todoist id:6hR9Mx2Rpv3j9PqH).
//
// Source assertions, because the failures are layout and this repo has no
// browser runner. They pin the two CSS declarations that stop the bugs
// recurring; the measurements that found them are in the PR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const page = readFileSync(join(ROOT, 'src/routes/app/student/+page.svelte'), 'utf8');

/** The body of one CSS rule, by selector. */
function rule(selector) {
  const i = page.indexOf(`\n  ${selector} {`);
  if (i === -1) return null;
  return page.slice(i, page.indexOf('}', i));
}

test('the ask input can shrink, so the send button stays on screen', () => {
  // A flex item defaults to min-width: auto, so `flex: 1` alone does not
  // let it shrink below its content. The send button sets flex-shrink: 0,
  // so the row stayed wider than a 320px screen and pushed the BUTTON
  // 11px off the edge — worst exactly when the keyboard is open and the
  // child is reaching for it.
  const input = rule('input');
  assert.ok(input, 'could not find the ask input rule');
  assert.match(input, /min-width:\s*0/,
    'without min-width: 0 the row overflows and the page scrolls sideways');
});

test('the send button still refuses to shrink', () => {
  // The other half of the pair. If this ever loses flex-shrink: 0 the
  // button squashes instead of the input, which is a different bad outcome
  // rather than a fix.
  const btn = rule('.btn');
  assert.match(btn, /flex-shrink:\s*0/);
});

test('the links out of the portal are full-size tap targets', () => {
  // They were 36 and 37px. These are the two links that lead OUT of a dead
  // end — back to the parent board, or booking another lesson — so missing
  // them is the worst moment for a child to be fumbling.
  const backlink = rule('.backlink');
  assert.ok(backlink, 'could not find .backlink');
  assert.match(backlink, /min-height:\s*44px/);
  assert.match(backlink, /inline-flex|flex/,
    'min-height does nothing on an inline element without a flex display');
});
