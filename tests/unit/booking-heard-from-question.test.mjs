// tests/unit/booking-heard-from-question.test.mjs
//
// "איך שמעתם עלינו?" — the marketing funnel's self-report question
// (docs/superpowers/specs/2026-09-24-marketing-funnel-design.md), asked
// once in the booking details step. Optional: a parent who skips it must
// still be able to book (see the characterization test "a booking without
// attribution still succeeds").
//
// The five value→label pairs themselves now live in one place,
// src/lib/marketing-labels.ts (HEARD_FROM_OPTIONS) — api/book's server-side
// validation, this page's <select> and the /app/marketing report all read
// the same array, rather than each carrying its own copy that could drift.
// This test checks that shared list directly (a stable data contract: five
// values, five Hebrew labels) and checks the page source only for the
// structural fact that it renders FROM that list, not for the labels a
// second time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const page = readFileSync(join(ROOT, 'src/routes/booking/+page.svelte'), 'utf8');
const { HEARD_DETAIL_MAX, HEARD_FROM_OPTIONS } = await import('../../src/lib/marketing-labels.ts');

// The choices the booking question shows. Stored values stay the original
// keys (`instagram` still labels rows saved before the wording widened).
const EXPECTED = [
  ['friend', 'חבר/ה המליץ/ה'],
  ['google', 'גוגל'],
  ['instagram', 'פייסבוק/אינסטגרם'],
  ['school', 'בית הספר'],
  ['other', 'אחר'],
];

test('HEARD_FROM_OPTIONS is exactly the five spec\'d values with their Hebrew labels', () => {
  assert.deepEqual(HEARD_FROM_OPTIONS.map(o => [o.value, o.label]), EXPECTED);
});

test('the booking page asks "איך שמעתם עלינו?"', () => {
  assert.match(page, /איך שמעתם עלינו/);
});

test('the question\'s <select> renders its options from the shared HEARD_FROM_OPTIONS list', () => {
  assert.match(page, /import\s*\{[^}]*\bHEARD_FROM_OPTIONS\b[^}]*\}\s*from\s*'\$lib\/marketing-labels\.ts'/,
    'the page must import the shared list rather than hand-writing its own <option>s');
  assert.match(page, /<select id="inp-heard-from"[^>]*>[\s\S]{0,200}?\{#each HEARD_FROM_OPTIONS as opt[^}]*\}[\s\S]{0,120}?<\/select>/,
    'the select must iterate HEARD_FROM_OPTIONS, not a hardcoded option list');
});

test('the question is optional — no field named heardFrom is in the required-field list', () => {
  assert.match(page, /heardFrom/, 'the page must bind a heardFrom field');
  // isComplete() on the server (api/book) never mentions heardFrom, and the
  // client-side validators (validatePane1/validatePane2) must not either —
  // an unanswered marketing question can never block a booking.
  assert.doesNotMatch(page, /next\.heardFrom/, 'heardFrom must never be validated as required');
});

// PR1 fix wave, item 2: the tutor already knows how she reached a returning
// family — the question exists to find out for a FIRST booking, not to be
// re-asked of someone whose account already exists.
test('the question does not render for a known (returning) family', () => {
  assert.match(page, /\{#if !data\.known\}[\s\S]{0,400}?<label for="inp-heard-from">/,
    'the label/select must be gated behind `{#if !data.known}`, the same condition ' +
    'the page already uses elsewhere to detect a returning family');
});

test('אחר reveals an optional free-text field, and skipping it cannot block a booking', () => {
  assert.equal(HEARD_DETAIL_MAX, 80);
  assert.match(page, /\{#if heardFrom === 'other'\}[\s\S]{0,400}?id="inp-heard-detail"[\s\S]{0,200}?maxlength=\{HEARD_DETAIL_MAX\}/);
  assert.match(page, /heardFrom === 'other' && heardDetail\.trim\(\)/,
    'the free text is sent only with אחר, and only when the family typed something');
  assert.doesNotMatch(page, /next\.heardDetail/, 'the free text must never be validated as required');
  assert.match(page, /אפשר לדלג/);
});

test('the booking page records start, the chosen plan, the time, and the submitted details', () => {
  assert.match(page, /track\('booking_start'\)/);
  assert.equal((page.match(/track\('plan_selected'/g) || []).length, 1, 'plan_selected fires once');
  assert.match(
    page,
    /function continueWithPlan\(\) \{[^}]*track\('plan_selected', \{ detail: selectedPlan\.kind \}\)/,
    'plan_selected fires from continueWithPlan with the selected plan',
  );
  assert.match(page, /track\('time_selected'\)/);
  assert.match(page, /track\('booking_submitted'\)/);
  const landing = readFileSync(join(ROOT, 'src/routes/+page.svelte'), 'utf8');
  assert.match(landing, /track\('landing_visit'\)/);
  const book = readFileSync(join(ROOT, 'src/routes/api/book/+server.ts'), 'utf8');
  assert.match(book, /event: 'lesson_scheduled'/);
});
