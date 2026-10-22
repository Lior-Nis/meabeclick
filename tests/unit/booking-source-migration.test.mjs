// Migration 030 rebuilds marketing_events so the funnel can name the booking
// steps, and adds the optional "אחר" text on the booking itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATIONS } from '../../src/lib/server/migrations/list.ts';

async function dbAt(version) {
  const db = new DatabaseSync(join(await mkdtemp(join(tmpdir(), 'm030-')), 'test.db'));
  db.exec('PRAGMA foreign_keys = ON');
  for (const m of MIGRATIONS.filter(m => m.version <= version).sort((a, b) => a.version - b.version)) db.exec(m.sql);
  return db;
}

test('030 keeps existing events and bookings, then accepts the new steps', async () => {
  const db = await dbAt(29);
  db.prepare(`INSERT INTO accounts (name, phone, credential, is_self, created_at) VALUES ('משפחה', NULL, 'x', 0, '2026-01-01')`).run();
  db.prepare(`INSERT INTO students_v2 (code, name, account_id, credential, created_at) VALUES ('s1', 'דנה', 1, 'x', '2026-01-01')`).run();
  db.prepare(`INSERT INTO bookings_v2 (student_id, start, "end", duration, at, status, heard_from)
              VALUES (1, '2027-01-01T10:00:00Z', '2027-01-01T10:45:00Z', 45, '2026-10-01', 'confirmed', 'instagram')`).run();
  db.prepare(`INSERT INTO marketing_events (at, visitor_id, event, utm_source)
              VALUES ('2026-10-01T00:00:00.000Z', 'v-old', 'landing_visit', 'google')`).run();

  assert.throws(() => {
    db.prepare(`INSERT INTO marketing_events (at, event, detail) VALUES ('2026-10-02T00:00:00.000Z', 'plan_selected', 'double')`).run();
  });

  db.exec(MIGRATIONS.find(m => m.version === 30).sql);

  const kept = db.prepare(`SELECT id, event, utm_source, detail, referrer FROM marketing_events`).get();
  assert.deepEqual(
    { id: kept.id, event: kept.event, utm_source: kept.utm_source, detail: kept.detail, referrer: kept.referrer },
    { id: 1, event: 'landing_visit', utm_source: 'google', detail: null, referrer: null },
  );
  const booking = db.prepare(`SELECT heard_from, heard_from_detail FROM bookings_v2`).get();
  assert.equal(booking.heard_from, 'instagram');
  assert.equal(booking.heard_from_detail, null);
  assert.ok(db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'marketing_events_at'`).get());

  db.prepare(`INSERT INTO marketing_events (at, event, detail) VALUES ('2026-10-02T00:00:00.000Z', 'plan_selected', 'double')`).run();
  db.prepare(`INSERT INTO marketing_events (at, event) VALUES ('2026-10-02T00:00:00.000Z', 'booking_start')`).run();
  db.prepare(`INSERT INTO marketing_events (at, event) VALUES ('2026-10-02T00:00:00.000Z', 'time_selected')`).run();
  assert.throws(() => {
    db.prepare(`INSERT INTO marketing_events (at, event, detail) VALUES ('2026-10-03T00:00:00.000Z', 'plan_selected', 'a name')`).run();
  });
  assert.throws(() => {
    db.prepare(`INSERT INTO marketing_events (at, event, detail) VALUES ('2026-10-03T00:00:00.000Z', 'landing_visit', 'double')`).run();
  });

  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM marketing_events`).get().n, 4);
});
