/**
 * The marketing event store: what a visitor did, kept anonymous, and the
 * funnel counted from it.
 *
 * Three things this file exists to hold the line on:
 *
 *   Nothing identifying can ever land in marketing_events — no name, phone,
 *   email, IP or message text (spec requirement 6).
 *   recordEvent validates BEFORE writing: an invalid call writes nothing,
 *   rather than trusting SQL's CHECK constraints to catch it after the fact.
 *   funnel() and heardFromCounts() are read-side aggregations a tutor will
 *   actually look at, so their grouping and counting rules are exercised
 *   directly rather than trusted by inspection.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'marketing-')), 'results.db');

const { handle } = await import('../../src/lib/server/db.ts');
const E = await import('../../src/lib/server/entities.ts');
const M = await import('../../src/lib/server/marketing.ts');

function countRows() {
  return handle().prepare(`SELECT COUNT(*) AS n FROM marketing_events`).get().n;
}

test('an invalid event name is rejected', () => {
  const before = countRows();
  assert.equal(M.recordEvent({ event: 'page_view' }), false);
  assert.equal(countRows(), before, 'nothing must be written for a rejected event');
});

test('an invalid target is rejected', () => {
  const before = countRows();
  assert.equal(M.recordEvent({ event: 'cta_click', target: 'email' }), false);
  assert.equal(countRows(), before);
});

test('a target on an event other than cta_click is rejected', () => {
  // The spec is explicit: target is NULL on everything except cta_click.
  const before = countRows();
  assert.equal(M.recordEvent({ event: 'landing_visit', target: 'booking' }), false);
  assert.equal(countRows(), before);
});

test('a valid event with a valid target is recorded', () => {
  assert.equal(M.recordEvent({ event: 'cta_click', target: 'whatsapp' }), true);
});

test('strings are trimmed to 100 characters', () => {
  const long = 'א'.repeat(150);
  const ok = M.recordEvent({
    event: 'landing_visit',
    visitorId: long,
    path: long,
    utm: { source: long, medium: long, campaign: long, content: long },
  });
  assert.equal(ok, true);

  const row = handle().prepare(
    `SELECT * FROM marketing_events WHERE event = 'landing_visit' ORDER BY id DESC LIMIT 1`
  ).get();
  assert.equal(row.visitor_id.length, 100);
  assert.equal(row.path.length, 100);
  assert.equal(row.utm_source.length, 100);
  assert.equal(row.utm_medium.length, 100);
  assert.equal(row.utm_campaign.length, 100);
  assert.equal(row.utm_content.length, 100);
});

// ── VISITOR_ID_RE and sanitizePath — the shared validation /api/events and
// /api/book's attribution sanitizer both apply to client-supplied fields
// before they ever reach recordEvent (tasks 3/4 of the PR1 fix wave). ──

test('VISITOR_ID_RE matches a crypto.randomUUID()-shaped id and rejects anything else', () => {
  assert.match('3f6a1c2e-9b7d-4e2a-8c1f-0a5b6d7e8f90', M.VISITOR_ID_RE);
  assert.match('3F6A1C2E-9B7D-4E2A-8C1F-0A5B6D7E8F90', M.VISITOR_ID_RE, 'case-insensitive');
  assert.doesNotMatch('visitor-123', M.VISITOR_ID_RE, 'too short, and not hex/dash only');
  assert.doesNotMatch('x'.repeat(36), M.VISITOR_ID_RE, '36 chars but not hex');
  assert.doesNotMatch('3f6a1c2e-9b7d-4e2a-8c1f-0a5b6d7e8f900', M.VISITOR_ID_RE, 'one char too long');
});

test('sanitizePath keeps only the path before a query or fragment, and requires a leading slash', () => {
  assert.equal(M.sanitizePath('/booking'), '/booking');
  assert.equal(M.sanitizePath('/booking?utm_source=fb'), '/booking');
  assert.equal(M.sanitizePath('/booking#pane-2'), '/booking');
  assert.equal(M.sanitizePath('/booking?utm_source=fb#pane-2'), '/booking');
  assert.equal(M.sanitizePath('booking'), undefined, 'no leading slash — dropped, not stored bare');
  assert.equal(M.sanitizePath('https://evil.example/x'), undefined, 'an absolute URL has no leading slash either');
  assert.equal(M.sanitizePath(undefined), undefined);
});

test('the table has no column that could hold identifying data', () => {
  const columns = handle().prepare(`PRAGMA table_info(marketing_events)`).all().map(c => c.name);
  const offenders = columns.filter(c => /name|phone|email|ip|message/i.test(c));
  assert.deepEqual(offenders, [], 'no column here may match this pattern');
});

test('pruneEvents removes a 366-day-old row and keeps a 364-day-old one', () => {
  const now = new Date('2027-06-15T00:00:00.000Z');
  const old = new Date(now.getTime() - 366 * 24 * 60 * 60 * 1000).toISOString();
  const recent = new Date(now.getTime() - 364 * 24 * 60 * 60 * 1000).toISOString();

  assert.equal(M.recordEvent({ event: 'landing_visit', visitorId: 'old-visitor', at: old }), true);
  assert.equal(M.recordEvent({ event: 'landing_visit', visitorId: 'recent-visitor', at: recent }), true);

  const removed = M.pruneEvents(now);
  assert.equal(removed, 1, 'only the row past the 365-day line comes out');

  const remaining = handle().prepare(`SELECT visitor_id FROM marketing_events WHERE visitor_id IN (?, ?)`)
    .all('old-visitor', 'recent-visitor').map(r => r.visitor_id);
  assert.deepEqual(remaining, ['recent-visitor']);
});

// ── funnel() ────────────────────────────────────────────────────────────

const account = E.createAccount({ name: 'משפחה', credential: 'x' });
const student = E.createStudent({ code: 'mkt-student', name: 'תלמיד', accountId: account.id, credential: 'x' });

const SINCE = '2027-01-01T00:00:00.000Z';
const UNTIL = '2027-01-31T00:00:00.000Z';
const IN_WINDOW = '2027-01-15T00:00:00.000Z';

function booking(start, end) {
  const id = E.reserveBooking({ studentId: student.id, start, end, durationMin: 45 });
  assert.ok(id, `expected a free slot at ${start}`);
  return id;
}

test('funnel groups by source/campaign/content, counts distinct visitors, splits clicks by target, and counts a lesson held only when not cancelled and past', () => {
  // Group "fb / promo / ad1": two distinct visitors, one repeat visit.
  M.recordEvent({ event: 'landing_visit', visitorId: 'v1', at: IN_WINDOW, utm: { source: 'fb', campaign: 'promo', content: 'ad1' } });
  M.recordEvent({ event: 'landing_visit', visitorId: 'v1', at: IN_WINDOW, utm: { source: 'fb', campaign: 'promo', content: 'ad1' } });
  M.recordEvent({ event: 'landing_visit', visitorId: 'v2', at: IN_WINDOW, utm: { source: 'fb', campaign: 'promo', content: 'ad1' } });

  M.recordEvent({ event: 'cta_click', target: 'booking', at: IN_WINDOW, utm: { source: 'fb', campaign: 'promo', content: 'ad1' } });
  M.recordEvent({ event: 'cta_click', target: 'booking', at: IN_WINDOW, utm: { source: 'fb', campaign: 'promo', content: 'ad1' } });
  M.recordEvent({ event: 'cta_click', target: 'whatsapp', at: IN_WINDOW, utm: { source: 'fb', campaign: 'promo', content: 'ad1' } });
  M.recordEvent({ event: 'cta_click', target: 'phone', at: IN_WINDOW, utm: { source: 'fb', campaign: 'promo', content: 'ad1' } });

  M.recordEvent({ event: 'booking_started', at: IN_WINDOW, utm: { source: 'fb', campaign: 'promo', content: 'ad1' } });

  // Three bookings scheduled in this group: one held (confirmed, past),
  // one cancelled (would otherwise be past), one confirmed but not yet past.
  const held = booking('2027-01-20T10:00:00.000Z', '2027-01-20T10:45:00.000Z');
  const cancelled = booking('2027-01-20T11:00:00.000Z', '2027-01-20T11:45:00.000Z');
  E.cancelBooking(cancelled);
  const future = booking('2027-02-15T10:00:00.000Z', '2027-02-15T10:45:00.000Z');

  M.recordEvent({ event: 'lesson_scheduled', at: IN_WINDOW, bookingId: held, utm: { source: 'fb', campaign: 'promo', content: 'ad1' } });
  M.recordEvent({ event: 'lesson_scheduled', at: IN_WINDOW, bookingId: cancelled, utm: { source: 'fb', campaign: 'promo', content: 'ad1' } });
  M.recordEvent({ event: 'lesson_scheduled', at: IN_WINDOW, bookingId: future, utm: { source: 'fb', campaign: 'promo', content: 'ad1' } });

  // A direct visitor, no UTM at all, grouped separately from "fb".
  M.recordEvent({ event: 'landing_visit', visitorId: 'v3', at: IN_WINDOW });

  // Outside the window entirely — must not be counted anywhere.
  M.recordEvent({ event: 'landing_visit', visitorId: 'v-outside', at: '2026-01-01T00:00:00.000Z', utm: { source: 'fb', campaign: 'promo', content: 'ad1' } });

  const rows = M.funnel(SINCE, UNTIL);

  const fb = rows.find(r => r.source === 'fb');
  assert.ok(fb, 'the fb/promo/ad1 group must appear');
  assert.equal(fb.campaign, 'promo');
  assert.equal(fb.content, 'ad1');
  assert.equal(fb.visitors, 2, 'v1 revisiting must not be double-counted');
  assert.equal(fb.bookingClicks, 2);
  assert.equal(fb.whatsappClicks, 1);
  assert.equal(fb.phoneClicks, 1);
  assert.equal(fb.bookingsStarted, 1);
  assert.equal(fb.bookings, 3, 'every lesson_scheduled event counts as a booking');
  assert.equal(fb.lessonsHeld, 1, 'only the confirmed, already-past lesson counts as held');

  const direct = rows.find(r => r.source === null);
  assert.ok(direct, 'a NULL source must still be grouped, not dropped');
  assert.equal(direct.visitors, 1);
});

// ── heardFromCounts() ─────────────────────────────────────────────────

test('heardFromCounts counts bookings_v2.heard_from within the window', () => {
  let hour = 0;
  const heardFromIn = (heardFrom, at) => {
    hour += 1;
    const start = `2028-03-01T${String(hour).padStart(2, '0')}:00:00.000Z`;
    const end = `2028-03-01T${String(hour).padStart(2, '0')}:45:00.000Z`;
    const id = booking(start, end);
    handle().prepare(`UPDATE bookings_v2 SET heard_from = ?, at = ? WHERE id = ?`).run(heardFrom, at, id);
    return id;
  };

  heardFromIn('friend', IN_WINDOW);
  heardFromIn('friend', IN_WINDOW);
  heardFromIn('instagram', IN_WINDOW);
  heardFromIn(null, IN_WINDOW); // declined to answer — must not appear as a key
  heardFromIn('google', '2026-01-01T00:00:00.000Z'); // outside the window

  const counts = M.heardFromCounts(SINCE, UNTIL);
  assert.equal(counts.friend, 2);
  assert.equal(counts.instagram, 1);
  assert.equal('google' in counts, false, 'a booking outside the window must not be counted');
  assert.equal('null' in counts, false);
  assert.equal(Object.prototype.hasOwnProperty.call(counts, 'undefined'), false);
});

// ── distinctVisitors() ──────────────────────────────────────────────────
//
// A window of its own (June 2027), disjoint from every other test's window
// in this file, so this test's expected counts don't depend on what any
// other test happened to write.

test('distinctVisitors counts a visitor once across the whole window, even when funnel() would count it once per UTM group', () => {
  const since = '2027-06-01T00:00:00.000Z';
  const until = '2027-06-30T00:00:00.000Z';
  const inWindow = '2027-06-15T00:00:00.000Z';

  // The bug this function fixes: the same visitor under two different
  // attribution groups. funnel()'s own `visitors` column is DISTINCT only
  // WITHIN each group, so summing it across rows counts this visitor twice.
  M.recordEvent({ event: 'landing_visit', visitorId: 'dv-multi', at: inWindow, utm: { source: 'fb', campaign: 'promo' } });
  M.recordEvent({ event: 'landing_visit', visitorId: 'dv-multi', at: inWindow, utm: { source: 'ig', campaign: 'reels' } });

  // A single-group visitor and an untagged (no UTM) visitor — both must
  // still be counted, once each.
  M.recordEvent({ event: 'landing_visit', visitorId: 'dv-single', at: inWindow, utm: { source: 'fb', campaign: 'promo' } });
  M.recordEvent({ event: 'landing_visit', visitorId: 'dv-direct', at: inWindow });

  // Outside the window — must not be counted.
  M.recordEvent({ event: 'landing_visit', visitorId: 'dv-outside', at: '2026-01-01T00:00:00.000Z', utm: { source: 'fb' } });

  // A non-landing_visit event from a visitor who never landed — must not
  // inflate the count; distinctVisitors only counts landing_visit rows.
  M.recordEvent({ event: 'cta_click', target: 'phone', visitorId: 'dv-click-only', at: inWindow, utm: { source: 'fb' } });

  assert.equal(
    M.distinctVisitors(since, until), 3,
    'dv-multi, dv-single, dv-direct — one each; dv-multi counted once despite two groups',
  );

  const summedFromFunnel = M.funnel(since, until).reduce((sum, r) => sum + r.visitors, 0);
  assert.equal(
    summedFromFunnel, 4,
    'summing funnel()\'s per-group visitors double-counts dv-multi — the exact gap distinctVisitors closes',
  );
});
