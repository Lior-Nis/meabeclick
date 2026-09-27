# Marketing Funnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record where each visitor came from, from the landing page through to a booked and a held lesson, and show it to the tutor. No personal data is recorded.

**Architecture:** An events table in the app's own SQLite, filled by a public beacon endpoint and by `/api/book`. A browser module keeps the first-touch UTM and an anonymous visitor id in `localStorage`. The report is a tutor-only page.

**Tech Stack:** SvelteKit 2 / Svelte 5, `node:sqlite`, `node --test`, the characterization harness (`tests/characterization/harness.mjs`), and Playwright (Python) for browser checks.

**Spec:** `docs/superpowers/specs/2026-09-24-marketing-funnel-design.md`. It is binding.

## Global Constraints
- **Never stored in `marketing_events`:** a name, phone number, email, IP address or message text. The table has no columns for them.
- **Event names:** exactly `landing_visit`, `cta_click`, `booking_started`, `booking_submitted`, `lesson_scheduled`. **Targets:** exactly `booking`, `whatsapp`, `phone`.
- **`heard_from` values:** exactly `friend`, `instagram`, `google`, `school`, `other`. Hebrew labels: חבר/ה או משפחה · אינסטגרם · גוגל · בית ספר או מורה · אחר.
- **Attribution:** first touch, 30 days, stored in `localStorage` (never in a cookie). The visitor id comes from `crypto.randomUUID()`.
- **Retention:** 365 days for raw events.
- **Primary CTA copy:** `בדקו מועד לשיעור`.
- **Migrations:** the next number is **016** (`016_marketing_events`). Migrations are a TypeScript registry in `src/lib/server/migrations/list.ts`, never `.sql` files. `src/lib/server/storage-inventory.ts` must list every new table, and its test enforces that.
- **The site must never break because of measurement.** Every client-side storage call or beacon failure is swallowed. `/api/events` always answers 204.
- **Git:** stage explicit paths only, never `-A` or `.`. Work only in `/home/liornisimov/Projects/mea-beclick-mkt` (and its later sibling worktrees). Never touch `/home/liornisimov/Projects/mea-beclick`.
- **Commit trailer:**
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_014gnmLf7wB32DTbu6PPgY49`
- **Testing:** the suite is source-level, and a green run does not prove a page works. Every `+page.svelte` change is checked in Playwright on the built server, started through the harness from the worktree's own directory (the harness serves `build/` relative to the working directory).

---

### Task 1: Migration 016 and the event store (PR 1)
**Files:**
- Create: `src/lib/server/migrations/016_marketing_events.ts`, `src/lib/server/marketing.ts`
- Modify: `src/lib/server/migrations/list.ts`, `src/lib/server/storage-inventory.ts`
- Test: `tests/unit/marketing-store.test.mjs`

**Produces:**
- `recordEvent(e: { event, target?, path?, visitorId?, utm?: {source?,medium?,campaign?,content?}, bookingId?, at?: string }): boolean` validates and inserts. It returns false and writes nothing for any invalid event or target. It trims strings to 100 characters.
- `pruneEvents(now: Date): number` deletes rows older than 365 days.
- `funnel(sinceIso: string, untilIso: string)` returns an array of rows `{ source, campaign, content, visitors, bookingClicks, whatsappClicks, phoneClicks, bookingsStarted, bookings, lessonsHeld }`:
  - `visitors` counts distinct `visitor_id` on `landing_visit`.
  - `bookings` counts `lesson_scheduled` events.
  - `lessonsHeld` counts those events whose `bookings_v2` row is not cancelled and whose `end` is not later than `untilIso`.
  - A NULL source is grouped as `null`.
- `heardFromCounts(sinceIso, untilIso): Record<string, number>` is computed over `bookings_v2.at`.
- Migration: the table as in the spec, an index on `at`, and `ALTER TABLE bookings_v2 ADD COLUMN source_utm TEXT` plus `ADD COLUMN heard_from TEXT`.

**Tests:**
- An invalid event name is rejected.
- An invalid target is rejected.
- Strings are trimmed.
- The table has no column matching `/name|phone|email|ip|message/i` (check with `PRAGMA table_info`).
- `pruneEvents` removes a 366-day-old row and keeps a 364-day-old one.
- `funnel` groups by source, campaign and content, counts distinct visitors, splits clicks by target, and counts lessons held only when the booking is not cancelled and is past.
- `heardFromCounts` counts correctly.

Write the tests first and capture the RED output.

### Task 2: `POST /api/events` and `src/lib/marketing.ts` (PR 1)
**Files:**
- Create: `src/routes/api/events/+server.ts`, `src/lib/marketing.ts`
- Test: `tests/characterization/events-endpoint.test.mjs` (uses the harness), `tests/unit/marketing-client.test.mjs`

**Endpoint:**
- Always 204.
- Bodies over 2 KB are ignored.
- User-agents matching `/bot|crawl|spider|slurp|facebookexternalhit|preview|headless/i` are ignored.
- A valid admin session cookie (`validToken` from `auth.ts`) is ignored.
- There is a rate limit of 60 events per IP per 10 minutes, held in memory. The IP is never written.
- It calls `pruneEvents` at most once per 24 hours per process.
- A client cannot send `lesson_scheduled`; that event is server-only.

**Client module** (browser-safe, no `$app` imports needed):
- `initMarketing(url: URL)` stores the first touch (utm + at) if none exists or the stored one is older than 30 days, and ensures a visitor id exists.
- `track(event, extra?)` sends a beacon, with a `fetch` keepalive fallback, and swallows all errors.
- `attribution()` returns `{ utm, visitorId } | null`.
- Make the storage object injectable for the unit test, and test it with a fake storage:
  - The first touch is kept.
  - A first touch older than 30 days is replaced.
  - A storage that throws does not throw out of the module.

**Characterization tests:**
- A valid event is stored.
- A bad event returns 204 and is not stored.
- A bot user-agent is not stored.
- `lesson_scheduled` from a client is not stored.
- The 61st event in the window is not stored.

### Task 3: Booking attribution and the question (PR 1)
**Files:**
- Modify: `src/routes/api/book/+server.ts` (`BookBody` gains `attribution?: {utm?, visitorId?}` and `heardFrom?: string`), `src/lib/server/entities.ts` (the booking insert takes `sourceUtm` and `heardFrom`), `src/routes/booking/+page.svelte` (the question in the details step; `track('booking_started')` on a plan tap; `track('booking_submitted')` on submit; `track('cta_click', {target:'whatsapp'})` on the WhatsApp fallback links; `initMarketing` on mount; `attribution` and `heardFrom` sent with the body)
- Test: extend the existing book characterization tests. Cover:
  - A booking with attribution stores `source_utm` and `heard_from`.
  - An unknown `heardFrom` is stored as NULL.
  - A `lesson_scheduled` event with the booking id is written.
  - A booking without attribution still succeeds.
- Add a source-level test for the question's five options and their values.
- **Browser check** at 320, 375, 390, 430 and 1280 px:
  - The question renders and is optional.
  - A full booking attempt on the harness server sends the events. Assert via the DB (`dbPath` from the harness).

### Task 4: Landing CTAs (PR 2)
**Files:**
- Modify: `src/routes/+page.svelte` (both CTA rows relabelled `בדקו מועד לשיעור`, plus a WhatsApp button `https://wa.me/972546969891?text=…` with a warm prefilled message; `initMarketing` and `track('landing_visit')` on mount; `cta_click` targets on the buttons), `src/lib/components/Header.svelte` (the phone link sends target `phone`)
- **Reuse:** the tutor phone constant that booking already uses, if one exists (grep `TUTOR_PHONE`). Otherwise move it into a shared `src/lib/contact.ts` and import it from both places.
- **Tests:** source-level for the label and WhatsApp href. A browser check at all five widths that the buttons render and wrap cleanly with no horizontal scroll, and that clicks write events (via the DB).

