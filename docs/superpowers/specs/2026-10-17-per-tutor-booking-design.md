# Each lesson goes to its own tutor

**Status:** approved in conversation 2026-10-17, written for review.
**Builds on:** #46 (online lessons carry `teachers.meet_url`) and #47 (a
tutor connects that room from a setup link).
**Depends on:** #51 and the calendar-robot move: each tutor's lesson
calendar is shared with the robot in `meabeclick-site`, not the old one.

## Goal

Every lesson is held by the tutor who teaches it, and everything downstream
follows that tutor: the hours a family is offered, the calendar the lesson
is written into, and the Meet room in the confirmation, on the success
screen and in the reminder. Families never choose a tutor (PRODUCT.md
non-goal), and Nikol does no new step (north star 1).

Done means:

1. A new family is booked with whichever tutor is free at the hour they
   pick, and with Nikol when both are.
2. A returning family is only ever booked with their own tutor.
3. A lesson Lior holds is written to Lior's lesson calendar, blocks only
   Lior's hours, and carries Lior's room.
4. Until Lior's settings are in, booking behaves exactly as it does today.

## Today

- **The room already follows the enrollment's tutor:**
  `lessonTeacher(enrollment.teacher_id)` in `api/book/+server.ts` and
  `reminders.ts`.
- **Every enrollment gets the default tutor:** `defaultTeacher()` in
  `enroll.ts` and `api/students/+server.ts`. `upsertEnrollment` also
  overwrites `teacher_id` on every re-booking, so a hand-made assignment
  would not survive the family's next booking.
