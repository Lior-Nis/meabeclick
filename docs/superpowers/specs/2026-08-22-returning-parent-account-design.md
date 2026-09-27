# Returning-parent account matching for the booking form

## Problem

`enrollFromBooking()` (`server/enroll.mjs`) identifies "is this an existing
family" purely by phone number (`findStudentByPhone`). When a second lesson
is booked using a *different* phone (e.g. the other parent), the lookup
fails and a brand-new student record — with its own code and empty portal
file — is created for what is really the same child. The family ends up
fragmented across two disconnected records.

This surfaced while fixing a related bug: `appendToPortal()` in
`server/lesson-queue.mjs` used to match students by free-text name, which
could write a lesson into the wrong student's portal file if two students
shared a name. That was fixed to match by phone via `findStudentByPhone()`
instead — which is correct but inherits the same phone-only limitation this
spec addresses.

## Decision: user-chosen, recoverable password

The fix is to let a returning parent identify themselves explicitly with a
password they chose at enrollment, rather than have the server guess from
phone number or name.

This password is stored in the clear (not hashed) so the tutor can read it
back to a parent who forgot it, by explicit request. **This is a conscious
security trade-off, confirmed with the project owner**, not an oversight:

- It mirrors this app's existing `student_pin` / `parent_pin` design, which
  is already documented as intentionally low-security ("guards homework and
  progress notes, not money").
- Unlike a system-generated PIN, this password is freely chosen by the
  parent, so it *could* collide with a password they reuse elsewhere. That
  risk was raised explicitly and accepted: the owner wants parents to pick
  their own password and wants to be able to see it, not reset-only.
- No further hardening (rate limiting on `/api/verify-account`, hashing,
  etc.) is in scope here. If this becomes a real concern later, revisit.

## Identity key: name + password

A returning parent is matched by **exact student name + exact password**,
not phone. Phone and level/grade stay pure booking-detail fields, never
used for identity.

- Two different families matching on name AND password by coincidence is
  effectively impossible — safe even though student *names* alone can
  collide (a known, already-mitigated risk from the `appendToPortal` fix).
- A typo in either field simply fails to match — the parent gets a clear
  "wrong name or password" error and can retry or fall back to booking as
  new. This is intentional: a false negative (fails to match, harmless) is
  vastly preferable to a false positive (matches the wrong family, a data
  leak). No fuzzy matching.

## Scope: booking-flow identity only, not portal login

This spec covers **only** identifying a student during the booking flow. It
does **not** touch the existing `student_pin` / `parent_pin` system that
gates `student.html`, `parent-dashboard.html`, and `api/ask.js` today.

A follow-up project (not this one) will unify those into the same
password + a "parent dashboard or student dashboard" chooser show after
login. That is a separate, larger change touching `student.html`,
`parent-dashboard.html`, `dashboard.html`, `server/app.mjs`, and
`api/ask.js`, and was deliberately deferred to keep this change bounded.

## Data model

`server/db.mjs`, `students` table:

- New nullable column `password TEXT`.
- Idempotent migration on every startup, right after
  `CREATE TABLE IF NOT EXISTS students`:
  ```sql
  ALTER TABLE students ADD COLUMN password TEXT;  -- wrapped so a rerun is a no-op
  UPDATE students SET password = student_pin WHERE password IS NULL;
  ```
  (SQLite has no `ADD COLUMN IF NOT EXISTS`; wrap the `ALTER TABLE` so a
  "duplicate column" error is swallowed on subsequent runs.)
  Existing rows are demo/example data per the project owner — backfilling
  their password from `student_pin` is enough, no dedicated migration step.

New function:

```js
/** Exact match on name (trimmed/whitespace-normalized) + password. */
export function findStudentByNameAndPassword(name, password) { ... }
```

## Backend behavior

### New endpoint: `POST /api/verify-account`

`{ name, password }` → `{ valid: true|false }`. Used by the booking form for
early, inline feedback before the parent fills in the rest of the modal.
Not a security boundary by itself — see re-verification below.

### `enrollFromBooking()` (`server/enroll.mjs`)

Takes a new `isReturning` flag on the booking object.

- **`isReturning: true`**: must resolve via
  `findStudentByNameAndPassword(name, password)`. No match → throw a plain
  `Error` with a `.code = 'INVALID_ACCOUNT'` property set on it (consistent
  with this codebase's existing style — no custom error classes elsewhere),
  which the `/api/book` handler catches and turns into
  `res.status(401).json({ error: 'שם או סיסמה שגויים' })`, **before** any
  calendar/email work starts. No new student is created on a failed match.
- **`isReturning: false`**: unchanged today's behavior
  (`findStudentByPhone` dedup, then `createStudent`), plus: if a password
  was provided, store it on the (new or phone-matched) student record.
  An empty password field is today's default behavior — no account
  identity is set up, matching the "one-time lesson" framing from the
  product conversation.

### Composing with the existing double-booking fix

`server/app.mjs`'s `/api/book` route already calls `reserveBooking()`
synchronously before invoking `book(req, res)`, and releases the hold via
`cancelBooking()` in the `res.on('finish', ...)` handler whenever the
response status isn't 200. A 401 from a failed `isReturning` match is just
another non-200 status — the existing release logic requires no changes.

### Threading the resolved student through to lesson generation

Today, `appendToPortal()` re-derives the student independently via
`findStudentByPhone(booking.phone)` — a second, separate identity
resolution that can now disagree with what `enrollFromBooking()` decided
(e.g. an `isReturning` booking resolved by name+password, with a phone that
doesn't match any student on file).

Fix: `api/book.js` sets `res.locals.enrolledCode = enrolled.student.code`
right after a successful `enrollFromBooking()` call. `server/app.mjs`'s
`/api/book` wrapper reads `res.locals.enrolledCode` in its `finish` handler
and passes it into `triggerForBooking(body, { enrolledCode })`, which
threads it through `run()` into `appendToPortal(enrolledCode, plan,
published)`. `appendToPortal` now just does `getStudent(code)` +
`portal/<code>.json` directly — no independent phone lookup at all. One
place decides "who is this student," used everywhere downstream.

## Frontend (`booking.html`)

Existing step order (duration → time slot → details modal → confirm) is
unchanged — the new fields live inside the existing details modal, which
already opens after a time slot is picked.

At the top of the modal, before the name field:

- Toggle: **"כבר הזמנתם שיעור בעבר? כן / לא"**, default "לא".
- **"כן" (returning)**: reveals a password field under the name field. On
  blur, calls `POST /api/verify-account`; a mismatch shows inline error
  text immediately ("שם או סיסמה שגויים"), parent can retry. The
  English-name (`inp-code`) field is hidden — not applicable, the student
  already has a code.
- **"לא" (new)**: the English-name field (`inp-code`) is removed from the
  form entirely and generated server-side from the Hebrew name via the
  existing `transliterate()` (`server/enroll.mjs`) instead of asking the
  parent to type it — this was flagged as confusing UX during manual
  testing of the live site. A new optional field is added at the bottom of
  the modal: **"בחרו סיסמה לכניסה בפעם הבאה (לא חובה — השאירו ריק לשיעור
  חד-פעמי)"**.

Final submit (`submitBooking()`) always re-sends `isReturning` +
`name`/`password` to `/api/book`; the server re-verifies regardless of the
earlier inline check (never trust client-side validation alone).

No password strength/length requirement and no confirm-password field —
any non-empty string is accepted. Matches the "keep it simple" direction
from the design conversation; a mistyped new password is self-correcting
since the tutor can read it back from the dashboard (see below) and the
parent can just try again next time.

## Dashboard (`dashboard.html`)

The existing student table (which already shows `student_pin` and
`parent_pin` per row) gets one more column, **"סיסמה"**, from the same
`GET /api/students` response — no backend change needed beyond the schema
addition, since `listStudents()` already does `SELECT *`.

## Out of scope

- Unifying `student_pin`/`parent_pin` into the same password + a parent/
  student dashboard chooser (explicitly deferred as its own project).
- Any hashing/rate-limiting hardening of the password (accepted trade-off,
  see above).
- Handling a parent who types a *slightly* different but still-correct name
  (nicknames, missing surname, typos) — falls back to "no match," which is
  the safe default, not a bug to fix here.
