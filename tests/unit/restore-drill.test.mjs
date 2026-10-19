// tests/unit/restore-drill.test.mjs
//
// The restore drill's smoke-test command boots today's image. Since
// migration 029 a tutor's lesson calendar lives on their row, which a
// restored database already carries, so the drill no longer passes the
// CALENDAR_ID the boot check used to demand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script = readFileSync(new URL('../../server/restore-db.sh', import.meta.url), 'utf8');

test('the restore drill does not pass a CALENDAR_ID nothing reads', () => {
  assert.doesNotMatch(script, /-e CALENDAR_ID/);
});