### Task 5: The report page (PR 3)
**Files:**
- Create: `src/routes/app/marketing/+page.server.ts` (the same admin guard as `app/dashboard/+page.server.ts`; reads `funnel` and `heardFromCounts` for `?days=7|30|90`, defaulting to 7), `src/routes/app/marketing/+page.svelte`
- Modify: the dashboard page, to add a link to "שיווק"
- **Tests:**
  - Characterization: an unauthenticated request is redirected or denied. An authenticated request renders the seeded numbers.
  - Browser check at all five widths, with the table in its own `overflow-x: auto` container.

### Task 6: Merge, deploy and the production dummy test
For each PR in order:
1. Merge with `gh pr merge --squash`.
2. Watch the run for the merge SHA.
3. Confirm the image running on the box contains the merge SHA: `ssh mea 'docker ps --format "{{.Image}}"'` and `git merge-base --is-ancestor`.

After PR 3:
1. From Playwright, visit `https://meabeclick.com/?utm_source=claude-test&utm_campaign=dummy` and click the WhatsApp button, but block the navigation to wa.me. Do not book.
2. Check `/app/marketing` over the harness-free production login. If a production admin login isn't available to Claude, ask Lior to look at the page instead.
3. Comment the PR links on both Todoist tasks, then complete them.
