/**
 * No personal calendar identifier lives in the availability route.
 *
 * Its Google Calendar API fallback once carried six of Nicole's own
 * calendar ids as literals (found 2026-09-20), then read them from
 * AVAILABILITY_CALENDAR_IDS. Migration 029 removed that fallback: every
 * tutor who is offered reads their own private iCal addresses from their
 * row (tutor-settings.ts), so there is no global list left. This keeps the
 * route from growing one back.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const route = readFileSync(join(root, 'src/routes/api/availability/+server.ts'), 'utf8');

test('no personal calendar identifier is hardcoded in the route', () => {
  const addresses = route.match(/['"][A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}['"]/g) ?? [];
  assert.deepEqual(addresses, [],
    'a calendar id is a personal identifier — it belongs on the tutor\'s row, not in a commit');
});

test('the route reads no calendar list from the environment', () => {
  assert.doesNotMatch(route, /process\.env/, "busy times are per tutor, from their row");
});
