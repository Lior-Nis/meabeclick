/**
 * The marketing funnel's event store: what a visitor did. Anonymous until a
 * booking links its `visitor_id` to a `bookings_v2` row (the server-written
 * `lesson_scheduled` event's `booking_id` — see migration 016) — and even
 * then a raw event row still holds no name, phone, email or IP, just that
 * link. Raw events are deleted after 365 days regardless (`pruneEvents`,
 * below); deleting a student or account does not touch `source_utm` or
 * `marketing_events` (nothing here has a foreign key to either), and that
 * gap is what the 365-day retention exists to close on its own schedule.
 *
 * See migration 016 for the table and why it can never hold a name, phone,
 * email, IP or message text. This module is the ONLY writer, and it
 * validates before it ever reaches SQL — `recordEvent` returns `false` and
 * writes nothing for an invalid event or target, rather than letting the
 * table's own CHECK constraints turn a bad call into a thrown exception
 * that `/api/events` (task 2) would then have to catch on every request.
 * The CHECKs stay in the schema anyway, as the backstop every other write
 * path in this app gets — see materials.ts's `kind`/`origin`.
 */
import { handle } from './db.ts';

export type MarketingEventName =
  | 'landing_visit'
  | 'cta_click'
  | 'booking_started'
  | 'booking_submitted'
  | 'lesson_scheduled';

export type MarketingTarget = 'booking' | 'whatsapp' | 'phone';

const EVENTS: ReadonlySet<string> = new Set([
  'landing_visit', 'cta_click', 'booking_started', 'booking_submitted', 'lesson_scheduled',
]);
const TARGETS: ReadonlySet<string> = new Set(['booking', 'whatsapp', 'phone']);

/** Caps every free-text field at 100 characters — this is the actual
 *  enforcement (via `trimmed`, below), not `/api/events`, which validates
 *  shape but never truncates. `/api/book/+server.ts`'s `ATTRIBUTION_MAX_LEN`
 *  keeps the same number, so an attribution value that survives sanitizing
 *  there always fits the `marketing_events` row the server-written
 *  `lesson_scheduled` event copies it into. */
const MAX_LEN = 100;

function trimmed(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, MAX_LEN) : null;
}

/**
 * What a visitor id minted by src/lib/marketing.ts's `initMarketing`
 * (`crypto.randomUUID()`) looks like: 36 hex/dash characters. Both public
 * write paths that accept a client-supplied visitorId — `/api/events`
 * (task 4) and `/api/book`'s attribution sanitizer — validate against this
 * before the value ever reaches here, so a malformed value (a probe's
 * crafted string, a stale or hand-built client) is silently treated as "no
 * visitor id", the same tolerant posture as every other field either of
 * those endpoints rejects.
 */
export const VISITOR_ID_RE = /^[0-9a-f-]{36}$/i;

/**
 * Keeps only the path itself from a client-supplied `path` — the part
 * before any `?` (query) or `#` (fragment) — and requires it start with
 * `/`; a value that survives with none of that is not a path this app would
 * ever generate, so it is dropped (`undefined`) rather than stored as given
 * (task 3). Exported so `/api/events` can call it directly — a
 * `+server.ts` may only export HTTP method handlers, the same reason
 * events-rate-limit.ts's sweep function lives outside that file too.
 */