- **Availability is one pool.** Busy times come from `CALENDAR_ICS_URLS`
  (Nikol's personal calendar plus the business lesson calendar) and from
  every booking (`OVERLAP_SOURCE`). There is one teaching window, held in
  constants in `api/availability/+server.ts`.
- **Claiming an hour is global:** `slotTaken()` asks whether *anyone* holds
  it.
- **Every event goes to one calendar,** `CALENDAR_ID`, and the boot checks
  require it.

## Decisions

- **D1 — Whoever is free.** A new family goes to a tutor who is free at
  their hour. Nikol goes first: the lowest active id, the order
  `defaultTeacher()` already uses. A returning family only ever gets their
  own tutor. Lior can move a student to another tutor from the dashboard.
- **D2 — One lesson calendar per tutor,** all under `mea.beclick@gmail.com`:
  "שיעורים - ניקול" (today's calendar, renamed) and "שיעורים - ליאור".
- **D3 — No fallback for a returning family.** If their tutor has no free
  hour, they see "no free hours". They are never offered the other tutor.
- **D4 — Busy times stay on private iCal addresses** (today's mechanism),
  not on a Google free/busy permission from the tutor's sign-in. Revisit
  when a third tutor arrives.
- **D5 — Each tutor has their own teaching hours.** The default is today's
  window.
- **D6 — A booking records its tutor when it is made.** Moving a student
  later does not move lessons they already booked.
- **D7 — Tutor settings live on the tutor's row,** set from the "מורים" card.
  Nikol's row takes over today's `.env` values on the first start after
  deploy.

## How it works

### Migration 029

```sql
ALTER TABLE teachers ADD COLUMN calendar_id TEXT;     -- lesson calendar the robot writes to
ALTER TABLE teachers ADD COLUMN busy_ics TEXT;        -- private iCal addresses, one per line (SECRET)
ALTER TABLE teachers ADD COLUMN teaching_hours TEXT;  -- JSON, NULL = the default window
ALTER TABLE bookings_v2 ADD COLUMN teacher_id INTEGER REFERENCES teachers(id);
ALTER TABLE pending_bookings ADD COLUMN teacher_id INTEGER REFERENCES teachers(id);
```

**Backfill.** An existing `bookings_v2` row takes its enrollment's tutor,
or the default tutor when it has no enrollment. A pending row takes the
default tutor. Every existing enrollment is Nikol's, so every existing
hold stays hers. Legacy `bookings` rows get no column: they count as the
default tutor's wherever bookings are read.

**`teaching_hours`** has the shape
`{"0":["08:00","21:00"], …, "5":["08:00","16:00"]}`:

- Keys are weekdays in Israel time, Sunday = 0 to Friday = 5.
- A missing key means that day is off. Saturday is always off.
- Each pair is the earliest start and the latest *end*, as today's
  constants already define the window.
- `NULL` means today's window: Sunday to Thursday 08:00–21:00, Friday
  08:00–16:00.

### Taking over today's settings

On boot, after migrations: if the default tutor has neither `calendar_id`
nor `busy_ics`, and `CALENDAR_ID` / `CALENDAR_ICS_URLS` are set, they are
copied onto her row. Because of that condition the copy happens once and
never overwrites anything. Only that it happened is logged, never the
values.

After the deploy, the two `.env` lines are deleted, with a backup first.
From then on nothing reads them, and the `CALENDAR_ID` boot check goes
away. The misrouting it guarded against needs a global calendar to fall
back to, and there no longer is one.

### Who can take bookings

`takesBookings(tutor)` holds when the tutor is active, has a `calendar_id`
and has at least one busy address. A tutor without all three is never
offered and never assigned, and the "מורים" card says what is missing. The
Meet room is not required: an online lesson without one behaves as it does
today, naming the mode without a link.

### Candidates: who may teach this booking

For a booking of student S (matched by name within account A, as
`enrollFromBooking` already matches) in subject X:

1. If S has an enrollment in X whose tutor is active, the candidate is
   that tutor.
2. Otherwise, if A has other students whose tutors are active, the
   candidates are those tutors: a new child joins the family's tutor.
3. Otherwise, the candidates are every tutor who takes bookings.

The candidates are then narrowed to tutors who take bookings. Two cases
follow:

- **The tutor is active but missing settings:** the family is offered no
  hours. They are not silently moved to someone else.
- **The tutor has been deactivated:** that tutor counts as "no tutor", and
  the next rule applies.

### Availability: `GET /api/availability`

Each tutor's free slots are computed as today, from their own inputs:

- their teaching hours;
- events at their busy addresses, plus the 30-minute buffer;
- bookings and holds they own, plus the 15-minute break.

Bookings held by another tutor do not block them.

The hours shown are the union over the request's candidates:

- **An account session:** rule 2 applied to that account, meaning the
  tutors of its students; if it has none, everyone who takes bookings.
- **`?tutor=<id>`:** that tutor only, if they take bookings. This is used
  by the reload after `TUTOR_BUSY` (below).
- **Anyone else:** every tutor who takes bookings.

The response never says which tutor a slot belongs to. A calendar that
fails to load is reported per tutor, by name and position («היומן השני של
ליאור»), never by address. As today, the slots are still shown.

### Booking: `POST /api/book`

The race defence is unchanged: enrolment, the hour check and the
reservation run synchronously, with no `await` between them. What is new
comes before and inside that block:

1. **Before the block** (async): resolve the candidates (synchronous DB
   reads), then await their calendar busy times. These come from the same
   5-minute cache availability uses.
2. **Inside the block** (sync):
   - Pick the first candidate, in id order, who is free in both the
     calendar busy times and the database (`slotTakenFor(tutorId, start,
     end)`).
   - Enrol with that tutor. A new enrollment takes the tutor; an existing
     one keeps its own, because `upsertEnrollment` no longer overwrites
     `teacher_id`.
   - Reserve with `teacher_id`.

**When no candidate is free:**

- If the family is returning (rule 1 or 2) and some *other* tutor who
  takes bookings is free, the response is
  `409 {code: 'TUTOR_BUSY', error: 'השעה הזאת לא פנויה אצל המורה שלכם', tutorId}`.
  `tutorId` is the family's tutor (the first, by id, if their children
  have several), taken before the narrowing to tutors who take bookings.
  The booking page keeps the form filled in, reloads
  `/api/availability?tutor=<tutorId>`, and returns to the hours.
- Otherwise the response is today's `409 'השעה הזו כבר תפוסה'`.

**Calendar busy times at submit are new.** Today the submit checks only
the database. It now also checks calendars, because choosing between two
tutors needs them. A calendar that fails to load at submit counts as free,
the same fail-open (with a warning) that availability already applies.

**A known email that isn't signed in** (`holdForConfirmation`) gets the same
choice, and the pending row records `teacher_id`. On confirmation
(`confirmHeld`), the booking is made with the held tutor, and only that
tutor's hour is re-checked.

**A tutor booking for a family** from the dashboard follows the same rules.

**`TUTOR_BUSY` reveals the tutor's id** to someone who typed a known
family's email. That is accepted: the tutors are public, and today's
"awaiting confirmation" answer already reveals that the email is known.

### After the booking

- **The event** goes to the booking tutor's `calendar_id`. There is no
  fallback: a tutor without a calendar cannot hold a booking.
- **The room and the tutor's name** in the emails and on the success screen
  are the booking tutor's.
- **Reminders** read `bookings_v2.teacher_id` instead of the enrollment's.
  `lessonTeacher()` stays for rows that have no tutor.

### Dashboard

- **"מורים" card**, for each tutor:
  - Lesson calendar id.
  - Private addresses, in a textarea. Once saved, the card shows
    "2 כתובות שמורות" and a "החלפה" button, never the addresses.
  - Teaching hours, Sunday to Friday, each day a from/to or "off".
  - The room, as today.
  - A status: "מקבל/ת הזמנות ✓", or what is missing.

  Saving goes through `PATCH /api/teachers/[id]` behind `apiAuthDenied`.
  No response ever contains a `busy_ics` value.
- **לוח תלמידים:** each student card shows the student's tutor and a picker
  of active tutors. The picker changes that enrollment's `teacher_id` and
  nothing else.
- **Upcoming lessons:** wherever the dashboard shows one, it names the
  lesson's tutor.

### Secrets

`busy_ics` addresses give read access to a tutor's personal calendar. They
are:

- never logged;
- never returned by an API;
- never copied from production into a test.

They do live in the database, which is backed up to the business Drive.
That is accepted: the same database already holds family details and Meet
links.

## Rollout

1. #51, then the robot move.
2. Deploy this. Nikol's row takes over the `.env` values, she is the only
   tutor who takes bookings, and nothing visible changes. Then delete the
   two `.env` lines.
3. Lior, in Google Calendar as `mea.beclick@gmail.com`:
   - rename "שיעורים - מאה בקליק" to "שיעורים - ניקול";
   - create "שיעורים - ליאור" and share it with the robot ("Make changes to
     events") and with whoever sees the current calendar;
   - copy its private address and his personal calendar's private address.
4. Lior fills in his row on the "מורים" card. Once it shows "מקבל הזמנות ✓",
   new families can land with him.

**Rollback:** clearing Lior's settings returns booking to one tutor.
Bookings he already holds keep him.

## Out of scope

- Moving already-booked lessons when a student moves to another tutor.
- Families choosing a tutor.
- Busy times through a Google sign-in (D4).
- `lessons.teacher_id`: nothing writes it today, and this does not start.
- Per-tutor prices, and a per-tutor booking window (which weeks are open).

## Testing

**Unit:**

- Candidates:
  - each of rules 1–3;
  - a deactivated tutor falls through to the next rule;
  - a tutor with missing settings yields no candidates.
- Free slots per tutor:
  - teaching hours, including a day off and a short day;
  - only that tutor's busy addresses block them;
  - another tutor's bookings don't block them.
- `slotTakenFor`:
  - per tutor;
  - legacy `bookings` count as the default tutor's;
  - pending rows count as their tutor's.
- Assignment:
  - Nikol first;
  - Lior when Nikol is busy in her calendar, and when she is busy in the
    database;
  - nobody free gives 409;
  - a returning family gets `TUTOR_BUSY`.
- Taking over the settings:
  - copies once;
  - never overwrites.
- `busy_ics` never appears in an API response or a log line.

**Characterization** (through `/api/availability` and `/api/book`):

- Two new families at the same hour:
  - the first gets Nikol;
  - the second gets Lior once he takes bookings;
  - a third gets 409.
- A signed-in returning family sees only their tutor's hours.
- A known email that isn't signed in:
  - is held with their tutor;
  - gets `TUTOR_BUSY` when that tutor is busy.
- Booking again does not reset the tutor.
- After a student moves:
  - their next booking goes to the new tutor;
  - their earlier bookings and reminders stay with the old one.
- The event is written to the booking tutor's calendar (Google faked).
- Every existing characterization test passes unchanged while Nikol is the
  only tutor who takes bookings. That is how goal 4 is pinned.

**Browser QA, before merge:**

- the booking page as a new visitor, a signed-in family, and through the
  `TUTOR_BUSY` reload;
- the "מורים" card and the student card's picker;
- all of it at 320px.
