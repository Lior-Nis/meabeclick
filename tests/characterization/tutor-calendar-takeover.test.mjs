// tests/characterization/tutor-calendar-takeover.test.mjs
//
// The first boot after migration 029: the default tutor's row takes over
// CALENDAR_ID / CALENDAR_ICS_URLS, and CALENDAR_ID is no longer required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer } from './harness.mjs';

test("on boot the default tutor's row takes over CALENDAR_ID and CALENDAR_ICS_URLS", async () => {
  const { dbPath, stop } = await startServer({ env: { CALENDAR_ID: 'lessons@example.com' } });
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare(`SELECT id, calendar_id, busy_ics FROM teachers ORDER BY id`).all();
    db.close();
    assert.equal(rows[0].calendar_id, 'lessons@example.com');
    assert.match(rows[0].busy_ics, /^http:\/\/127\.0\.0\.1:\d+\/nikol\.ics$/, "the harness's empty feed");
    assert.equal(rows[1].calendar_id, null, 'nobody else is touched');
  } finally { await stop(); }
});

test('the server boots without CALENDAR_ID now', async () => {
  const { baseUrl, stop } = await startServer({ env: { CALENDAR_ID: '' } });
  try {
    assert.equal((await fetch(`${baseUrl}/api/me`)).status, 200);
  } finally { await stop(); }
});
