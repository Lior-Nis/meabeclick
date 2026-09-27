// tests/unit/booking-page-honesty.test.mjs
//
// The booking page must not invent availability, and must not render a
// degraded calendar read as a clean one.
//
// /api/availability already answers honestly — it returns `calendars` and
// `calendarFailures` so a caller can tell a partial read from a complete
// one (tests/characterization/availability-degraded.test.mjs). Nothing read
// those fields. That is the same shape as the three production bugs in
// src/lib/server/storage-inventory.ts: a value nobody consumes, where the
// absence of a signal is indistinguishable from the absence of a problem.
//
// Worse, every failure path ended in generateLocalSlots() — a weekly
// availability table hardcoded in the client, with a BLOCKED_DATES list of
// 2026 holidays that had already passed. When the calendar could not be
// read, a parent was shown invented times and could book any of them. The
// task this fixes names that exactly: "בלי להסתיר כשל מאחורי לוח זמנים
// שנראה תקין" — without hiding a failure behind a schedule that looks fine.
//
// Asserted against the source rather than a rendered page because the
// behaviour is client-side and conditional: the harness can fetch the HTML,
// but not the branch taken after a failed fetch in the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const page = readFileSync(join(ROOT, 'src/routes/booking/+page.svelte'), 'utf8');

test('the booking page carries no hardcoded availability table', () => {
  // Anchor on the data itself, not on the function name: renaming
  // generateLocalSlots would not make invented slots honest.
  assert.doesNotMatch(page, /BLOCKED_DATES/,
    'a hardcoded holiday list is availability nobody maintains');
  assert.doesNotMatch(page, /const WINDOWS\b/,
    'a hardcoded weekly window table is invented availability');
  // The tell-tale shape of the old table: rows of [hour, minute, hour, minute].
  assert.doesNotMatch(page, /\[\s*\d{1,2}\s*,\s*\d{1,2}\s*,\s*\d{1,2}\s*,\s*\d{1,2}\s*\]/,
    'no literal time-window rows may remain');
});

test('the booking page reads the honesty fields the endpoint returns', () => {
  assert.match(page, /calendarFailures/,
    'a partial read must be noticed by the page that renders it');
  assert.match(page, /calendarConnected/,
    'an unconfigured calendar must be noticed too');
});

test('a degraded read reaches the family as words, not as silence', () => {
  // The state exists and is rendered. A flag consumed but never shown would
  // be the same bug one layer up.
  assert.match(page, /slotState\s*=\s*\$state<[^>]*'unconfirmed'/,
    'degraded must be a first-class slot state, not a boolean nobody renders');
  assert.match(page, /slotState === 'unconfirmed'/,
    'the template must have a branch for it');
});
