/**
 * Where the availability fallback gets its calendar list.
 *
 * `/api/availability` has two sources of "when is Nicole busy": the iCal
 * feeds in CALENDAR_ICS_URLS (the configured path), and a Google Calendar
 * API path used only when no iCal feed is set and GOOGLE_API_KEY is.
 *
 * That second path carried its calendar list as a literal in the route:
 * six of Nicole's own calendar identifiers, including her personal Gmail
 * address and her university address. Committed, pushed,
 * cloned, and read by an agent on every session that greps the tree.
 *
 * Todoist `id:6hMjCvfjpp2Vm5hq` asks for student and payment records to
 * leave the code repo. Its design note claims, as a done-condition, that
 * no personal detail appears in any tracked file — "checked, not assumed".
 * Running that check on 2026-09-20 is what found this, so the claim was
 * assumed, and wrong.
 *
 * Measured on the box the same day: CALENDAR_ICS_URLS is set and
 * GOOGLE_API_KEY is not, so production returns before this list is ever
 * read. It was six personal identifiers in source for no behaviour at all.
 *
 * The list now comes from AVAILABILITY_CALENDAR_IDS, parsed exactly the
 * way icsUrls() parses its own variable, and is empty when unset.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const route = readFileSync(join(root, 'src/routes/api/availability/+server.ts'), 'utf8');

const { availabilityCalendarIds } = await import('../../src/lib/server/calendar.ts');

test('no personal calendar identifier is hardcoded in the route', () => {
  // Any bare address in the source. The iCal path keeps its URLs in env
  // too, so there is nothing left here that legitimately looks like one.
  const addresses = route.match(/['"][A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}['"]/g) ?? [];
  assert.deepEqual(
    addresses, [],
    'a calendar id is a personal identifier — it belongs in the environment, not in a commit',
  );
});

test('the list comes from the environment, and is empty when unset', () => {
  const had = process.env.AVAILABILITY_CALENDAR_IDS;
  delete process.env.AVAILABILITY_CALENDAR_IDS;
  try {
    assert.deepEqual(availabilityCalendarIds(), []);
  } finally {
    if (had !== undefined) process.env.AVAILABILITY_CALENDAR_IDS = had;
  }
});

test('it splits on commas and whitespace, like icsUrls does', () => {
  const had = process.env.AVAILABILITY_CALENDAR_IDS;
  process.env.AVAILABILITY_CALENDAR_IDS = ' a@example.com, b@example.com\nc@example.com ';
  try {
    assert.deepEqual(availabilityCalendarIds(), ['a@example.com', 'b@example.com', 'c@example.com']);
  } finally {
    if (had === undefined) delete process.env.AVAILABILITY_CALENDAR_IDS;
    else process.env.AVAILABILITY_CALENDAR_IDS = had;
  }
});

test('an unconfigured list cannot silently report every hour free', () => {
  // The route already refuses to guess when nothing is configured. With the
  // literals gone, an empty AVAILABILITY_CALENDAR_IDS is that same "nothing
  // configured" case and must take the same branch, not fetch zero
  // calendars and call the result a clean read.
  assert.match(
    route,
    /if \(!apiKey \|\| !calendarIds\.length\)/,
    'no key OR no calendar ids must both reach the "nothing configured" answer',
  );
});
