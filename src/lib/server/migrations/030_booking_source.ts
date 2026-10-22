/**
 * Migration 030 — the optional "אחר" explanation, and the finer funnel steps.
 *
 * Todoist 6hmX5r7FfjccvG6q (how did you hear about us) and 6hmX5p4QgMPpxRJH
 * (funnel instrumentation). `heard_from` already exists (migration 016);
 * this adds the free-text that follows "אחר", and lets the events table
 * name the steps the booking page actually has.
 *
 * `bookings_v2.heard_from_detail` is the short explanation a family typed
 * after choosing "אחר". It lives on the booking, which already holds that
 * family's name and phone — it is never copied onto `marketing_events`.
 * NULL when they skipped the question, chose something other than "אחר",
 * or booked before this column existed.
 *
 * `marketing_events` keeps every row it already had. The table is rebuilt
 * because SQLite cannot change a CHECK in place, and two things have to
 * change together: the event list grows by `booking_start`, `plan_selected`
 * and `time_selected`, and a `detail` column records which plan
 * (`single` / `double` / `triple`) on `plan_selected` only. `referrer` is
 * the landing page's external origin (scheme and host, never a path or
 * query) so a source breakdown can see Google or Facebook when the visit
 * carried no UTM. Neither column can hold a name, phone, email or IP —
 * `detail` is a plan key, `referrer` is an origin.
 */
export const sql = `
ALTER TABLE bookings_v2 ADD COLUMN heard_from_detail TEXT;

CREATE TABLE marketing_events_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           TEXT    NOT NULL,
  visitor_id   TEXT,
  event        TEXT    NOT NULL CHECK (event IN (
                  'landing_visit', 'cta_click', 'booking_start', 'booking_started',
                  'plan_selected', 'time_selected', 'booking_submitted', 'lesson_scheduled'
                )),
  target       TEXT    CHECK (target IS NULL OR target IN ('booking', 'whatsapp', 'phone')),
  path         TEXT,
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT,
  utm_content  TEXT,
  booking_id   INTEGER,
  detail       TEXT,
  referrer     TEXT,
  CHECK (target IS NULL OR event = 'cta_click'),
  CHECK (detail IS NULL OR (event = 'plan_selected' AND detail IN ('single', 'double', 'triple')))
);

INSERT INTO marketing_events_new
  (id, at, visitor_id, event, target, path, utm_source, utm_medium, utm_campaign, utm_content, booking_id)
SELECT
  id, at, visitor_id, event, target, path, utm_source, utm_medium, utm_campaign, utm_content, booking_id
FROM marketing_events;

DROP TABLE marketing_events;
ALTER TABLE marketing_events_new RENAME TO marketing_events;
CREATE INDEX marketing_events_at ON marketing_events (at);
`;