export function sanitizePath(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  const stripped = v.split(/[?#]/, 1)[0];
  return stripped.startsWith('/') ? stripped : undefined;
}

export interface RecordEventInput {
  event: string;
  target?: string | null;
  path?: string | null;
  visitorId?: string | null;
  utm?: {
    source?: string | null;
    medium?: string | null;
    campaign?: string | null;
    content?: string | null;
  };
  bookingId?: number | null;
  /** ISO timestamp. Defaults to now — a caller only ever overrides this in
   *  a test, so `pruneEvents` and `funnel` can be exercised deterministically. */
  at?: string;
}

/**
 * Validates and inserts one event. Returns `false` and writes nothing for
 * any invalid event name or target — including a target present on an
 * event other than `cta_click`, which the spec states is never valid. A
 * caller (the beacon endpoint, `/api/book`) never has to branch on the
 * failure: it can treat `false` exactly like "did not track", which is
 * already the tolerated outcome everywhere measurement touches the site.
 */
export function recordEvent(e: RecordEventInput): boolean {
  if (!EVENTS.has(e.event)) return false;
  if (e.target != null) {
    if (!TARGETS.has(e.target)) return false;
    if (e.event !== 'cta_click') return false;
  }

  handle().prepare(`
    INSERT INTO marketing_events
      (at, visitor_id, event, target, path, utm_source, utm_medium, utm_campaign, utm_content, booking_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    e.at ?? new Date().toISOString(),
    trimmed(e.visitorId),
    e.event,
    trimmed(e.target ?? null),
    trimmed(e.path),
    trimmed(e.utm?.source),
    trimmed(e.utm?.medium),
    trimmed(e.utm?.campaign),
    trimmed(e.utm?.content),
    e.bookingId ?? null,
  );
  return true;
}

/** Deletes rows older than 365 days (the spec's retention line) and
 *  returns how many were removed, so `/api/events` (task 2) can log it
 *  without a second query. `now` is a parameter rather than `new Date()`
 *  read internally, so a caller — this module's own tests, and the
 *  once-per-process-day check in task 2 — controls what "365 days ago"
 *  means instead of the test suite racing the real clock. */
export function pruneEvents(now: Date): number {
  const cutoff = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const result = handle().prepare(`DELETE FROM marketing_events WHERE at < ?`).run(cutoff);
  return Number(result.changes);
}

// A `type`, not an `interface`: node:sqlite's `.all()` returns
// `Record<string, SQLOutputValue>[]`, and TypeScript's assertion
// comparability check for that index-signature source type only sees
// through to a plain object type literal — an `interface` target makes the
// same `as FunnelRow[]` fail with "neither type sufficiently overlaps".
// Every other row shape in this codebase (StudentRow, ResultRow, MaterialRow…)
// is a `type` for the same reason; keep it consistent here too.
export type FunnelRow = {
  source: string | null;
  campaign: string | null;
  content: string | null;
  visitors: number;
  bookingClicks: number;
  whatsappClicks: number;
  phoneClicks: number;
  bookingsStarted: number;
  bookings: number;
  lessonsHeld: number;
};

/**
 * One row per (source, campaign, content), for the window [sinceIso, untilIso].
 *
 * A NULL utm_source groups together on its own — SQLite's GROUP BY treats
 * NULL as one group like any other value, so "direct / untagged" traffic
 * falls out of the query for free rather than needing a COALESCE that would
 * make it indistinguishable from a literal `source=null` in the data.
 *
 * `lessonsHeld` is the one column that reaches outside marketing_events: it
 * LEFT JOINs to bookings_v2 on booking_id (set only on lesson_scheduled,
 * see migration 016) so a lesson counts as held only when that booking is
 * not cancelled and its `end` is not later than `untilIso` — "already
 * happened by the time this report is asking about", not "happened by now".
 */
export function funnel(sinceIso: string, untilIso: string): FunnelRow[] {
  const rows = handle().prepare(`
    SELECT
      e.utm_source   AS source,
      e.utm_campaign AS campaign,
      e.utm_content  AS content,
      COUNT(DISTINCT CASE WHEN e.event = 'landing_visit' THEN e.visitor_id END)             AS visitors,
      COUNT(CASE WHEN e.event = 'cta_click' AND e.target = 'booking'  THEN 1 END)            AS bookingClicks,
      COUNT(CASE WHEN e.event = 'cta_click' AND e.target = 'whatsapp' THEN 1 END)            AS whatsappClicks,
      COUNT(CASE WHEN e.event = 'cta_click' AND e.target = 'phone'    THEN 1 END)            AS phoneClicks,
      COUNT(CASE WHEN e.event = 'booking_started'   THEN 1 END)                              AS bookingsStarted,
      COUNT(CASE WHEN e.event = 'lesson_scheduled'  THEN 1 END)                              AS bookings,
      COUNT(CASE WHEN e.event = 'lesson_scheduled'
                      AND b.id IS NOT NULL
                      AND b.status != 'cancelled'
                      AND b."end" <= ?
                 THEN 1 END)                                                                 AS lessonsHeld
    FROM marketing_events e
    LEFT JOIN bookings_v2 b ON b.id = e.booking_id AND e.event = 'lesson_scheduled'
    WHERE e.at >= ? AND e.at <= ?
    GROUP BY e.utm_source, e.utm_campaign, e.utm_content
  `).all(untilIso, sinceIso, untilIso) as FunnelRow[];

  return rows;
}

/**
 * The window's true distinct-visitor count — COUNT(DISTINCT visitor_id)
 * over every `landing_visit` in [sinceIso, untilIso], with no GROUP BY on
 * UTM at all.
 *
 * `funnel()`'s own `visitors` column is DISTINCT only WITHIN each
 * (source, campaign, content) group, so summing it across groups (a report
 * summary's "total visitors" line) double-counts a visitor who shows up
 * under two different UTM groups in the same window — storage cleared and
 * re-attributed mid-window, a stale first-touch expiring past its 30 days,
 * or the same person on a second device. This query has no such seam: one
 * `visitor_id` is one visitor here regardless of how many UTM groups it
 * touched, which is what a summary total needs and a per-source breakdown
 * (funnel()'s actual job) does not.
 */
export function distinctVisitors(sinceIso: string, untilIso: string): number {
  const row = handle().prepare(`
    SELECT COUNT(DISTINCT visitor_id) AS n
    FROM marketing_events
    WHERE event = 'landing_visit' AND at >= ? AND at <= ?
  `).get(sinceIso, untilIso) as { n: number };
  return Number(row.n);
}

/**
 * How bookers in [sinceIso, untilIso] answered "איך שמעתם עלינו?", keyed on
 * `bookings_v2.at` (when the booking was MADE) rather than on any
 * marketing_events row — the question lives on the booking itself
 * (migration 016's `heard_from` column), asked once, so there is no event
 * stream to aggregate here. A booking with no answer (`heard_from IS NULL`)
 * contributes no key at all: the caller's report renders "no answer" from
 * what is absent, not from a `null`/`"null"` entry that would need special-
 * casing everywhere this record is read.
 */
export function heardFromCounts(sinceIso: string, untilIso: string): Record<string, number> {
  const rows = handle().prepare(`
    SELECT heard_from AS heardFrom, COUNT(*) AS n
    FROM bookings_v2
    WHERE at >= ? AND at <= ? AND heard_from IS NOT NULL
    GROUP BY heard_from
  `).all(sinceIso, untilIso) as { heardFrom: string; n: number }[];

  const out: Record<string, number> = {};
  for (const row of rows) out[row.heardFrom] = Number(row.n);
  return out;
}
