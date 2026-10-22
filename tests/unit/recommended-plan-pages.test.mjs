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

test('on a phone the continue bar sticks, and the selection ring is solid', () => {
  const cardRule = booking.slice(booking.indexOf('.dur-card.selected'), booking.indexOf('.dur-card:focus-visible'));
  assert.match(cardRule, /0 0 0 3px var\(--accent\)/);
  assert.doesNotMatch(cardRule, /accent-dim/);
  const badge = booking.slice(booking.indexOf('.dur-badge {'), booking.indexOf('.dur-icon'));
  const chosen = booking.slice(booking.indexOf('.dur-chosen {'), booking.indexOf('.plan-continue'));
  assert.match(badge, /font-size:\s*0\.8rem/);
  assert.match(chosen, /font-size:\s*0\.8rem/);
  assert.doesNotMatch(booking, /plan-pitch|RECOMMENDED_PITCH/);
  assert.match(booking, /position:\s*sticky/);
  assert.match(booking, /padding-bottom: calc\(0\.9rem \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(booking, /#step-duration \{ padding-bottom: calc\(4\.25rem \+ env\(safe-area-inset-bottom\)\)/);
});

test('booking pre-selects the recommended plan and advances only from continue', () => {
  // A card click used to set the plan and leave the step in one function.
  // Pre-selecting inside that function would have skipped the choice.
  assert.match(booking, /PLANS\.find\(\(p\) => p\.recommended\)/);
  assert.match(booking, /function continueWithPlan\(\)/);
  assert.match(booking, /class="btn-primary plan-continue"/);
  assert.doesNotMatch(booking, /function selectPlan/);
  assert.doesNotMatch(booking, /onclick=\{\(\) => selectPlan/);
});

test('the landing cards keep each plan description, and the pitch line is gone', () => {
  assert.match(landing, /plan\.description/);
  assert.doesNotMatch(landing, /RECOMMENDED_PITCH|pricing-pitch/);
  assert.doesNotMatch(booking, /RECOMMENDED_PITCH|plan-pitch/);
});
