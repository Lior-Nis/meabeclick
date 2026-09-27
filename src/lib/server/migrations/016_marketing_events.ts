/**
 * Migration 016 — an events table for the marketing funnel, from a visit to
 * a lesson held.
 *
 * Todoist id:6hW8xwxJ899GP7fq and id:6hRhJv5m433H45QH, designed as one
 * subsystem in docs/superpowers/specs/2026-09-24-marketing-funnel-design.md.
 * The tool is internal on purpose: an events table in the site's own
 * SQLite, no third-party scripts and no cookies, because the whole point is
 * knowing WHERE a booking came from without collecting who the visitor is.
 *
 * ## What can never be in this table
 *
 * A name, a phone number, an email, an IP address or message text —
 * requirement 6 of the spec, and the reason marketing-store.test.mjs's own
 * test greps every column here for `/name|phone|email|ip|message/i`. There
 * is no column here that regex would catch, and there must never be one:
 * the rate limiter in /api/events (task 2) keys on IP in memory only, and
 * never writes it.
 *
 * ## `event` and `target`, and why both are CHECKed
 *
 * `event` is one of five values, chosen to name a point in the funnel
 * rather than a raw DOM action: `landing_visit`, `cta_click`,
 * `booking_started`, `booking_submitted`, `lesson_scheduled`. The funnel
 * query (marketing.ts's `funnel`) counts each of these separately, so a
 * sixth value slipping in would silently stop being counted anywhere rather
 * than erroring — the CHECK turns that into an insert failure instead.
 *
 * `target` distinguishes which CTA was clicked (`booking`, `whatsapp`,
 * `phone`) and only ever applies to `cta_click` — every other event has no
 * "which button" to record. Both halves of that rule are CHECKed: the
 * three-value enum, and that a target can only be present when the event
 * actually is `cta_click`. `recordEvent` in marketing.ts enforces the same
 * rule before it ever reaches SQL, so an invalid call returns `false`
 * rather than throwing — but the constraint stays as the backstop other
 * writers get for free, the same posture as `kind`/`origin` in
 * lesson_materials (migration 012).
 *
 * ## `visitor_id`, not a session or a login
 *
 * A random id the browser mints (src/lib/marketing.ts, task 2) — never a
 * cookie, never tied to an account, and never expired on its own. It is the
 * FIRST-TOUCH UTM stored beside it in localStorage that resets after 30
 * days, not the visitor id, which persists for as long as that browser's
 * storage does. It exists only so `funnel()` can count DISTINCT visitors
 * rather than distinct page loads; losing it (a new browser, cleared
 * storage) just starts a new visitor, which is the tracking tradeoff the
 * spec chose over fingerprinting.
 *
 * ## `booking_id`, and no foreign key
 *
 * Set only on the server-written `lesson_scheduled` event, from
 * `/api/book` (task 3), and it is what lets `funnel()` join out to
 * `bookings_v2` to ask whether the lesson is cancelled or already past. It
 * deliberately has no REFERENCES: `/api/events` is a public endpoint a
 * client can call directly, and this column exists so a bogus or replayed
 * `booking_id` on an inbound beacon fails to match anything in the join
 * instead of failing the whole insert — the same "public input degrades
 * gracefully" posture as the endpoint's blanket 204.
 *
 * ## Retention, and why this table is only anonymous UNTIL a booking
 *
 * `pruneEvents` (marketing.ts) deletes everything older than 365 days, so
 * the index on `at` is not an optimization for `funnel()` alone — it is
 * what keeps that DELETE cheap as the table grows across a year of traffic.
 *
 * A row here is anonymous right up until a `lesson_scheduled` event's
 * `booking_id` links it to a real `bookings_v2` row (see below) — and even
 * then the row itself still holds no name, phone, email or IP, only that
 * link. Deleting a student or account does not cascade into `source_utm`
 * or `marketing_events`: neither column has a foreign key to either (see
 * `booking_id`, below, and `bookings_v2`'s own migration). That link, left
 * alone, would otherwise outlive the family it points at — the 365-day
 * retention above is what actually closes that gap, on its own schedule
 * rather than on account deletion.
 *
 * ## `bookings_v2` gets its own two columns, not a join table
 *
 * `source_utm` (JSON: the first-touch UTM plus the visitor id) and
 * `heard_from` (one of five self-reported choices, or NULL) both describe
 * ONE booking and are read alongside every other booking field the tutor
 * already looks at — a separate table keyed on booking_id would only ever
 * have zero or one row and would just be `bookings_v2` split in two for no
 * reason. Nullable, and null for every existing row: a booking made before
 * this shipped was not attributed to anything, and that is a different
 * fact from "attributed to nothing" (an empty JSON object) or "the tutor
 * asked and got no answer" (heard_from present but empty) — NULL is the
 * only value that says "we were not asking yet".
 */
export const sql = `
CREATE TABLE marketing_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           TEXT    NOT NULL,
  visitor_id   TEXT,
  event        TEXT    NOT NULL CHECK (event IN (
                  'landing_visit', 'cta_click', 'booking_started',
                  'booking_submitted', 'lesson_scheduled'
                )),
  target       TEXT    CHECK (target IS NULL OR target IN ('booking', 'whatsapp', 'phone')),
  path         TEXT,
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT,
  utm_content  TEXT,
  booking_id   INTEGER,
  -- A target only ever means something on a cta_click; every other event
  -- must leave it NULL, per the spec's own table description. A table-level
  -- CHECK, not a column one, because it reads two columns at once — and it
  -- has to come after every column-def, not beside the one it mentions
  -- first, or SQLite reads the next column-def as an attempted constraint.
  CHECK (target IS NULL OR event = 'cta_click')
);

-- Backs both pruneEvents' DELETE and funnel()'s window filter.
CREATE INDEX marketing_events_at ON marketing_events (at);

ALTER TABLE bookings_v2 ADD COLUMN source_utm TEXT;
ALTER TABLE bookings_v2 ADD COLUMN heard_from TEXT;
`;
