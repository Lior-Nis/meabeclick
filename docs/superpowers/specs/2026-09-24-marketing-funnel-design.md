# Marketing funnel: from a visit to a lesson held

Todoist 6hW8xwxJ899GP7fq (UTM, CTA measurement, source kept through to the
booking) and 6hRhJv5m433H45QH (marketing → inquiry → lesson, measured),
designed as one subsystem. Pillar `pillar-wom` in `PRODUCT.md`. Decisions
settled with Lior on 2026-09-24. The task's own gate ("no code before the
defaults and the measurement tool are approved") is closed by these
decisions.

## Decisions

| # | Decision |
|---|---|
| Tool | Internal: an events table in the site's own SQLite. No third-party scripts and no cookies. |
| Scope | The two Todoist tasks are one design, shipped as three PRs. |
| Defaults | The primary CTA reads **"בדקו מועד לשיעור"** → `/booking`. WhatsApp is the alternative CTA. Only the tutor can see the data. The report is a dashboard page with a 7-day default, which is the weekly report. |
| Self-report | One optional booking question, "איך שמעתם עלינו?", with the choices: חבר/ה או משפחה · אינסטגרם · גוגל · בית ספר או מורה · אחר. |
| Attribution | First touch, kept for 30 days in `localStorage` and attached to any booking made in that window. |
| Visitor | A random anonymous id in `localStorage`. No IP, no fingerprinting. |
| Landing | Both `/booking` buttons are relabelled and each gets a WhatsApp button beside it. The booking, WhatsApp and phone links each send their own click event. |
| Funnel end | Two columns: bookings saved, and lessons held (not cancelled and already past). |
| Filtering | Obvious bots (by user-agent) and the logged-in tutor are ignored. |
| Retention | Raw events are kept for 12 months. A booking's own source is kept forever. |
| Merge | Claude merges each PR after CI and the browser check pass, then watches the deploy and checks the image running on the box. |

## Design

### Data (migration 016)
- `marketing_events(id, at, visitor_id, event, target, path, utm_source, utm_medium, utm_campaign, utm_content, booking_id)`:
  - `event` ∈ `landing_visit | cta_click | booking_started | booking_submitted | lesson_scheduled`
  - `target` ∈ `booking | whatsapp | phone`, and is NULL on everything except `cta_click`
  - Indexed on `at`.
- `bookings_v2` gets two new nullable columns: `source_utm` (JSON holding the first-touch UTM and its visitor id) and `heard_from` (one of the five choices, or NULL).
- There are no columns for a name, phone, email, IP or message text, so none of them can ever be stored (requirement 6).

### Capture
- `src/lib/marketing.ts` runs in the browser only.
  - On load it reads `utm_*` from the URL. If a first touch is stored and less than 30 days old, it keeps that one; otherwise it stores the new one.
  - It creates the visitor id if there isn't one.
  - `track(event, extra)` sends with `navigator.sendBeacon('/api/events', json)`. Every storage or beacon failure is swallowed, so the site behaves exactly as it does today.
  - `attribution()` returns `{ utm, visitorId }` for the booking body.
- `POST /api/events` is public.
  - It accepts only the five event names, the known fields and the `target` values. Strings are capped at 100 characters and the body at 2 KB.
  - It is rate-limited per IP in memory. The IP is never written.
  - Requests with a bot-like user-agent, or from the tutor's admin session, are dropped with a 204.
  - It returns 204 in every case, so a probe learns nothing.
  - Once per process-day it deletes events older than 365 days.
- `/api/book` accepts `attribution` and `heardFrom`. It validates both: an unknown `heardFrom` becomes NULL, and oversize UTM values are cut. It stores them on the booking row and writes `lesson_scheduled` with the new `booking_id` in the same transaction as the booking.

  > **Amendment (2026-09-24, PR1 fix wave):** `lesson_scheduled` is written
  > after the booking succeeds, not in the same transaction as it, so a
  > failed measurement write can never fail a booking. See the recordEvent
  > call's own comment in `src/routes/api/book/+server.ts`.

### Surfaces
- **Landing**, both CTA rows: "בדקו מועד לשיעור" and "וואטסאפ" (`https://wa.me/<TUTOR_PHONE>?text=…`). Clicks are tracked. `landing_visit` fires once per page load.
- **Header:** the phone link sends `cta_click` with target `phone`.
- **Booking:**
  - Tapping a plan card sends `booking_started`. Submitting sends `booking_submitted`.
  - The details step has the optional question.
  - The booking's WhatsApp fallbacks send `cta_click` with target `whatsapp`.
- **`/app/marketing`**, tutor only (the same guard as `/app/dashboard`), linked from the dashboard:
  - A table grouped by source, then campaign, then content. Columns: visitors, `/booking` clicks, WhatsApp clicks, phone clicks, bookings started, bookings, lessons held.
  - The "how did you hear" answers for bookings made in the window.
  - A 7 / 30 / 90-day toggle, defaulting to 7 days.
  - Rows with no UTM are grouped as "ישיר / לא מתויג".

## Delivery
1. **PR 1:** migration 016, `/api/events`, `src/lib/marketing.ts`, booking attribution and the question, and this spec plus its plan.
2. **PR 2:** landing CTAs and WhatsApp buttons, and the header phone event.
3. **PR 3:** the report page.

Each PR is written test-first. Every `+page.svelte` change is checked in a browser on the built server at 320, 375, 390, 430 and 1280 px. After merging, the deploy is watched and the image running on the box is checked.

**Production dummy test (task step 7):** one visit from Claude's own browser to `https://meabeclick.com/?utm_source=claude-test&utm_campaign=dummy`. It clicks one CTA and does not book. It should appear in the report under `claude-test`. No customer is contacted.
