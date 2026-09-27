// tests/unit/recommended-plan-pages.test.mjs
//
// Both pages that sell a plan must take the recommendation from plans.ts.
// The landing page used to hardcode `FEATURED_MINUTES = 90` and a CSS-only
// badge; the booking page recommended nothing, so a parent who went
// straight to /booking saw three identical cards.
//
// Asserted against the source (this repo has no DOM test runner); the
// rendered result is checked in a browser before the PR — see the PR body.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const landing = read('src/routes/+page.svelte');
const booking = read('src/routes/booking/+page.svelte');

test('the landing page highlights the plan plans.ts recommends, not a local constant', () => {
  assert.doesNotMatch(landing, /FEATURED_MINUTES/);
  assert.match(landing, /plan\.recommended/);
});

test('both pages print the badge from plans.ts, as text a screen reader can read', () => {
  for (const [name, src] of [['landing', landing], ['booking', booking]]) {
    assert.match(src, /RECOMMENDED_BADGE/, `${name} must import the badge copy`);
    assert.doesNotMatch(src, /content:\s*'⭐/, `${name} must not put the badge in CSS content`);
  }
});

test('the booking page marks the recommended card', () => {
  assert.match(booking, /class:recommended=\{plan\.recommended\}/);
});
