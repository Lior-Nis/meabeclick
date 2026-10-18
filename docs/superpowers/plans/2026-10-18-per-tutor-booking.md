# Per-Tutor Booking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every lesson is held by the tutor who teaches it. The hours a family is offered, the calendar the lesson is written into, the Meet room and the reminder all follow that tutor. Until Lior's settings are in, booking behaves exactly as it does today.

**Architecture:**
- **Data:** migration 029 adds three settings to each tutor's row and a `teacher_id` to every booking and hold.
- **New modules, each with one job:**
  - teaching hours (`$lib/teaching-hours.ts`, pure, shared with the dashboard);
  - tutor settings (`tutor-settings.ts`);
  - free slots per tutor (`tutor-slots.ts`, pure, moved out of the availability route);
  - who may teach a booking (`tutor-candidates.ts`);
  - choosing the tutor at submit (`tutor-assign.ts`);
  - the robot's calendar write (`lesson-calendar.ts`, moved out of the booking route).
- **Routes and UI:** `/api/availability` and `/api/book` call those modules, and the dashboard edits the settings.

**Tech Stack:** SvelteKit 2 / Svelte 5, adapter-node, `node:sqlite`, `node-ical`, `node --test` (imports `.ts` directly), Playwright for browser QA.

**Spec:** `docs/superpowers/specs/2026-10-17-per-tutor-booking-design.md`

## Global Constraints

- **Where the work happens:** worktree `scratchpad/wt-route`, branch `feat/per-tutor-booking`.
  - Set up once: `npm ci`.
  - Build before any characterization test: `npm run build`.
  - Full suite: `node --test "tests/**/*.test.mjs"`.
  - Type check: `npm run check` (0 errors), then `node scripts/check-warnings.mjs`.
- **The repo is public.** Tests use `example.com` and `example.test` addresses and `127.0.0.1:1` feeds. Never commit a real calendar id, iCal address, Meet link or student detail.
- **`busy_ics` is a secret.**
  - It is never logged and never returned by any API or page; the dashboard sees a count.
  - Never copy one from production into a test.
- **Families never choose a tutor.** The availability response never says which tutor a slot belongs to.
- **Nikol first** means the lowest active teacher id, the order `defaultTeacher()` uses.
- **A returning family is only ever booked with their own tutor** (spec D3).
- **A booking records its tutor when it is made** (spec D6). Moving a student moves no booked lesson.
- **The race defense stays synchronous.** Choosing the tutor, enrolling, checking the hour and reserving it run with no `await` between them. Calendars are read before that block.
- **Calendar reads fail open.** A feed that cannot be read counts as free. It is logged by tutor and position and shown on the dashboard, never by address.
- **Goal 4 is pinned by the existing suite.**
  - Every existing characterization test passes with its assertions unchanged.
  - The harness changes once (Task 4): it gives Nikol a reachable, empty busy feed, the shape production has.
- **Hebrew copy, exactly:**
  - `השעה הזאת לא פנויה אצל המורה שלכם` (TUTOR_BUSY);
  - `השעה הזו כבר תפוסה` (taken, unchanged);
  - `מקבל/ת הזמנות ✓`;
  - `N כתובות שמורות` / `כתובת אחת שמורה`;
  - `החלפה`.
- **Commits:** every commit message ends with this trailer paragraph:

  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01M83cAin9ny5QGUYH4Ydu6F
  ```

## Review Focus

These five inputs are the ones the spec implies but does not name, and the ones most likely to bite a family. Each is pinned in the task that owns its code:

1. **The day Israel's clocks change.** The window must still start at 08:00 Israel time on Friday 2027-03-26. Pinned in Task 5, "on the day the clocks change, 08:00 is still 08:00 in Israel".
2. **A tutor's busy feed is down at the moment a family submits.** The tutor counts as free and the failure is logged without the address. Pinned in Task 9, "a feed that cannot be read counts as free, and says so without the address".
3. **Two families submitting one hour at the same moment.** One lands with Nikol and one with Lior, never both with one tutor. Pinned in Task 9, "two families booking one hour at the same moment land with two tutors".
4. **Busy addresses pasted with blank lines, commas or spaces.** They split cleanly; one non-https line refuses the whole list. Pinned in Task 3, "a pasted list splits on lines, commas and spaces" and "an address that is not https refuses the whole list".
5. **A held booking confirmed after the family moved to another tutor.** It books with the tutor it was held with. Pinned in Task 9, "a known email that is not signed in is held with their tutor, and confirms with that tutor".

## Rulings made while planning

Each of these refines the spec where code reading showed it was silent or would break goal 4. They are listed for review.

- **R1 — The harness gives Nikol an empty, reachable busy feed** (Task 4).
  - Why: `takesBookings` needs a busy address. The harness sets none today, so without this every existing booking test would be refused.
  - Effect: this also makes the suite exercise the path production takes. Today it exercises the "nothing configured" path, which production never takes.
- **R2 — Choosing a tutor at submit takes two passes** (Task 5, `pickTutor`).
  1. The first candidate whose hours, buffers and breaks would offer that exact hour.
  2. Failing that, the first candidate with nothing in that hour at all.
  - Why pass 1: without it, a family who picked a 19:30 slot (offered by Nikol's hours) could be booked with Lior after his day ends.
  - Why pass 2: it keeps what one tutor could always do. Two existing tests book on a Saturday, and the dashboard can book outside the hours.
- **R3 — The Google Calendar API fallback is removed** (Task 7): `GOOGLE_API_KEY` + `AVAILABILITY_CALENDAR_IDS`.
  - Production does not set `GOOGLE_API_KEY` (measured 2026-09-20).
  - The fallback reads one global calendar list, which per-tutor busy times have no place for.
- **R4 — An existing enrollment keeps its tutor, unless that tutor is unset or deactivated; then it takes the booking's tutor** (Task 2). Otherwise a student whose tutor left would repeat the fall-through on every booking.
- **R5 — A held booking whose tutor lost their calendar since is kept and flagged**, like any failed calendar write (Task 9), not refused with a 500.
- **R6 — The success screen does not change.** It names no room and no lesson tutor today. Its contact line is the business's contact tutor, whose phone it is.

---

### Task 1: Migration 029

**Files:**
- Create: `src/lib/server/migrations/029_per_tutor_booking.ts`
- Modify: `src/lib/server/migrations/list.ts`
- Modify: `src/lib/server/entities.ts:12-21` (`TeacherRow`)
- Test: `tests/unit/per-tutor-migration.test.mjs`

**Interfaces:**
- Produces: columns `teachers.calendar_id TEXT`, `teachers.busy_ics TEXT`, `teachers.teaching_hours TEXT`, `bookings_v2.teacher_id INTEGER`, `pending_bookings.teacher_id INTEGER`. `TeacherRow` gains `calendar_id: string | null; busy_ics: string | null; teaching_hours: string | null`.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/per-tutor-migration.test.mjs
//
// Migration 029: each lesson belongs to a tutor
// (docs/superpowers/specs/2026-10-17-per-tutor-booking-design.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATIONS } from '../../src/lib/server/migrations/list.ts';

/** A fresh database brought up to `version`, the schema 029 meets in production. */
async function dbAt(version) {
  const db = new DatabaseSync(join(await mkdtemp(join(tmpdir(), 'm029-')), 'test.db'));
  db.exec('PRAGMA foreign_keys = ON');
  for (const m of MIGRATIONS.filter(m => m.version <= version).sort((a, b) => a.version - b.version)) db.exec(m.sql);
  return db;
}
const m029 = () => MIGRATIONS.find(m => m.version === 29);

test("029 gives each booking its enrollment's tutor, or the default tutor", async () => {
  const db = await dbAt(28);
  const [nikol, lior] = db.prepare(`SELECT id FROM teachers ORDER BY id`).all().map(r => r.id);
  db.prepare(`INSERT INTO accounts (name, phone, credential, is_self, created_at) VALUES ('משפחה', NULL, 'x', 0, '2026-01-01')`).run();
  db.prepare(`INSERT INTO students_v2 (code, name, account_id, credential, created_at) VALUES ('s1', 'דנה', 1, 'x', '2026-01-01')`).run();
  db.prepare(`INSERT INTO enrollments (student_id, subject, level, teacher_id) VALUES (1, 'מתמטיקה', 'ח', ?)`).run(lior);
  const booking = db.prepare(`INSERT INTO bookings_v2 (student_id, enrollment_id, start, "end", duration, at, status)
                              VALUES (1, ?, ?, ?, 45, '2026-01-01', 'confirmed')`);
  booking.run(1, '2027-01-01T10:00:00Z', '2027-01-01T10:45:00Z');
  booking.run(null, '2027-01-02T10:00:00Z', '2027-01-02T10:45:00Z');
  db.prepare(`INSERT INTO pending_bookings (account_id, body, start, "end", at, expires_at)
              VALUES (1, '{}', '2027-01-03T10:00:00Z', '2027-01-03T10:45:00Z', '2026-01-01', '2027-01-03T10:00:00Z')`).run();

  db.exec(m029().sql);

  assert.deepEqual(db.prepare(`SELECT teacher_id FROM bookings_v2 ORDER BY id`).all().map(r => r.teacher_id), [lior, nikol]);
  assert.equal(db.prepare(`SELECT teacher_id FROM pending_bookings`).get().teacher_id, nikol,
    'every enrollment is Nikol\'s today, so every hold is hers');
});

test('029 leaves every tutor on the default window, with no calendar and no busy address', async () => {
  const db = await dbAt(29);
  for (const t of db.prepare(`SELECT calendar_id, busy_ics, teaching_hours FROM teachers`).all()) {
    assert.deepEqual({ ...t }, { calendar_id: null, busy_ics: null, teaching_hours: null });
  }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test tests/unit/per-tutor-migration.test.mjs`
Expected: FAIL. The first test fails with `TypeError: Cannot read properties of undefined (reading 'sql')`, and the second with a `no such column: calendar_id` error.

- [ ] **Step 3: Write the migration and register it**

Create `src/lib/server/migrations/029_per_tutor_booking.ts`:

```ts
/**
 * Migration 029 — each lesson belongs to a tutor, and each tutor has their
 * own lesson calendar, busy times and teaching hours.
 *
 * `teachers.calendar_id`: the lesson calendar the robot writes this tutor's
 * lessons into. `busy_ics`: their private iCal addresses, one per line —
 * SECRET, each one reads a whole calendar. `teaching_hours`: JSON, NULL =
 * the default window (src/lib/teaching-hours.ts).
 *
 * `bookings_v2.teacher_id` / `pending_bookings.teacher_id`: who holds the
 * lesson, set when it is booked; moving a student later does not move it.
 * Backfilled: a booking takes its enrollment's tutor, else the default
 * tutor; every hold is the default tutor's (every enrollment is, today).
 * Legacy `bookings` rows get no column: they count as the default tutor's
 * wherever bookings are read (entities.ts, OVERLAP_SOURCE).
 * See docs/superpowers/specs/2026-10-17-per-tutor-booking-design.md.
 */
export const sql = `
ALTER TABLE teachers ADD COLUMN calendar_id TEXT;
ALTER TABLE teachers ADD COLUMN busy_ics TEXT;
ALTER TABLE teachers ADD COLUMN teaching_hours TEXT;
ALTER TABLE bookings_v2 ADD COLUMN teacher_id INTEGER REFERENCES teachers(id);
ALTER TABLE pending_bookings ADD COLUMN teacher_id INTEGER REFERENCES teachers(id);

UPDATE bookings_v2 SET teacher_id = COALESCE(
  (SELECT e.teacher_id FROM enrollments e WHERE e.id = bookings_v2.enrollment_id),
  (SELECT t.id FROM teachers t WHERE t.active = 1 ORDER BY t.id LIMIT 1)
);
UPDATE pending_bookings SET teacher_id =
  (SELECT t.id FROM teachers t WHERE t.active = 1 ORDER BY t.id LIMIT 1);

CREATE INDEX idx_bookings_v2_teacher_start ON bookings_v2(teacher_id, start);
`;
```

In `src/lib/server/migrations/list.ts`, add the import after `sql028`:

```ts
import { sql as sql029 } from './029_per_tutor_booking.ts';
```

Then add the entry after the 028 one:

```ts
  { version: 29, name: '029_per_tutor_booking', sql: sql029 },
```

In `src/lib/server/entities.ts`, add these fields to `TeacherRow` after `setup_expires: string | null;`:

```ts
  /** Migration 029 (tutor-settings.ts): the lesson calendar the robot
   *  writes this tutor's lessons into, their private iCal addresses (one
   *  per line — SECRET), and their teaching hours (JSON, NULL = default). */
  calendar_id: string | null;
  busy_ics: string | null;
  teaching_hours: string | null;
```

- [ ] **Step 4: Run it to see it pass, and the migration suite with it**

Run: `node --test tests/unit/per-tutor-migration.test.mjs tests/unit/migrations.test.mjs tests/unit/backfill-booking-enrollment.test.mjs`
Expected: PASS, with no failures.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/migrations/029_per_tutor_booking.ts src/lib/server/migrations/list.ts src/lib/server/entities.ts tests/unit/per-tutor-migration.test.mjs
git commit -F- <<'EOF'
Migration 029: each booking and hold records its tutor; tutors get calendar, busy and hours columns

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M83cAin9ny5QGUYH4Ydu6F
EOF
```

---

### Task 2: Bookings, holds and enrollments per tutor

**Files:**
- Modify: `src/lib/server/entities.ts`: `upsertEnrollment` at :242-258, `OVERLAP_SOURCE`/`slotTaken`/`reserveBooking` at :400-460, `readBookings`/`nextBookingForStudent` at :471-492
- Modify: `src/lib/server/pending-bookings.ts`
- Modify: `tests/unit/entities-students.test.mjs:47-55`
- Test: `tests/unit/per-tutor-bookings.test.mjs`

**Interfaces:**
- Consumes: Task 1 columns.
- Produces:
  - `slotTakenFor(teacherId: number, start: string, end: string): boolean`
  - `readBookingsFor(teacherId: number, fromIso: string, toIso: string): { start: string; end: string }[]`
  - `reserveBooking({ …, teacherId?: number | null }): number | null` (omitted means the default tutor)
  - `setEnrollmentTeacher(enrollmentId: number, teacherId: number): EnrollmentRow | null`
  - `nextBookingForStudent()` now also returns `teacherId: number | null`
  - `holdBooking({ accountId, teacherId?: number | null, body, now? })`
  - `HeldBooking.teacherId: number | null`
  - `slotTaken`/`readBookings` keep their "any tutor" meaning.

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/per-tutor-bookings.test.mjs
//
// A booking is its tutor's: another tutor's lesson leaves the hour free
// (migration 029, docs/superpowers/specs/2026-10-17-per-tutor-booking-design.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'per-tutor-')), 'results.db');
process.env.SESSION_SECRET = 'test-secret-not-a-real-one';
const E = await import('../../src/lib/server/entities.ts');
const P = await import('../../src/lib/server/pending-bookings.ts');
const { handle } = await import('../../src/lib/server/db.ts');

const [NIKOL, LIOR] = E.listTeachers().map(t => t.id);
const account = E.createAccount({ name: 'משפחה', credential: 'x', email: 'fam@example.com' });
const student = E.createStudent({ code: 'pt1', name: 'דנה', accountId: account.id, credential: 'x' });
let day = 0;
/** A fresh hour per test, so no test meets another's bookings. */
const hour = () => {
  day += 1;
  const d = String(day).padStart(2, '0');
  return { start: `2030-01-${d}T08:00:00.000Z`, end: `2030-01-${d}T09:30:00.000Z` };
};
const tutorOfBooking = id => handle().prepare(`SELECT teacher_id FROM bookings_v2 WHERE id = ?`).get(id).teacher_id;

test("another tutor's lesson does not take this tutor's hour", () => {
  const h = hour();
  assert.ok(E.reserveBooking({ studentId: student.id, ...h, durationMin: 90, teacherId: NIKOL }));
  assert.equal(E.slotTakenFor(NIKOL, h.start, h.end), true);
  assert.equal(E.slotTakenFor(LIOR, h.start, h.end), false);
  assert.ok(E.reserveBooking({ studentId: student.id, ...h, durationMin: 90, teacherId: LIOR }), 'Lior can teach at the same hour');
  assert.equal(E.reserveBooking({ studentId: student.id, ...h, durationMin: 90, teacherId: LIOR }), null, 'but not twice');
  assert.equal(E.slotTaken(h.start, h.end), true, 'slotTaken still asks about anyone');
});

test('a booking records its tutor; with none given, the default tutor', () => {
  assert.equal(tutorOfBooking(E.reserveBooking({ studentId: student.id, ...hour(), durationMin: 90, teacherId: LIOR })), LIOR);
  assert.equal(tutorOfBooking(E.reserveBooking({ studentId: student.id, ...hour(), durationMin: 90 })), NIKOL);
});

test("legacy bookings count as the default tutor's", () => {
  const h = hour();
  handle().prepare(`INSERT INTO bookings (name, start, "end", at, status) VALUES ('ישן', ?, ?, '2026-01-01', 'confirmed')`).run(h.start, h.end);
  assert.equal(E.slotTakenFor(NIKOL, h.start, h.end), true);
  assert.equal(E.slotTakenFor(LIOR, h.start, h.end), false);
  assert.equal(E.readBookingsFor(NIKOL, h.start, h.end).length, 1);
  assert.deepEqual(E.readBookingsFor(LIOR, h.start, h.end), []);
});

test("a hold is its tutor's", () => {
  const h = hour();
  const id = P.holdBooking({ accountId: account.id, teacherId: LIOR, body: { ...h }, now: new Date('2029-12-31T00:00:00Z') });
  assert.equal(E.slotTakenFor(LIOR, h.start, h.end), true);
  assert.equal(E.slotTakenFor(NIKOL, h.start, h.end), false);
  assert.equal(P.pendingById(id).teacherId, LIOR);
});

test("booking again keeps the student's tutor", () => {
  const s = E.createStudent({ code: 'pt2', name: 'נועה', accountId: account.id, credential: 'x' });
  E.upsertEnrollment({ studentId: s.id, subject: 'מתמטיקה', level: 'ח', teacherId: LIOR });
  const again = E.upsertEnrollment({ studentId: s.id, subject: 'מתמטיקה', level: 'ט', teacherId: NIKOL });
  assert.equal(again.teacher_id, LIOR);
  assert.equal(again.level, 'ט', 'the level still follows the booking');
});

test("an enrollment with no tutor, or a deactivated one, takes the booking's", () => {
  const s = E.createStudent({ code: 'pt3', name: 'יואב', accountId: account.id, credential: 'x' });
  const enr = E.upsertEnrollment({ studentId: s.id, subject: 'מתמטיקה', teacherId: null });
  assert.equal(E.upsertEnrollment({ studentId: s.id, subject: 'מתמטיקה', teacherId: LIOR }).teacher_id, LIOR);
  const gone = E.createTeacher({ name: 'לשעבר' });
  E.setEnrollmentTeacher(enr.id, gone.id);
  handle().prepare(`UPDATE teachers SET active = 0 WHERE id = ?`).run(gone.id);
  assert.equal(E.upsertEnrollment({ studentId: s.id, subject: 'מתמטיקה', teacherId: NIKOL }).teacher_id, NIKOL);
});

test('moving a student changes their enrollment, never a lesson already booked', () => {
  const s = E.createStudent({ code: 'pt4', name: 'אורי', accountId: account.id, credential: 'x' });
  const enr = E.upsertEnrollment({ studentId: s.id, subject: 'מתמטיקה', teacherId: NIKOL });
  const booked = E.reserveBooking({ studentId: s.id, enrollmentId: enr.id, ...hour(), durationMin: 90, teacherId: NIKOL });
  assert.equal(E.setEnrollmentTeacher(enr.id, LIOR).teacher_id, LIOR);
  assert.equal(tutorOfBooking(booked), NIKOL);
  assert.equal(E.setEnrollmentTeacher(999999, LIOR), null, 'no such enrollment');
});

test('the next lesson says who teaches it', () => {
  const s = E.createStudent({ code: 'pt5', name: 'מיה', accountId: account.id, credential: 'x' });
  E.reserveBooking({ studentId: s.id, start: '2031-05-01T08:00:00.000Z', end: '2031-05-01T09:00:00.000Z', durationMin: 45, teacherId: LIOR });
  assert.equal(E.nextBookingForStudent(s.id, '2031-01-01T00:00:00.000Z').teacherId, LIOR);
});
```

Update the old expectation in `tests/unit/entities-students.test.mjs`. In the test `'upsertEnrollment updates rather than duplicating the same subject'`, replace

```js
  assert.equal(again.teacher_id, nika.id);
```

with

```js
  // Migration 029: booking again keeps the student's tutor; only the
  // dashboard moves a student (setEnrollmentTeacher).
  assert.equal(again.teacher_id, nicole.id);
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/unit/per-tutor-bookings.test.mjs tests/unit/entities-students.test.mjs`
Expected: FAIL. The errors are `E.slotTakenFor is not a function`, `E.readBookingsFor is not a function` and `E.setEnrollmentTeacher is not a function`, plus an `actual 2 / expected 1` style mismatch on `teacher_id`.

- [ ] **Step 3: Implement**

In `src/lib/server/entities.ts`, replace the whole `upsertEnrollment` (doc comment included) with:

```ts
/** Keyed on (student_id, subject) by the table's UNIQUE constraint, so
 *  re-booking the same subject updates the level rather than accumulating
 *  duplicate enrollments.
 *
 *  The tutor is KEPT (migration 029): a student's tutor changes only from
 *  the dashboard (setEnrollmentTeacher), never because the family booked
 *  again. An enrollment with no tutor, or with one who has been
 *  deactivated, takes this booking's tutor instead — otherwise every
 *  booking would fall through to someone new and the student would never
 *  settle with anyone. */
export function upsertEnrollment(
  e: { studentId: number; subject: string; level?: string | null; teacherId?: number | null },
): EnrollmentRow {
  handle().prepare(`
    INSERT INTO enrollments (student_id, subject, level, teacher_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (student_id, subject)
    DO UPDATE SET level = excluded.level,
      teacher_id = CASE
        WHEN enrollments.teacher_id IN (SELECT id FROM teachers WHERE active = 1) THEN enrollments.teacher_id
        ELSE excluded.teacher_id
      END
  `).run(e.studentId, e.subject, e.level ?? null, e.teacherId ?? null);

  return handle().prepare(
    `SELECT * FROM enrollments WHERE student_id = ? AND subject = ?`
  ).get(e.studentId, e.subject) as EnrollmentRow;
}

/** Moving a student to another tutor, from the dashboard. That enrollment
 *  and nothing else: lessons already booked keep the tutor they were
 *  booked with (bookings_v2.teacher_id). */
export function setEnrollmentTeacher(enrollmentId: number, teacherId: number): EnrollmentRow | null {
  handle().prepare(`UPDATE enrollments SET teacher_id = ? WHERE id = ?`).run(teacherId, enrollmentId);
  return (handle().prepare(`SELECT * FROM enrollments WHERE id = ?`).get(enrollmentId) as EnrollmentRow) ?? null;
}
```

Replace `OVERLAP_SOURCE` with:

```ts
/* The tutor every legacy row, and any booking or hold with no tutor
   recorded, belongs to: the default tutor (migration 029). */
const DEFAULT_TEACHER_ID = `(SELECT id FROM teachers WHERE active = 1 ORDER BY id LIMIT 1)`;

const OVERLAP_SOURCE = `
  SELECT start, "end" AS finish, status, ${DEFAULT_TEACHER_ID} AS teacher_id FROM bookings
  UNION ALL
  SELECT start, "end" AS finish, status, COALESCE(teacher_id, ${DEFAULT_TEACHER_ID}) FROM bookings_v2
  UNION ALL
  -- A booking waiting for its family's confirmation holds the hour until it
  -- expires (migration 021); read as 'confirmed' so both consumers see it.
  SELECT start, "end" AS finish, 'confirmed' AS status, COALESCE(teacher_id, ${DEFAULT_TEACHER_ID}) FROM pending_bookings
   WHERE status = 'pending' AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
`;
```

Directly after `slotTaken`, add:

```ts
/** slotTaken, for one tutor: another tutor's lesson does not take this
 *  tutor's hour (migration 029). The check /api/book makes, inside its
 *  no-await block, for the tutor it has just chosen. */
export function slotTakenFor(teacherId: number, start: string, end: string): boolean {
  return !!handle().prepare(`
    SELECT 1 FROM (${OVERLAP_SOURCE})
    WHERE status = 'confirmed' AND teacher_id = ? AND finish > ? AND start < ?
    LIMIT 1
  `).get(teacherId, start, end);
}
```

In `reserveBooking`, add this to the parameter type after `mode?: LessonMode | null;`:

```ts
  /** Who teaches it (migration 029); omitted, the default tutor. */
  teacherId?: number | null;
```

Then replace the body from `// Calls slotTaken rather than repeating its query,` through `return Number(info.lastInsertRowid);` with:

```ts
  // Calls slotTakenFor rather than repeating its query, so the standalone
  // check and the one guarding this insert can never drift apart.
  const teacherId = b.teacherId ?? defaultTeacher()?.id ?? null;
  if (teacherId == null ? slotTaken(b.start, b.end) : slotTakenFor(teacherId, b.start, b.end)) return null;

  const info = handle().prepare(`
    INSERT INTO bookings_v2 (student_id, enrollment_id, start, "end", duration, at, status, source_utm, heard_from, mode, teacher_id)
    VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?)
  `).run(b.studentId, b.enrollmentId ?? null, b.start, b.end,
         b.durationMin ?? null, new Date().toISOString(),
         b.sourceUtm ?? null, b.heardFrom ?? null, b.mode ?? null, teacherId);

  return Number(info.lastInsertRowid);
```

Directly after `readBookings`, add:

```ts
/** readBookings, for one tutor: what blocks THEIR hours. */
export function readBookingsFor(teacherId: number, fromIso: string, toIso: string): { start: string; end: string }[] {
  return handle().prepare(`
    SELECT start, finish AS end FROM (${OVERLAP_SOURCE})
    WHERE status = 'confirmed' AND teacher_id = ? AND finish > ? AND start < ?
    ORDER BY start
  `).all(teacherId, fromIso, toIso) as { start: string; end: string }[];
}
```

Replace `nextBookingForStudent` with:

```ts
/** The next confirmed booking for one student, used by tutor and family
 * dashboards instead of a browser-local "next lesson" field. `teacherId`
 * is who teaches it (migration 029). */
export function nextBookingForStudent(studentId: number, nowIso: string = new Date().toISOString()): {
  id: number; start: string; end: string; duration: number | null; teacherId: number | null;
} | null {
  return (handle().prepare(`
    SELECT id, start, "end" AS end, duration, teacher_id AS teacherId
    FROM bookings_v2
    WHERE student_id = ? AND status = 'confirmed' AND start > ?
    ORDER BY start ASC LIMIT 1
  `).get(studentId, nowIso) as { id: number; start: string; end: string; duration: number | null; teacherId: number | null } | undefined) ?? null;
}
```

In `src/lib/server/pending-bookings.ts`:
- **`HeldBooking`:** add the field `/** Who the hold is with (migration 029); null only for holds older than it. */ teacherId: number | null;`.
- **`holdBooking`:** in its parameter type add `/** Who it is held with (migration 029). */ teacherId?: number | null;`.
- **`holdBooking`'s INSERT:** replace it with:

```ts
  const info = handle().prepare(`
    INSERT INTO pending_bookings (account_id, body, start, "end", at, expires_at, teacher_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(h.accountId, JSON.stringify(h.body), h.body.start, h.body.end,
         now.toISOString(), holdExpiry(now, h.body.start), h.teacherId ?? null);
```

Then replace `Row`, `toHeld` and the `pendingById` SELECT so the tutor is read back:

```ts
type Row = { id: number; account_id: number; body: string; expires_at: string; teacher_id: number | null };
const toHeld = (r: Row): HeldBooking => ({
  id: r.id, accountId: r.account_id, body: JSON.parse(r.body), expiresAt: r.expires_at, teacherId: r.teacher_id,
});
```

```ts
  const r = handle().prepare(`SELECT id, account_id, body, expires_at, teacher_id FROM pending_bookings WHERE id = ? AND ${LIVE}`)
    .get(id) as Row | undefined;
```

- [ ] **Step 4: Run them to see them pass, with the suites that use these accessors**

Run: `node --test tests/unit/per-tutor-bookings.test.mjs tests/unit/entities-students.test.mjs tests/unit/bookings.test.mjs tests/unit/pending-bookings.test.mjs tests/unit/lesson-mode.test.mjs tests/unit/payments.test.mjs`
Expected: PASS, with no failures.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/entities.ts src/lib/server/pending-bookings.ts tests/unit/per-tutor-bookings.test.mjs tests/unit/entities-students.test.mjs
git commit -F- <<'EOF'
Each booking and hold is its tutor's; another tutor's lesson leaves the hour free

Booking again no longer resets a student's tutor: an enrollment keeps it
unless it is unset or deactivated. setEnrollmentTeacher moves a student.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M83cAin9ny5QGUYH4Ydu6F
EOF
```

---

### Task 3: Teaching hours and tutor settings

**Files:**
- Create: `src/lib/teaching-hours.ts` (pure, imported by the server and the dashboard)
- Create: `src/lib/server/tutor-settings.ts`
- Test: `tests/unit/teaching-hours.test.mjs`, `tests/unit/tutor-settings.test.mjs`

**Interfaces:**
- Consumes: `TeacherRow` (Task 1), `getTeacher`, `defaultTeacher`, `handle`.
- Produces from `$lib/teaching-hours.ts`:
  - `type Weekday = 0|1|2|3|4|5` and `type TeachingHours = Partial<Record<Weekday, [string, string]>>`
  - `WEEKDAYS: Weekday[]`, `WEEKDAY_NAMES: string[]`, `DEFAULT_HOURS`
  - `minutesOf(hhmm: string): number`
  - `parseTeachingHours(raw: unknown): TeachingHours | null`
- Produces from `tutor-settings.ts`:
  - `splitAddresses(raw?: string | null): string[]`
  - `busyAddresses(t): string[]`
  - `parseBusyAddresses(raw: unknown): string[] | null`
  - `teachingHours(t): TeachingHours`
  - `type MissingSetting = 'calendar' | 'busy'` and `missingForBookings(t: TeacherRow): MissingSetting[]`
  - `takesBookings(t: TeacherRow): boolean`
  - `interface TutorSettingsPatch { calendarId?; busyIcs?: string[]; teachingHours?: TeachingHours | null }`
  - `updateTutorSettings(id: number, p: TutorSettingsPatch): TeacherRow | null`
  - `tutorCardView(t: TeacherRow)`, which returns `{ id, name, phone, meetUrl, account, calendarId, busyCount, teachingHours, missing }`

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/teaching-hours.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTeachingHours, DEFAULT_HOURS, minutesOf } from '../../src/lib/teaching-hours.ts';

test("the default week is today's window", () => {
  assert.deepEqual(DEFAULT_HOURS[0], ['08:00', '21:00']);
  assert.deepEqual(DEFAULT_HOURS[4], ['08:00', '21:00']);
  assert.deepEqual(DEFAULT_HOURS[5], ['08:00', '16:00']);
  assert.equal(DEFAULT_HOURS[6], undefined, 'Saturday is off');
});

test('a week with a day off and a short day is accepted as written', () => {
  assert.deepEqual(parseTeachingHours({ 0: ['09:00', '18:00'], 5: ['08:00', '12:30'] }),
    { 0: ['09:00', '18:00'], 5: ['08:00', '12:30'] });
  assert.deepEqual(parseTeachingHours({}), {}, 'a week off is a week');
});

test('Saturday, a bad time, or a day that ends before it starts refuses the whole week', () => {
  for (const bad of [
    { 6: ['08:00', '12:00'] }, { 0: ['8:00', '12:00'] }, { 0: ['12:00', '12:00'] },
    { 0: ['13:00', '12:00'] }, { 0: ['08:00'] }, { 0: ['08:00', '25:00'] }, [], null, 'x',
  ]) assert.equal(parseTeachingHours(bad), null, JSON.stringify(bad));
});

test('minutes from midnight', () => {
  assert.equal(minutesOf('08:30'), 510);
  assert.equal(minutesOf('24:00'), 1440);
});
```

```js
// tests/unit/tutor-settings.test.mjs
//
// A tutor's booking settings (migration 029). busy_ics is a secret: what
// leaves this module is a count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'tutor-settings-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const S = await import('../../src/lib/server/tutor-settings.ts');
const { DEFAULT_HOURS } = await import('../../src/lib/teaching-hours.ts');
const { handle } = await import('../../src/lib/server/db.ts');

const LIOR = E.listTeachers()[1].id;
const FEED = 'https://calendar.google.com/calendar/ical/x/private-y/basic.ics';

test('a tutor takes bookings once they have a lesson calendar and a busy address', () => {
  S.updateTutorSettings(LIOR, { calendarId: null, busyIcs: [] });
  assert.deepEqual(S.missingForBookings(E.getTeacher(LIOR)), ['calendar', 'busy']);
  assert.deepEqual(S.missingForBookings(S.updateTutorSettings(LIOR, { calendarId: 'lior@group.calendar.google.com' })), ['busy']);
  assert.equal(S.takesBookings(S.updateTutorSettings(LIOR, { busyIcs: [FEED] })), true);
});

test('a deactivated tutor takes no bookings, whatever is set', () => {
  S.updateTutorSettings(LIOR, { calendarId: 'lior@group.calendar.google.com', busyIcs: [FEED] });
  handle().prepare(`UPDATE teachers SET active = 0 WHERE id = ?`).run(LIOR);
  try {
    assert.equal(S.takesBookings(E.getTeacher(LIOR)), false);
  } finally {
    handle().prepare(`UPDATE teachers SET active = 1 WHERE id = ?`).run(LIOR);
  }
});

test('a pasted list splits on lines, commas and spaces, and drops blanks', () => {
  assert.deepEqual(
    S.parseBusyAddresses('https://a.example/1.ics\n\n  https://b.example/2.ics ,https://c.example/3.ics\n'),
    ['https://a.example/1.ics', 'https://b.example/2.ics', 'https://c.example/3.ics'],
  );
  assert.deepEqual(S.parseBusyAddresses(''), [], 'empty clears');
});

test('an address that is not https refuses the whole list', () => {
  assert.equal(S.parseBusyAddresses('https://a.example/1.ics\nhttp://b.example/2.ics'), null);
  assert.equal(S.parseBusyAddresses('webcal://calendar.example/x.ics'), null);
  assert.equal(S.parseBusyAddresses('not a url'), null);
  assert.equal(S.parseBusyAddresses(5), null);
});

test('hours: stored, or the default window', () => {
  assert.deepEqual(S.teachingHours({ teaching_hours: null }), DEFAULT_HOURS);
  assert.deepEqual(S.teachingHours(S.updateTutorSettings(LIOR, { teachingHours: { 0: ['10:00', '14:00'] } })), { 0: ['10:00', '14:00'] });
  assert.deepEqual(S.teachingHours(S.updateTutorSettings(LIOR, { teachingHours: null })), DEFAULT_HOURS);
});

test('a setting left out of the patch is left as it was', () => {
  S.updateTutorSettings(LIOR, { calendarId: 'keep@group.calendar.google.com' });
  const t = S.updateTutorSettings(LIOR, { busyIcs: [FEED] });
  assert.equal(t.calendar_id, 'keep@group.calendar.google.com');
});

test('the card sees a count of addresses, never the addresses', () => {
  const t = S.updateTutorSettings(LIOR, {
    busyIcs: ['https://calendar.google.com/calendar/ical/x/private-SECRET1/basic.ics',
              'https://calendar.google.com/calendar/ical/x/private-SECRET2/basic.ics'],
  });
  const view = S.tutorCardView(t);
  assert.equal(view.busyCount, 2);
  assert.doesNotMatch(JSON.stringify(view), /SECRET|private-/);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/unit/teaching-hours.test.mjs tests/unit/tutor-settings.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `teaching-hours.ts` and `tutor-settings.ts`.

- [ ] **Step 3: Implement**

Create `src/lib/teaching-hours.ts`:

```ts
/**
 * A tutor's teaching hours (teachers.teaching_hours, migration 029).
 *
 * Shared by the server (which slots to offer) and the dashboard's editor,
 * so the two can never disagree about what a valid week is.
 *
 *   {"0":["08:00","21:00"], …, "5":["08:00","16:00"]}
 *
 * Keys are weekdays in Israel time, Sunday = 0 to Friday = 5; a missing key
 * is a day off, and Saturday is always off. Each pair is the earliest START
 * and the latest END of a lesson.
 */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5;
export type TeachingHours = Partial<Record<Weekday, [string, string]>>;

export const WEEKDAYS: Weekday[] = [0, 1, 2, 3, 4, 5];
export const WEEKDAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];

/** Today's window: Sunday to Thursday 08:00–21:00, Friday 08:00–16:00. */
export const DEFAULT_HOURS: TeachingHours = {
  0: ['08:00', '21:00'], 1: ['08:00', '21:00'], 2: ['08:00', '21:00'],
  3: ['08:00', '21:00'], 4: ['08:00', '21:00'], 5: ['08:00', '16:00'],
};

const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/;

/** "08:30" → 510. */
export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** A week as the dashboard sends it, or null if any part of it is wrong: a
 *  key that is not Sunday–Friday, a time that is not HH:MM, or a day that
 *  does not end after it starts. Nothing is half-accepted. */
export function parseTeachingHours(raw: unknown): TeachingHours | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: TeachingHours = {};
  for (const [key, pair] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[0-5]$/.test(key)) return null;
    if (!Array.isArray(pair) || pair.length !== 2) return null;
    const [from, to] = pair;
    if (typeof from !== 'string' || typeof to !== 'string' || !HHMM.test(from) || !HHMM.test(to)) return null;
    if (minutesOf(from) >= minutesOf(to)) return null;
    out[Number(key) as Weekday] = [from, to];
  }
  return out;
}
```

Create `src/lib/server/tutor-settings.ts`:

```ts
/**
 * A tutor's booking settings (migration 029): the lesson calendar the robot
 * writes their lessons into, the private iCal addresses that say when they
 * are busy, and their teaching hours. Set from the dashboard's "מורים"
 * card; see docs/superpowers/specs/2026-10-17-per-tutor-booking-design.md.
 *
 * busy_ics is a SECRET — each address reads a whole personal calendar. It is
 * never logged and never returned: what leaves this module is a count.
 */
import { handle } from './db.ts';
import { getTeacher, type TeacherRow } from './entities.ts';
import { DEFAULT_HOURS, parseTeachingHours, type TeachingHours } from '../teaching-hours.ts';

/** One address per line; commas and spaces split too, as CALENDAR_ICS_URLS always did. */
export function splitAddresses(raw?: string | null): string[] {
  return (raw ?? '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
}

export const busyAddresses = (t: Pick<TeacherRow, 'busy_ics'>): string[] => splitAddresses(t.busy_ics);

/** The dashboard's address field: https addresses only — a private Google
 *  iCal address is one. null = refused, with nothing half-saved. */
export function parseBusyAddresses(raw: unknown): string[] | null {
  if (typeof raw !== 'string') return null;
  const list = splitAddresses(raw);
  const https = (u: string) => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };
  return list.every(https) ? list : null;
}

/** The tutor's stored hours, or the default window when none are stored. */
export function teachingHours(t: Pick<TeacherRow, 'teaching_hours'>): TeachingHours {
  if (!t.teaching_hours) return DEFAULT_HOURS;
  try { return parseTeachingHours(JSON.parse(t.teaching_hours)) ?? DEFAULT_HOURS; } catch { return DEFAULT_HOURS; }
}

export type MissingSetting = 'calendar' | 'busy';

/** What stands between a tutor and their first booking; [] = ready. */
export function missingForBookings(t: TeacherRow): MissingSetting[] {
  const missing: MissingSetting[] = [];
  if (!t.calendar_id?.trim()) missing.push('calendar');
  if (!busyAddresses(t).length) missing.push('busy');
  return missing;
}

/** Offered hours and given bookings only when active, with a calendar to
 *  write into and at least one to read busy times from. The Meet room is
 *  not required: an online lesson without one names the mode with no link,
 *  as it does today. */
export const takesBookings = (t: TeacherRow): boolean => !!t.active && missingForBookings(t).length === 0;

export interface TutorSettingsPatch {
  calendarId?: string | null;
  /** Replaces every address; [] clears them. */
  busyIcs?: string[];
  /** null = back to the default window. */
  teachingHours?: TeachingHours | null;
}

/** Writes only what the patch names: an omitted key leaves its column as it was. */
export function updateTutorSettings(id: number, p: TutorSettingsPatch): TeacherRow | null {
  const sets: string[] = [];
  const params: (string | null)[] = [];
  if (p.calendarId !== undefined) { sets.push('calendar_id = ?'); params.push(p.calendarId?.trim() || null); }
  if (p.busyIcs !== undefined) { sets.push('busy_ics = ?'); params.push(p.busyIcs.length ? p.busyIcs.join('\n') : null); }
  if (p.teachingHours !== undefined) { sets.push('teaching_hours = ?'); params.push(p.teachingHours ? JSON.stringify(p.teachingHours) : null); }
  if (sets.length) handle().prepare(`UPDATE teachers SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  return getTeacher(id);
}

/** What the "מורים" card shows of a tutor: the busy addresses as a count,
 *  never their text. Never setup_hash either. */
export function tutorCardView(t: TeacherRow) {
  return {
    id: t.id, name: t.name, phone: t.phone, meetUrl: t.meet_url, account: t.meet_account,
    calendarId: t.calendar_id,
    busyCount: busyAddresses(t).length,
    teachingHours: teachingHours(t),
    missing: missingForBookings(t),
  };
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `node --test tests/unit/teaching-hours.test.mjs tests/unit/tutor-settings.test.mjs`
Expected: PASS, with no failures.

- [ ] **Step 5: Commit**

```bash
git add src/lib/teaching-hours.ts src/lib/server/tutor-settings.ts tests/unit/teaching-hours.test.mjs tests/unit/tutor-settings.test.mjs
git commit -F- <<'EOF'
A tutor's settings: lesson calendar, private busy addresses (kept secret), teaching hours

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M83cAin9ny5QGUYH4Ydu6F
EOF
```

---

### Task 4: Nikol's row takes over the `.env` values; `CALENDAR_ID` stops being required

**Files:**
- Modify: `src/lib/server/tutor-settings.ts` (add `adoptEnvCalendar`)
- Modify: `src/hooks.server.ts:49` (after the db import)
- Modify: `src/lib/server/boot-checks.ts:123-130` (drop the `CALENDAR_ID` entry)
- Modify: `tests/unit/boot-checks.test.mjs:324-344` (the `CALENDAR_ID is required` test)
- Modify: `tests/characterization/harness.mjs` (Nikol's empty busy feed: ruling R1)
- Test: `tests/unit/adopt-env-calendar.test.mjs`, `tests/characterization/tutor-calendar-takeover.test.mjs`

**Interfaces:**
- Consumes: Task 3 (`updateTutorSettings`, `splitAddresses`, `busyAddresses`, `takesBookings`).
- Produces: `adoptEnvCalendar(env?: Record<string, string | undefined>): boolean`. In every characterization server, Nikol (id 1) has `calendar_id = 'test-calendar@example.com'` and `busy_ics = 'http://127.0.0.1:<port>/nikol.ics'`, an empty calendar, so she takes bookings.

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/adopt-env-calendar.test.mjs
//
// On the first boot after migration 029, the default tutor's row takes over
// CALENDAR_ID and CALENDAR_ICS_URLS from .env — once, never overwriting,
// and logging only that it happened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'adopt-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const S = await import('../../src/lib/server/tutor-settings.ts');

const ENV = {
  CALENDAR_ID: 'lessons@group.calendar.google.com',
  CALENDAR_ICS_URLS: 'https://calendar.google.com/calendar/ical/a/private-TOKENA/basic.ics,https://calendar.google.com/calendar/ical/b/private-TOKENB/basic.ics',
};

/** Runs fn with every console line captured. */
function captured(fn) {
  const lines = [];
  const saved = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(saved)) console[k] = (...a) => lines.push(a.map(String).join(' '));
  try { return { result: fn(), lines }; } finally { Object.assign(console, saved); }
}

test("the default tutor's row takes over the .env values, and only that it happened is logged", () => {
  const { result, lines } = captured(() => S.adoptEnvCalendar(ENV));
  assert.equal(result, true);
  const nikol = E.defaultTeacher();
  assert.equal(nikol.calendar_id, ENV.CALENDAR_ID);
  assert.deepEqual(S.busyAddresses(nikol), ENV.CALENDAR_ICS_URLS.split(','));
  assert.equal(S.takesBookings(nikol), true);
  assert.equal(S.takesBookings(E.listTeachers()[1]), false, 'Lior is untouched');
  assert.match(lines.join('\n'), /ניקול/);
  assert.doesNotMatch(lines.join('\n'), /TOKENA|TOKENB|lessons@/);
});

test('it never overwrites what the row already has', () => {
  S.updateTutorSettings(E.defaultTeacher().id, { calendarId: 'changed@group.calendar.google.com' });
  assert.equal(S.adoptEnvCalendar({ CALENDAR_ID: 'other@group.calendar.google.com', CALENDAR_ICS_URLS: 'https://x.example/o.ics' }), false);
  assert.equal(E.defaultTeacher().calendar_id, 'changed@group.calendar.google.com');
});

test('a row with only one of the two set is not touched either', () => {
  S.updateTutorSettings(E.defaultTeacher().id, { calendarId: null, busyIcs: ['https://x.example/keep.ics'] });
  assert.equal(S.adoptEnvCalendar(ENV), false);
  assert.equal(E.defaultTeacher().calendar_id, null);
});

test('nothing in .env, nothing to take over', () => {
  S.updateTutorSettings(E.defaultTeacher().id, { calendarId: null, busyIcs: [] });
  assert.equal(S.adoptEnvCalendar({}), false);
});

test('boot takes them over once the database is migrated', async () => {
  const hooks = await readFile(new URL('../../src/hooks.server.ts', import.meta.url), 'utf8');
  const db = hooks.indexOf("await import('$server/db.ts')");
  const adopt = hooks.indexOf('adoptEnvCalendar()');
  assert.ok(db > 0 && adopt > db, 'adoptEnvCalendar() runs after the db import');
});
```

```js
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
```

In `tests/unit/boot-checks.test.mjs`, replace the whole test `'CALENDAR_ID is required, so no booking can be silently misrouted'` with:

```js
test('CALENDAR_ID is no longer required: each tutor has their own lesson calendar', () => {
  // Migration 029 moved it onto the tutor's row (tutor-settings.ts). A tutor
  // without one is never offered and never assigned, so there is no global
  // calendar left for a missing value to misroute every booking to.
  assert.ok(!REQUIRED_VARS.some(v => v.key === 'CALENDAR_ID'));
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm run build && node --test tests/unit/adopt-env-calendar.test.mjs tests/unit/boot-checks.test.mjs tests/characterization/tutor-calendar-takeover.test.mjs`
Expected: FAIL.
- `S.adoptEnvCalendar is not a function`.
- The boot-checks assertion fails, because `CALENDAR_ID` is still listed.
- The takeover test fails on `calendar_id` (`null !== 'lessons@example.com'`).
- `the server boots without CALENDAR_ID now` fails with `server exited 1 before listening … CALENDAR_ID`.

- [ ] **Step 3: Implement**

Append to `src/lib/server/tutor-settings.ts`, and add `defaultTeacher` to its `./entities.ts` import:

```ts
/**
 * The first boot after migration 029: the default tutor's row takes over
 * CALENDAR_ID and CALENDAR_ICS_URLS from .env, so booking carries on
 * exactly as before with nothing set by hand.
 *
 * Only when her row has neither a calendar nor a busy address yet, so it
 * happens once and never overwrites anything — after it, the two .env
 * lines can be deleted. Only that it happened is logged, never the values:
 * the iCal addresses are secrets.
 *
 * @returns whether anything was copied.
 */
export function adoptEnvCalendar(env: Record<string, string | undefined> = process.env): boolean {
  const t = defaultTeacher();
  if (!t || t.calendar_id || t.busy_ics) return false;
  const calendarId = env.CALENDAR_ID?.trim() || null;
  const busy = splitAddresses(env.CALENDAR_ICS_URLS);
  if (!calendarId && !busy.length) return false;
  updateTutorSettings(t.id, { calendarId, busyIcs: busy });
  console.log(`[boot] ${t.name} took over CALENDAR_ID and CALENDAR_ICS_URLS from .env — both lines can be deleted now`);
  return true;
}
```

In `src/hooks.server.ts`, directly after `await import('$server/db.ts');` inside the `if (!dev)` block, add:

```ts

  // Migration 029: the default tutor's row takes over CALENDAR_ID and
  // CALENDAR_ICS_URLS, once (tutor-settings.ts). After that nothing reads them.
  const { adoptEnvCalendar } = await import('$server/tutor-settings.ts');
  adoptEnvCalendar();
```

In `src/lib/server/boot-checks.ts`, delete the whole `{ key: 'CALENDAR_ID', why: … }` entry from `REQUIRED_VARS`.

In `tests/characterization/harness.mjs`:
1. Add `import { createServer as createHttpServer } from 'node:http';` to the imports.
2. Directly after the `BLOCKED` array, add:

```js
/* Nikol's busy times, for every test: a feed that answers with an empty
   calendar. A tutor with no busy address takes no bookings (tutor-settings.ts,
   takesBookings), and production has Nikol reading two — so without this the
   suite would book through a path production never takes. Served from this
   test process, once, and unref'd so it never keeps a test alive. Her row
   takes it over at boot, with CALENDAR_ID (adoptEnvCalendar). */
let emptyFeed;
function emptyFeedUrl() {
  emptyFeed ??= new Promise((resolve, reject) => {
    const feed = createHttpServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/calendar' });
      res.end('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n');
    });
    feed.unref();
    feed.on('error', reject);
    feed.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${feed.address().port}/nikol.ics`));
  });
  return emptyFeed;
}
```

3. Replace the `CALENDAR_ID` comment and line inside `Object.assign(childEnv, { … })` with:

```js
      // Nikol's lesson calendar and busy feed: her row takes both over at
      // boot (adoptEnvCalendar). The calendar is never written to:
      // GOOGLE_SERVICE_ACCOUNT_* are in BLOCKED, so no test reaches Google.
      CALENDAR_ID: 'test-calendar@example.com',
      CALENDAR_ICS_URLS: await emptyFeedUrl(),
```

- [ ] **Step 4: Run them to see them pass, then the whole suite**

Run: `npm run build && node --test tests/unit/adopt-env-calendar.test.mjs tests/unit/boot-checks.test.mjs tests/characterization/tutor-calendar-takeover.test.mjs`
Expected: PASS, with no failures.

Run: `node --test "tests/**/*.test.mjs" > /tmp/claude-1000/suite-t4.log 2>&1; tail -12 /tmp/claude-1000/suite-t4.log`
Expected: `# fail 0`. Nothing reads the settings yet, so nothing else changes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/tutor-settings.ts src/hooks.server.ts src/lib/server/boot-checks.ts tests/unit/boot-checks.test.mjs tests/characterization/harness.mjs tests/unit/adopt-env-calendar.test.mjs tests/characterization/tutor-calendar-takeover.test.mjs
git commit -F- <<'EOF'
Nikol's row takes over CALENDAR_ID and CALENDAR_ICS_URLS once; CALENDAR_ID is no longer required

The test harness gives Nikol an empty, reachable busy feed, the shape
production has, so the suite books through the path production takes.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M83cAin9ny5QGUYH4Ydu6F
EOF
```

---

### Task 5: Free slots per tutor, and choosing a tutor for one hour

**Files:**
- Create: `src/lib/server/tutor-slots.ts` (pure)
- Test: `tests/unit/tutor-slots.test.mjs`

**Interfaces:**
- Consumes: `$lib/teaching-hours.ts` (Task 3); `type BusyInterval` from `calendar.ts` (type-only import, so no network module is loaded).
- Produces:
  - `BUFFER_MIN = 30`, `LESSON_BREAK_MIN = 15`
  - `interface Slot { start; end; dateLabel; timeLabel; dayOfWeek }`
  - `interface TutorDay { hours: TeachingHours; calendar: BusyInterval[]; bookings: BusyInterval[] }`
  - `buildBookingWindow(now?: Date): { days: Date[]; timeMin: string | null; timeMax: string | null }`
  - `ilMinutesToUTC(dayUTC: Date, minutes: number): number`
  - `tutorSlots(days: Date[], t: TutorDay, durationMin: number): Slot[]`
  - `unionSlots(lists: Slot[][]): Slot[]`
  - `offers(t: TutorDay, start: string, end: string): boolean`
  - `clashes(t: Pick<TutorDay, 'calendar' | 'bookings'>, start: string, end: string): boolean`
  - `pickTutor<T extends { id: number }>(candidates: T[], start: string, end: string, dayOf: (t: T) => TutorDay): T | null`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/tutor-slots.test.mjs
//
// Free slots per tutor, and which tutor takes one hour. Pure: no database,
// no network. Monday 2027-03-15 and Friday 2027-03-19 are UTC+2 in Israel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tutorSlots, unionSlots, offers, pickTutor, ilMinutesToUTC } from '../../src/lib/server/tutor-slots.ts';
import { DEFAULT_HOURS } from '../../src/lib/teaching-hours.ts';

const SUN = new Date('2027-03-14T00:00:00.000Z');
const MON = new Date('2027-03-15T00:00:00.000Z');
const FRI = new Date('2027-03-19T00:00:00.000Z');
const day = (over = {}) => ({ hours: DEFAULT_HOURS, calendar: [], bookings: [], ...over });
const times = slots => slots.map(s => s.timeLabel);

test('the default window: 08:00 to a 21:00 end, Friday to 16:00', () => {
  const mon = times(tutorSlots([MON], day(), 90));
  assert.equal(mon[0], '08:00');
  assert.equal(mon.at(-1), '19:30');
  assert.equal(times(tutorSlots([FRI], day(), 90)).at(-1), '14:30');
});

test("a tutor's own hours, with a day off and a short day", () => {
  const hours = { 1: ['10:00', '14:00'], 5: ['08:00', '10:00'] };   // Sunday off
  assert.deepEqual(times(tutorSlots([MON], day({ hours }), 90)), ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30']);
  assert.deepEqual(tutorSlots([SUN], day({ hours }), 45), [], 'Sunday is a day off');
  assert.deepEqual(times(tutorSlots([FRI], day({ hours }), 45)), ['08:00', '08:30', '09:00']);
});

test('their calendar blocks with a 30-minute buffer, their lessons with a 15-minute break', () => {
  // 10:00–11:00 Israel.
  const busy = [{ start: '2027-03-15T08:00:00.000Z', end: '2027-03-15T09:00:00.000Z' }];
  const afterEvent = times(tutorSlots([MON], day({ calendar: busy }), 45));
  assert.ok(afterEvent.includes('09:00'), 'free right up to the event');
  assert.ok(!afterEvent.includes('09:30'), '09:30–10:15 runs into it');
  assert.ok(!afterEvent.includes('11:00') && afterEvent.includes('11:30'), '30 minutes clear after it');
  const afterLesson = times(tutorSlots([MON], day({ bookings: busy }), 45));
  assert.ok(afterLesson.includes('11:15') && !afterLesson.includes('11:00'), '15 minutes clear after a lesson');
});

test('a slot is offered once, whichever tutors have it, and never says whose', () => {
  const nikol = tutorSlots([MON], day({ hours: { 1: ['08:00', '10:00'] } }), 45);
  const lior = tutorSlots([MON], day({ hours: { 1: ['09:00', '11:00'] } }), 45);
  const both = unionSlots([lior, nikol]);
  assert.deepEqual(times(both), ['08:00', '08:30', '09:00', '09:30', '10:00']);
  assert.deepEqual(Object.keys(both[0]).sort(), ['dateLabel', 'dayOfWeek', 'end', 'start', 'timeLabel']);
});

test('on the day the clocks change, 08:00 is still 08:00 in Israel', () => {
  // Israel moves to summer time on Friday 2027-03-26.
  const dst = new Date('2027-03-26T00:00:00.000Z');
  assert.equal(new Date(ilMinutesToUTC(dst, 8 * 60)).toISOString(), '2027-03-26T05:00:00.000Z');
  assert.equal(tutorSlots([dst], day(), 45)[0].timeLabel, '08:00');
});

test('offers: inside their hours, clear of the buffer, and nothing else', () => {
  // Monday 10:00–14:00 Israel (08:00–12:00Z); busy 11:00–11:30 Israel, clear from 12:00.
  const t = day({ hours: { 1: ['10:00', '14:00'] }, calendar: [{ start: '2027-03-15T09:00:00.000Z', end: '2027-03-15T09:30:00.000Z' }] });
  assert.equal(offers(t, '2027-03-15T08:00:00.000Z', '2027-03-15T08:45:00.000Z'), true, '10:00–10:45');
  assert.equal(offers(t, '2027-03-15T07:30:00.000Z', '2027-03-15T08:15:00.000Z'), false, 'starts before their day');
  assert.equal(offers(t, '2027-03-15T09:45:00.000Z', '2027-03-15T10:30:00.000Z'), false, 'inside the buffer');
  assert.equal(offers(t, '2027-03-15T10:00:00.000Z', '2027-03-15T10:45:00.000Z'), true, '12:00 is clear');
  assert.equal(offers(t, '2027-03-15T11:30:00.000Z', '2027-03-15T12:15:00.000Z'), false, 'ends after their day');
  assert.equal(offers(t, '2027-03-14T08:00:00.000Z', '2027-03-14T08:45:00.000Z'), false, 'Sunday is a day off');
});

// Monday 10:00–11:30 Israel.
const AT = ['2027-03-15T08:00:00.000Z', '2027-03-15T09:30:00.000Z'];
const busyAt = [{ start: AT[0], end: AT[1] }];
const NIKOL = { id: 1 }, LIOR = { id: 2 };
const days = (over) => (t) => day(over[t.id] ?? {});

test('Nikol first when both are free', () => {
  assert.equal(pickTutor([NIKOL, LIOR], ...AT, days({})), NIKOL);
});

test('Lior when Nikol is busy in her calendar, or has a lesson booked then', () => {
  assert.equal(pickTutor([NIKOL, LIOR], ...AT, days({ 1: { calendar: busyAt } })), LIOR);
  assert.equal(pickTutor([NIKOL, LIOR], ...AT, days({ 1: { bookings: busyAt } })), LIOR);
});

test('nobody, when both are busy', () => {
  assert.equal(pickTutor([NIKOL, LIOR], ...AT, days({ 1: { bookings: busyAt }, 2: { calendar: busyAt } })), null);
});

test('the tutor whose hours have the slot, before one whose day has ended', () => {
  // 19:30–21:00 Israel: after Nikol's day ends at 18:00, inside Lior's.
  const late = ['2027-03-15T17:30:00.000Z', '2027-03-15T19:00:00.000Z'];
  assert.equal(pickTutor([NIKOL, LIOR], ...late, days({ 1: { hours: { 1: ['08:00', '18:00'] } } })), LIOR);
});

test("outside everyone's hours, the first tutor with nothing then still gets it, as one tutor always did", () => {
  // Saturday 2027-03-20, 10:00 Israel.
  const sat = ['2027-03-20T08:00:00.000Z', '2027-03-20T09:30:00.000Z'];
  assert.equal(pickTutor([NIKOL, LIOR], ...sat, days({})), NIKOL);
  assert.equal(pickTutor([NIKOL, LIOR], ...sat, days({ 1: { bookings: [{ start: sat[0], end: sat[1] }] } })), LIOR);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test tests/unit/tutor-slots.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `tutor-slots.ts`.

- [ ] **Step 3: Implement**

Create `src/lib/server/tutor-slots.ts`:

```ts
/**
 * Free lesson slots, per tutor.
 *
 * Moved out of /api/availability, where it was the whole route, so the
 * rules can be tested without a server — and so /api/book can ask the same
 * question about one hour when it chooses a tutor (offers, pickTutor).
 *
 *   - The booking window is the next 7 days, Saturday skipped — the same
 *     for every tutor.
 *   - A tutor's teaching hours give each day's window: a lesson starts at
 *     or after the first time and ends by the second.
 *   - 30 minutes clear after a calendar event, 15 after a lesson booked here.
 *   - Slots every 30 minutes within the free gaps.
 *
 * PURE: no database and no network.
 */
import type { BusyInterval } from './calendar.ts';
import { minutesOf, type TeachingHours, type Weekday } from '../teaching-hours.ts';

export const BUFFER_MIN = 30; // after a calendar commitment
export const LESSON_BREAK_MIN = 15; // after a lesson someone booked here
const SLOT_STEP_MIN = 30;
const MIN_MS = 60_000;
const TZ = 'Asia/Jerusalem';
const BOOKABLE_DAYS = [0, 1, 2, 3, 4, 5]; // Sun=0 … Fri=5

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const MONTH_NAMES = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

export interface Slot {
  start: string;
  end: string;
  dateLabel: string;
  timeLabel: string;
  dayOfWeek: number;
}

/** Everything that keeps one tutor from an hour. */
export interface TutorDay {
  hours: TeachingHours;
  /** From their own calendars: busy until BUFFER_MIN after each ends. */
  calendar: BusyInterval[];
  /** Lessons and holds they own here: busy until LESSON_BREAK_MIN after. */
  bookings: BusyInterval[];
}

interface BusyEvent { start: string; end: string; bufferMin: number }

const eventsOf = (t: Pick<TutorDay, 'calendar' | 'bookings'>): BusyEvent[] => [
  ...t.calendar.map(e => ({ start: e.start, end: e.end, bufferMin: BUFFER_MIN })),
  ...t.bookings.map(b => ({ start: b.start, end: b.end, bufferMin: LESSON_BREAK_MIN })),
];

/** The next 7 days after `now`'s UTC date, Saturday skipped. */
export function buildBookingWindow(now: Date = new Date()): { days: Date[]; timeMin: string | null; timeMax: string | null } {
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const days: Date[] = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() + i);
    if (BOOKABLE_DAYS.includes(d.getUTCDay())) days.push(d);
  }
  if (!days.length) return { days: [], timeMin: null, timeMax: null };
  return {
    days,
    timeMin: days[0].toISOString(),
    timeMax: new Date(days[days.length - 1].getTime() + 24 * 3600 * 1000).toISOString(),
  };
}

/** UTC ms of `minutes` past midnight, Israel time, on the date `dayUTC`
 *  (a UTC midnight) names. Probes UTC noon for that day's offset, so a day
 *  the clocks change on still gets its own. */
export function ilMinutesToUTC(dayUTC: Date, minutes: number): number {
  const probe = new Date(dayUTC.getTime() + 12 * 3600 * 1000);
  const ilNoon = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }).format(probe),
    10,
  );
  const offsetH = ilNoon - 12; // IL offset from UTC (positive = IL ahead)
  return dayUTC.getTime() + (minutes - offsetH * 60) * MIN_MS;
}

/** This tutor's [start, end) on that date, or null on a day off. */
function windowOn(day: Date, hours: TeachingHours): [number, number] | null {
  const pair = hours[day.getUTCDay() as Weekday];
  return pair ? [ilMinutesToUTC(day, minutesOf(pair[0])), ilMinutesToUTC(day, minutesOf(pair[1]))] : null;
}

/** One tutor's free slots over these days. */
export function tutorSlots(days: Date[], t: TutorDay, durationMin: number): Slot[] {
  const slots: Slot[] = [];
  const durationMs = durationMin * MIN_MS;
  const stepMs = SLOT_STEP_MIN * MIN_MS;
  const events = eventsOf(t);

  for (const day of days) {
    const win = windowOn(day, t.hours);
    if (!win) continue;
    const [winStart, winEnd] = win;

    // Events that overlap this day's window, sorted by start.
    const dayBusy = events
      .filter(e => Date.parse(e.start) < winEnd && Date.parse(e.end) > winStart)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

    let cursor = winStart;
    for (const event of dayBusy) {
      const busyStart = Math.max(Date.parse(event.start), winStart);
      const busyEnd = Math.min(Date.parse(event.end), winEnd);
      for (let at = cursor; at + durationMs <= busyStart; at += stepMs) slots.push(makeSlot(at, durationMs));
      cursor = Math.max(cursor, busyEnd + event.bufferMin * MIN_MS);
    }
    for (let at = cursor; at + durationMs <= winEnd; at += stepMs) slots.push(makeSlot(at, durationMs));
  }
  return slots;
}

/** The slots any of these tutors has free: one per start time, in time
 *  order. Which tutor a slot belongs to is never part of it. */
export function unionSlots(lists: Slot[][]): Slot[] {
  const byStart = new Map<string, Slot>();
  for (const s of lists.flat()) if (!byStart.has(s.start)) byStart.set(s.start, s);
  return [...byStart.values()].sort((a, b) => a.start.localeCompare(b.start));
}

/** The Israel date an instant falls on, as a UTC midnight — the shape the
 *  booking window's days have. */
function israelDate(ms: number): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(ms));
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** Whether this tutor would offer [start, end): the slot rules above,
 *  without the 30-minute grid. */
export function offers(t: TutorDay, start: string, end: string): boolean {
  const s = Date.parse(start), e = Date.parse(end);
  if (!(s < e)) return false;
  const win = windowOn(israelDate(s), t.hours);
  if (!win) return false;
  const [winStart, winEnd] = win;
  if (s < winStart || e > winEnd) return false;
  return !eventsOf(t).some(ev => {
    const es = Date.parse(ev.start), ee = Date.parse(ev.end);
    if (!(es < winEnd && ee > winStart)) return false; // the slot rules ignore it too
    return e > es && s < ee + ev.bufferMin * MIN_MS;
  });
}

/** Whether anything this tutor has overlaps [start, end) at all. */
export function clashes(t: Pick<TutorDay, 'calendar' | 'bookings'>, start: string, end: string): boolean {
  const s = Date.parse(start), e = Date.parse(end);
  return [...t.calendar, ...t.bookings].some(b => Date.parse(b.end) > s && Date.parse(b.start) < e);
}

/**
 * Who teaches a lesson at [start, end): the first candidate, in the order
 * given (id order, so Nikol first), whose hours, buffers and breaks would
 * offer that hour; failing that, the first who has nothing in it at all.
 *
 * The first pass stops a 19:30 booking landing on a tutor whose day ended
 * at 18:00 while another tutor's day has it. The second keeps what one
 * tutor could always do: a lesson booked outside the hours — by the tutor
 * for a family, or from a page opened earlier — still lands when nothing
 * clashes.
 */
export function pickTutor<T extends { id: number }>(
  candidates: T[], start: string, end: string, dayOf: (t: T) => TutorDay,
): T | null {
  return candidates.find(t => offers(dayOf(t), start, end))
    ?? candidates.find(t => !clashes(dayOf(t), start, end))
    ?? null;
}

function makeSlot(startMs: number, durationMs: number): Slot {
  const startDate = new Date(startMs);
  const endDate = new Date(startMs + durationMs);

  // Format in Israel time
  const ilFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'short', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false,
  });
  const parts = ilFmt.formatToParts(startDate);
  const get = (t: string): string | undefined => parts.find(p => p.type === t)?.value;

  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = dowMap[get('weekday') ?? ''] ?? startDate.getDay();
  const d = parseInt(get('day') ?? '', 10);
  const m = parseInt(get('month') ?? '', 10) - 1;
  const h = get('hour');
  const min = get('minute');

  return {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    dateLabel: `יום ${DAY_NAMES[dow]}, ${d} ${MONTH_NAMES[m]}`,
    timeLabel: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
    dayOfWeek: dow,
  };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `node --test tests/unit/tutor-slots.test.mjs`
Expected: PASS, with no failures.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/tutor-slots.ts tests/unit/tutor-slots.test.mjs
git commit -F- <<'EOF'
Free slots per tutor, from their own hours, and who takes one hour

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M83cAin9ny5QGUYH4Ydu6F
EOF
```

---

### Task 6: Who may teach a booking

**Files:**
- Create: `src/lib/server/tutor-candidates.ts`
- Test: `tests/unit/tutor-candidates.test.mjs`

**Interfaces:**
- Consumes: `takesBookings` (Task 3); `getTeacher`, `listTeachers`, `findAccountByEmail`, `findStudentInAccountByName`, `handle`.
- Produces:
  - `interface Candidates { tutors: TeacherRow[]; returning: boolean; familyTutorId: number | null }`
  - `bookableTutors(): TeacherRow[]`
  - `familyTutors(accountId: number): TeacherRow[]`
  - `bookingCandidates(b: { email: unknown; name: unknown; subject: unknown }): Candidates`
  - `availabilityCandidates(q: { tutorId?: number | null; accountId?: number | null }): TeacherRow[]`
  - `heldCandidates(teacherId: number): Candidates`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/tutor-candidates.test.mjs
//
// The spec's rules 1–3: a student's own tutor; else the family's tutors;
// else everyone who takes bookings — then narrowed to those who do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'candidates-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const S = await import('../../src/lib/server/tutor-settings.ts');
const C = await import('../../src/lib/server/tutor-candidates.ts');
const { handle } = await import('../../src/lib/server/db.ts');

const ready = (t) => S.updateTutorSettings(t.id, { calendarId: `t${t.id}@group.calendar.google.com`, busyIcs: [`https://feeds.example.test/${t.id}.ics`] });
const [nikol, lior] = E.listTeachers();
ready(nikol); ready(lior);
const ids = (list) => list.map(t => t.id);

let n = 0;
/** An account with these children, each enrolled in maths with a tutor. */
function family(children) {
  n += 1;
  const account = E.createAccount({ name: `משפחה ${n}`, credential: 'x', email: `c${n}@example.com` });
  children.forEach((ch, i) => {
    const s = E.createStudent({ code: `c${n}s${i}`, name: ch.name, accountId: account.id, credential: 'x' });
    E.upsertEnrollment({ studentId: s.id, subject: 'מתמטיקה', level: 'ח', teacherId: ch.tutorId });
  });
  return account;
}

test('rule 3: a new family may go to anyone who takes bookings, Nikol first', () => {
  const c = C.bookingCandidates({ email: 'new@example.com', name: 'חדש', subject: 'מתמטיקה' });
  assert.deepEqual(ids(c.tutors), [nikol.id, lior.id]);
  assert.equal(c.returning, false);
  assert.equal(c.familyTutorId, null);
});

test('rule 1: a student with a tutor in this subject gets only that tutor', () => {
  const a = family([{ name: 'דנה', tutorId: lior.id }]);
  const c = C.bookingCandidates({ email: a.email, name: 'דנה', subject: 'מתמטיקה' });
  assert.deepEqual(ids(c.tutors), [lior.id]);
  assert.deepEqual([c.returning, c.familyTutorId], [true, lior.id]);
});

test("rule 2: a new child joins the family's tutor", () => {
  const a = family([{ name: 'דנה', tutorId: lior.id }]);
  const c = C.bookingCandidates({ email: a.email, name: 'אח חדש', subject: 'מתמטיקה' });
  assert.deepEqual(ids(c.tutors), [lior.id]);
  assert.equal(c.returning, true);
});

test('rule 2 with children at both tutors: both, and the family tutor named is the first', () => {
  const a = family([{ name: 'א', tutorId: lior.id }, { name: 'ב', tutorId: nikol.id }]);
  const c = C.bookingCandidates({ email: a.email, name: 'ג', subject: 'מתמטיקה' });
  assert.deepEqual(ids(c.tutors), [nikol.id, lior.id]);
  assert.equal(c.familyTutorId, nikol.id);
});

test('a deactivated tutor counts as no tutor, and the next rule applies', () => {
  const gone = E.createTeacher({ name: 'לשעבר' });
  ready(gone);
  const a = family([{ name: 'דנה', tutorId: gone.id }]);
  handle().prepare(`UPDATE teachers SET active = 0 WHERE id = ?`).run(gone.id);
  const c = C.bookingCandidates({ email: a.email, name: 'דנה', subject: 'מתמטיקה' });
  assert.deepEqual(ids(c.tutors), [nikol.id, lior.id]);
  assert.equal(c.returning, false);
});

test('a tutor still missing settings yields no candidates: the family is not moved to someone else', () => {
  const fresh = E.createTeacher({ name: 'חדשה' });
  const a = family([{ name: 'דנה', tutorId: fresh.id }]);
  const c = C.bookingCandidates({ email: a.email, name: 'דנה', subject: 'מתמטיקה' });
  assert.deepEqual(ids(c.tutors), []);
  assert.deepEqual([c.returning, c.familyTutorId], [true, fresh.id]);
  assert.deepEqual(C.availabilityCandidates({ accountId: a.id }), [], 'and that family is offered no hours');
});

test("availability: one tutor on ?tutor=, the family's tutors when signed in, else everyone", () => {
  const a = family([{ name: 'דנה', tutorId: lior.id }]);
  assert.deepEqual(ids(C.availabilityCandidates({})), [nikol.id, lior.id]);
  assert.deepEqual(ids(C.availabilityCandidates({ accountId: a.id })), [lior.id]);
  assert.deepEqual(ids(C.availabilityCandidates({ tutorId: nikol.id, accountId: a.id })), [nikol.id]);
  assert.deepEqual(C.availabilityCandidates({ tutorId: 999 }), []);
  const childless = E.createAccount({ name: 'בלי ילדים', credential: 'x', email: 'none@example.com' });
  assert.deepEqual(ids(C.availabilityCandidates({ accountId: childless.id })), [nikol.id, lior.id]);
});

test("a held booking is its tutor's alone", () => {
  const c = C.heldCandidates(lior.id);
  assert.deepEqual(ids(c.tutors), [lior.id]);
  assert.equal(c.returning, false);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test tests/unit/tutor-candidates.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `tutor-candidates.ts`.

- [ ] **Step 3: Implement**

Create `src/lib/server/tutor-candidates.ts`:

```ts
/**
 * Who may teach a booking — the spec's "Candidates"
 * (docs/superpowers/specs/2026-10-17-per-tutor-booking-design.md).
 *
 * For student S (matched by name within account A, as enrollFromBooking
 * matches) in subject X:
 *   1. S's enrollment in X, if its tutor is active: that tutor.
 *   2. Else, the active tutors of A's enrollments: a new child joins the family's tutor.
 *   3. Else, everyone who takes bookings.
 * Then narrowed to those who take bookings. A tutor who is active but
 * missing settings leaves the family with no hours — they are not moved to
 * someone else (D3). A deactivated tutor counts as no tutor.
 */
import { handle } from './db.ts';
import {
  getTeacher, listTeachers, findAccountByEmail, findStudentInAccountByName, type TeacherRow,
} from './entities.ts';
import { takesBookings } from './tutor-settings.ts';

export interface Candidates {
  /** Who may teach it, narrowed to tutors who take bookings, in id order. */
  tutors: TeacherRow[];
  /** Rule 1 or 2 matched: the family has a tutor, and only that tutor will do. */
  returning: boolean;
  /** The family's tutor (lowest id), taken BEFORE the narrowing — what TUTOR_BUSY names. */
  familyTutorId: number | null;
}

const activeTutors = (ids: number[]): TeacherRow[] =>
  ids.map(getTeacher).filter((t): t is TeacherRow => !!t?.active);

/** Rule 3: everyone who takes bookings, Nikol (the lowest id) first. */
export const bookableTutors = (): TeacherRow[] => listTeachers().filter(takesBookings);

/** Rule 2: the active tutors of every enrollment in this account, id order. */
export function familyTutors(accountId: number): TeacherRow[] {
  const ids = (handle().prepare(`
    SELECT DISTINCT e.teacher_id AS id
      FROM enrollments e JOIN students_v2 s ON s.id = e.student_id
     WHERE s.account_id = ? AND e.teacher_id IS NOT NULL
     ORDER BY id
  `).all(accountId) as { id: number }[]).map(r => r.id);
  return activeTutors(ids);
}

function from(family: TeacherRow[]): Candidates {
  if (family.length) return { tutors: family.filter(takesBookings), returning: true, familyTutorId: family[0].id };
  return { tutors: bookableTutors(), returning: false, familyTutorId: null };
}

/** For a booking of student `name` in `subject`, by the account this email belongs to. */
export function bookingCandidates(b: { email: unknown; name: unknown; subject: unknown }): Candidates {
  const account = findAccountByEmail(b.email);
  if (!account) return from([]);
  const student = findStudentInAccountByName(account.id, b.name);
  if (student) {
    const own = handle().prepare(
      `SELECT teacher_id AS id FROM enrollments WHERE student_id = ? AND subject = ? AND teacher_id IS NOT NULL`,
    ).get(student.id, String(b.subject ?? '').trim()) as { id: number } | undefined;
    const tutor = own ? activeTutors([own.id]) : [];
    if (tutor.length) return from(tutor); // rule 1
  }
  return from(familyTutors(account.id)); // rule 2, else rule 3
}

/** Whose hours the booking page is shown: the one tutor a TUTOR_BUSY reload
 *  names (if they take bookings), the signed-in family's tutors, or everyone. */
export function availabilityCandidates(q: { tutorId?: number | null; accountId?: number | null }): TeacherRow[] {
  if (q.tutorId != null) {
    const t = getTeacher(q.tutorId);
    return t && takesBookings(t) ? [t] : [];
  }
  return from(q.accountId != null ? familyTutors(q.accountId) : []).tutors;
}

/** A held booking (pending_bookings.teacher_id): confirming it books with
 *  that tutor, and asks only about their hour. */
export function heldCandidates(teacherId: number): Candidates {
  const t = getTeacher(teacherId);
  return { tutors: t ? [t] : [], returning: false, familyTutorId: null };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `node --test tests/unit/tutor-candidates.test.mjs`
Expected: PASS, with no failures.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/tutor-candidates.ts tests/unit/tutor-candidates.test.mjs
git commit -F- <<'EOF'
Who may teach a booking: the student's tutor, else the family's, else whoever takes bookings

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M83cAin9ny5QGUYH4Ydu6F
EOF
```

---

### Task 7: Availability per tutor

**Files:**
- Modify: `src/lib/server/calendar.ts` (header comment, and everything from `export function icsUrls` to the end)
- Replace: `src/routes/api/availability/+server.ts`
- Modify: `src/routes/app/dashboard/+page.svelte` (`CalendarSourceIssue` at :719-723, the banner rows at :856-867)
- Modify: `tests/unit/calendar-ics.test.mjs` (the three read-failure tests at :206-323)
- Replace: `tests/unit/availability-calendar-ids.test.mjs`
- Test: `tests/characterization/availability-per-tutor.test.mjs`

**Interfaces:**
- Consumes: `tutorSlots`, `unionSlots`, `buildBookingWindow` (Task 5); `availabilityCandidates` (Task 6); `busyAddresses`, `teachingHours` (Task 3); `readBookingsFor` (Task 2).
- Produces:
  - `interface BusySource { id: number; name: string; addresses: string[] }`
  - `fetchTutorBusy(tutor: BusySource, timeMin: string, timeMax: string): Promise<{ busy: BusyInterval[]; failed: number; total: number }>`
  - `type CalendarSourceIssue = { tutorId; tutorName; index; total; at; reason }`
  - `calendarSourceIssues(): CalendarSourceIssue[]`
  - `clearSourceIssues(tutorId: number): void`
  - Removed: `icsUrls`, `availabilityCalendarIds`, `fetchBusy`.
  - `/api/availability?duration=&tutor=` answers `{ slots, calendarConnected, calendars, calendarFailures, booked }`.

- [ ] **Step 1: Write the failing tests**

Replace `tests/unit/calendar-ics.test.mjs`'s header comment lines 1-4 with:

```js
// Pins the semantics of busyFromIcs against hand-written ICS fixtures, and
// the read-failure recording added alongside it. Never reaches the network —
// fixtures are plain ICS text; fetchTutorBusy's network call is stubbed via
// global.fetch where needed.
```

Then replace everything from the line `// ── Read-failure recording ───…` to the end of the file with:

```js
// ── Read-failure recording ──────────────────────────────────────────────
// fetchTutorBusy identifies a failing feed only by its tutor and 1-based
// position, never by its URL (the URL is a secret). These fixture URLs are
// not real endpoints; global.fetch is stubbed so no network call is made.

const tutor = (id, name, addresses) => ({ id, name, addresses });

test('a feed that throws is recorded by tutor, position and reason, and a later success clears it', async () => {
  const calendar = await import('../../src/lib/server/calendar.ts');
  const secretA = 'https://calendar.google.com/calendar/ical/super-secret-token-aaa/basic.ics';
  const secretB = 'https://calendar.google.com/calendar/ical/super-secret-token-bbb/basic.ics';
  const originalFetch = global.fetch;
  let firstFeedShouldFail = true;
  global.fetch = async (url) => (url === secretA && firstFeedShouldFail
    ? { ok: false, status: 404 }
    : { ok: true, text: async () => '' });

  try {
    const read = await calendar.fetchTutorBusy(tutor(2, 'ליאור', [secretA, secretB]), TIME_MIN, TIME_MAX);
    assert.deepEqual({ failed: read.failed, total: read.total }, { failed: 1, total: 2 });
    const [issue, ...rest] = calendar.calendarSourceIssues();
    assert.equal(rest.length, 0);
    assert.deepEqual({ ...issue, at: 'x' }, { tutorId: 2, tutorName: 'ליאור', index: 1, total: 2, at: 'x', reason: 'HTTP 404' });
    assert.ok(typeof issue.at === 'string' && issue.at.length > 0);

    firstFeedShouldFail = false;
    await calendar.fetchTutorBusy(tutor(2, 'ליאור', [secretA, secretB]), TIME_MIN, TIME_MAX);
    assert.equal(calendar.calendarSourceIssues().length, 0, 'a recovered feed must stop warning');
  } finally {
    global.fetch = originalFetch;
  }
});

test("one tutor's new addresses clear only that tutor's warnings", async () => {
  const calendar = await import('../../src/lib/server/calendar.ts');
  const url = 'https://calendar.google.com/calendar/ical/super-secret-token-eee/basic.ics';
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 500 });
  try {
    await calendar.fetchTutorBusy(tutor(1, 'ניקול', [url]), TIME_MIN, TIME_MAX);
    await calendar.fetchTutorBusy(tutor(2, 'ליאור', [url]), TIME_MIN, TIME_MAX);
    assert.deepEqual(calendar.calendarSourceIssues().map(i => i.tutorName), ['ניקול', 'ליאור']);
    calendar.clearSourceIssues(2);
    assert.deepEqual(calendar.calendarSourceIssues().map(i => i.tutorName), ['ניקול']);
  } finally {
    calendar.clearSourceIssues(1);
    global.fetch = originalFetch;
  }
});

test('no fixture URL or secret appears in any surfaced string', async () => {
  const calendar = await import('../../src/lib/server/calendar.ts');
  const secretUrl = 'https://calendar.google.com/calendar/ical/super-secret-token-ccc/basic.ics';
  const secretToken = 'super-secret-token-ccc';

  const originalFetch = global.fetch;
  const originalConsoleError = console.error;
  const logged = [];
  console.error = (...args) => { logged.push(args.map(String).join(' ')); };
  let shouldFail = true;
  global.fetch = async () => (shouldFail ? { ok: false, status: 500 } : { ok: true, text: async () => '' });

  try {
    await calendar.fetchTutorBusy(tutor(1, 'ניקול', [secretUrl]), TIME_MIN, TIME_MAX);
    const surfaced = JSON.stringify(calendar.calendarSourceIssues()) + '\n' + logged.join('\n');
    assert.ok(!surfaced.includes(secretUrl), 'the full URL must never be surfaced');
    assert.ok(!surfaced.includes(secretToken), 'no part of the URL may be surfaced');
    assert.ok(!surfaced.includes('calendar.google.com'), 'no host derived from the URL may be surfaced');

    // clean up: let the feed succeed so it doesn't leak state into other tests
    shouldFail = false;
    await calendar.fetchTutorBusy(tutor(1, 'ניקול', [secretUrl]), TIME_MIN, TIME_MAX);
    assert.equal(calendar.calendarSourceIssues().length, 0);
  } finally {
    global.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});

/* The leak test above only ever exercises our OWN `HTTP nnn` error, which
   cannot carry a URL. The realistic vector is different: undici rejects with
   a message that embeds the request URL ("request to https://... failed"),
   and that error reaches classifyReadError as an UNCLASSIFIED one — the
   branch that must never echo the raw message. Without this case, replacing
   that branch's fixed string with `message` passes the whole suite. */
test('a fetch rejection carrying the URL still surfaces nothing derived from it', async () => {
  const calendar = await import('../../src/lib/server/calendar.ts');
  const secretUrl = 'https://calendar.google.com/calendar/ical/super-secret-token-ddd/basic.ics';

  const originalFetch = global.fetch;
  const originalConsoleError = console.error;
  const logged = [];
  console.error = (...args) => { logged.push(args.map(String).join(' ')); };
  let shouldFail = true;
  global.fetch = async () => {
    if (shouldFail) throw new Error(`request to ${secretUrl} failed, reason: ECONNREFUSED`);
    return { ok: true, text: async () => '' };
  };

  try {
    await calendar.fetchTutorBusy(tutor(1, 'ניקול', [secretUrl]), TIME_MIN, TIME_MAX);
    const surfaced = JSON.stringify(calendar.calendarSourceIssues()) + '\n' + logged.join('\n');
    assert.ok(!surfaced.includes(secretUrl), 'the full URL must never be surfaced');
    assert.ok(!surfaced.includes('super-secret-token-ddd'), 'no token from the URL may be surfaced');
    assert.ok(!surfaced.includes('calendar.google.com'), 'no host derived from the URL may be surfaced');
    assert.ok(!surfaced.includes('ECONNREFUSED'), 'the raw error message must not be echoed');

    shouldFail = false;
    await calendar.fetchTutorBusy(tutor(1, 'ניקול', [secretUrl]), TIME_MIN, TIME_MAX);
    assert.equal(calendar.calendarSourceIssues().length, 0);
  } finally {
    global.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});
```

Replace `tests/unit/availability-calendar-ids.test.mjs` with:

```js
/**
 * No personal calendar identifier lives in the availability route.
 *
 * Its Google Calendar API fallback once carried six of Nicole's own
 * calendar ids as literals (found 2026-09-20), then read them from
 * AVAILABILITY_CALENDAR_IDS. Migration 029 removed that fallback: every
 * tutor who is offered reads their own private iCal addresses from their
 * row (tutor-settings.ts), so there is no global list left. This keeps the
 * route from growing one back.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const route = readFileSync(join(root, 'src/routes/api/availability/+server.ts'), 'utf8');

test('no personal calendar identifier is hardcoded in the route', () => {
  const addresses = route.match(/['"][A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}['"]/g) ?? [];
  assert.deepEqual(addresses, [],
    'a calendar id is a personal identifier — it belongs on the tutor\'s row, not in a commit');
});

test('the route reads no calendar list from the environment', () => {
  assert.doesNotMatch(route, /process\.env/, "busy times are per tutor, from their row");
});
```

Create `tests/characterization/availability-per-tutor.test.mjs`:

```js
// tests/characterization/availability-per-tutor.test.mjs
//
// The booking page's hours are the union of the candidates' own free slots
// (docs/superpowers/specs/2026-10-17-per-tutor-booking-design.md). Lior
// "takes bookings" here through the database, with a busy feed on port 1:
// refused at once, so his calendar reads as free. Not a real address.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, login, familySession } from './harness.mjs';

function run(dbPath, sql, ...params) {
  const db = new DatabaseSync(dbPath);
  try { db.prepare(sql).run(...params); } finally { db.close(); }
}
const liorTakesBookings = (dbPath) => run(dbPath,
  `UPDATE teachers SET calendar_id = 'lior-lessons@example.com', busy_ics = 'https://127.0.0.1:1/lior.ics' WHERE id = 2`);
const hours = async (baseUrl, query = '', headers = {}) =>
  (await fetch(`${baseUrl}/api/availability?duration=45${query}`, { headers })).json();

test("one tutor's lesson leaves the hour open with the other, and a family sees only their tutor's hours", async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    liorTakesBookings(dbPath);
    const slot = (await hours(baseUrl)).slots[0];
    assert.ok(slot, 'the coming week has a free slot');
    const booked = await (await fetch(`${baseUrl}/api/book`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'דנה', subject: 'מתמטיקה', level: 'כיתה ח', phone: '0501234567',
        email: 'dana@example.com', durationMin: 45, start: slot.start, end: slot.end }),
    })).json();
    assert.ok(booked.portal, JSON.stringify(booked));
    const cookie = await familySession(booked.portal.link);

    const offered = (r) => r.slots.some(s => s.start === slot.start);
    assert.equal(offered(await hours(baseUrl)), true, 'still open with Lior, for a new family');
    assert.equal(offered(await hours(baseUrl, '', { Cookie: cookie })), false, "Dana's family is offered Nikol's hours, and Nikol teaches Dana then");
    assert.equal(offered(await hours(baseUrl, '&tutor=1')), false);
    assert.equal(offered(await hours(baseUrl, '&tutor=2')), true);
    assert.deepEqual((await hours(baseUrl, '&tutor=99')).slots, []);
  } finally { await stop(); }
});

test('a feed that fails is reported to the dashboard by tutor and position, never by address', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    liorTakesBookings(dbPath);
    const r = await hours(baseUrl);
    assert.deepEqual([r.calendars, r.calendarFailures], [2, 1], "Nikol's feed answered, Lior's did not");
    const issues = await (await fetch(`${baseUrl}/api/calendar-failures`, { headers: { cookie: await login(baseUrl) } })).json();
    assert.deepEqual(issues.sourceIssues.map(s => [s.tutorName, s.index, s.total]), [['ליאור', 1, 1]]);
    assert.doesNotMatch(JSON.stringify(issues), /127\.0\.0\.1|lior\.ics/);
  } finally { await stop(); }
});

test('nobody takes bookings: no hours, said as not connected', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    run(dbPath, `UPDATE teachers SET busy_ics = NULL`);
    const r = await hours(baseUrl);
    assert.deepEqual(r.slots, []);
    assert.equal(r.calendarConnected, false);
  } finally { await stop(); }
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm run build && node --test tests/unit/calendar-ics.test.mjs tests/unit/availability-calendar-ids.test.mjs tests/characterization/availability-per-tutor.test.mjs`
Expected: FAIL.
- `calendar.fetchTutorBusy is not a function`.
- The route still reads `process.env.GOOGLE_API_KEY`.
- The characterization assertions fail: the hour is still offered to Dana's family, and `calendars` is `1`.

- [ ] **Step 3: Implement**

In `src/lib/server/calendar.ts`, replace the header comment (lines 1-10) with:

```ts
/**
 * Busy-time source for the booking page.
 *
 * Google's API needs either a public calendar (an API key can read nothing else)
 * or a service account. A private iCal address needs neither: it is a secret URL
 * Google generates per calendar, so the server can read the real calendar without
 * anyone's calendar becoming public.
 *
 * Each tutor has their own addresses (teachers.busy_ics, migration 029; see
 * tutor-settings.ts). A failing feed is identified by its tutor and position,
 * never by its address.
 */
```

Then delete `icsUrls` and `availabilityCalendarIds` (with their doc comments). Keep the cache comment, `CACHE_MS`, `cache`, `calendarText` and `classifyReadError` exactly as they are. Replace everything from `export type CalendarSourceIssue` to the end of the file with:

```ts
/** Whose feeds these are. The name is for the dashboard's warning; the
 *  addresses are secrets and never leave this module. */
export interface BusySource { id: number; name: string; addresses: string[] }

export type CalendarSourceIssue = {
  tutorId: number; tutorName: string;
  /** 1-based position among that tutor's addresses, and how many they have. */
  index: number; total: number;
  at: string; reason: string;
};

/** Last read failure per feed, keyed `${tutorId}:${position}`. Cleared the
 *  next time that same feed reads successfully, so a recovered calendar
 *  stops warning. */
const sourceIssues = new Map<string, CalendarSourceIssue>();

/** Read-failure state for the tutor dashboard («היומן השני של ליאור»),
 *  never by URL. */
export function calendarSourceIssues(): CalendarSourceIssue[] {
  return [...sourceIssues.values()].sort((a, b) => a.tutorId - b.tutorId || a.index - b.index);
}

/** A tutor's addresses were replaced: what was wrong with the old ones is moot. */
export function clearSourceIssues(tutorId: number): void {
  for (const [key, issue] of sourceIssues) if (issue.tutorId === tutorId) sourceIssues.delete(key);
}

/** One tutor's busy times from their own feeds. A feed that fails is
 *  skipped — its hours read as free, the fail-open the booking page then
 *  warns about — and recorded (see calendarSourceIssues), never silently
 *  dropped. */
export async function fetchTutorBusy(
  tutor: BusySource, timeMin: string, timeMax: string,
): Promise<{ busy: BusyInterval[]; failed: number; total: number }> {
  const urls = tutor.addresses;
  let failed = 0;
  const all = await Promise.all(urls.map(async (url, i) => {
    const key = `${tutor.id}:${i}`;
    try {
      const busy = busyFromIcs(await calendarText(url), timeMin, timeMax);
      sourceIssues.delete(key);
      return busy;
    } catch (err) {
      const reason = classifyReadError(err);
      sourceIssues.set(key, {
        tutorId: tutor.id, tutorName: tutor.name, index: i + 1, total: urls.length,
        at: new Date().toISOString(), reason,
      });
      failed++;
      console.error(`[calendar] ${tutor.name}: יומן ${i + 1} מתוך ${urls.length} — קריאה נכשלה: ${reason}`);
      return [];
    }
  }));
  return { busy: all.flat(), failed, total: urls.length };
}
```

Replace `src/routes/api/availability/+server.ts` with:

```ts
/**
 * GET /api/availability?duration=45|90|135[&tutor=<id>]
 *
 * The free lesson slots of the coming week: the union of each candidate
 * tutor's own free slots (src/lib/server/tutor-slots.ts holds the rules),
 * from their own teaching hours, their own busy addresses and the lessons
 * they hold here. Another tutor's lesson never blocks a slot.
 *
 * Whose hours (docs/superpowers/specs/2026-10-17-per-tutor-booking-design.md):
 *   - ?tutor=<id>: that tutor only, if they take bookings — the reload
 *     after a TUTOR_BUSY answer from /api/book;
 *   - a signed-in family: their tutors (everyone, if they have none yet);
 *   - anyone else: every tutor who takes bookings.
 * Which tutor a slot belongs to is never in the answer.
 */
import { json } from '@sveltejs/kit';
import { fetchTutorBusy } from '$server/calendar.ts';
import { readBookingsFor } from '$server/entities.ts';
import { availabilityCandidates } from '$server/tutor-candidates.ts';
import { busyAddresses, teachingHours } from '$server/tutor-settings.ts';
import { buildBookingWindow, tutorSlots, unionSlots } from '$server/tutor-slots.ts';
import type { RequestHandler } from './$types';

const VALID_DURATIONS = [45, 90, 135];

export const GET: RequestHandler = async ({ url, locals }) => {
  const headers = {
    // Never let a browser reuse an old answer: a slot that was free a
    // minute ago may be booked now, and a stale list is how two parents
    // get the same hour.
    'Cache-Control': 'no-store, max-age=0',
  };

  const durationMin = parseInt(url.searchParams.get('duration') ?? '', 10);
  if (!VALID_DURATIONS.includes(durationMin)) {
    return json({ error: 'duration חייב להיות 45, 90 או 135' }, { status: 400, headers });
  }

  const asked = Number(url.searchParams.get('tutor'));
  const tutors = availabilityCandidates({
    tutorId: Number.isInteger(asked) && asked > 0 ? asked : null,
    accountId: locals.family?.kind === 'account' ? locals.family.id : null,
  });

  try {
    const { days, timeMin, timeMax } = buildBookingWindow();
    if (!days.length || !timeMin || !timeMax) {
      return json({ slots: [], message: 'no_days' }, { headers });
    }

    const perTutor = await Promise.all(tutors.map(async t => {
      const read = await fetchTutorBusy({ id: t.id, name: t.name, addresses: busyAddresses(t) }, timeMin, timeMax);
      /* Lessons booked here are busy too — and they may not be in the
         calendar at all when no service account is configured to write them. */
      const bookings = readBookingsFor(t.id, timeMin, timeMax);
      return { read, bookings, slots: tutorSlots(days, { hours: teachingHours(t), calendar: read.busy, bookings }, durationMin) };
    }));

    return json({
      slots: unionSlots(perTutor.map(p => p.slots)),
      /* Every tutor offered here reads their own calendars (takesBookings),
         so this is false only when nobody can be offered at all.
         calendarFailures says how many of `calendars` did not come through
         this time, so the page can say the times are unconfirmed. */
      calendarConnected: tutors.length > 0,
      calendars: perTutor.reduce((n, p) => n + p.read.total, 0),
      calendarFailures: perTutor.reduce((n, p) => n + p.read.failed, 0),
      booked: perTutor.reduce((n, p) => n + p.bookings.length, 0),
    }, { headers });
  } catch (err) {
    console.error(err);
    return json({ error: (err as Error).message }, { status: 500, headers });
  }
};
```

In `src/routes/app/dashboard/+page.svelte`, replace

```ts
  interface CalendarSourceIssue { index: number; total: number; at: string; reason: string }
```

with

```ts
  interface CalendarSourceIssue { tutorId: number; tutorName: string; index: number; total: number; at: string; reason: string }
  const ORDINALS = ['הראשון', 'השני', 'השלישי', 'הרביעי', 'החמישי', 'השישי', 'השביעי', 'השמיני', 'התשיעי', 'העשירי'];
  /** «היומן השני של ליאור»: by tutor and position, never by address (a secret). */
  const feedLabel = (s: CalendarSourceIssue): string =>
    `${s.total > 1 ? `היומן ${ORDINALS[s.index - 1] ?? s.index}` : 'היומן'} של ${s.tutorName}`;
```

and replace

```svelte
      {#each calendarSourceIssues as s (s.index)}
        <div class="cs-row">
          <span class="cs-src">יומן {s.index} מתוך {s.total}:</span>
```

with

```svelte
      {#each calendarSourceIssues as s (`${s.tutorId}-${s.index}`)}
        <div class="cs-row">
          <span class="cs-src">{feedLabel(s)}:</span>
```

- [ ] **Step 4: Run them to see them pass, with the degraded-availability suite**

Run: `npm run build && node --test tests/unit/calendar-ics.test.mjs tests/unit/availability-calendar-ids.test.mjs tests/characterization/availability-per-tutor.test.mjs tests/characterization/availability-degraded.test.mjs`
Expected: PASS, with no failures. `availability-degraded.test.mjs` passes unchanged: Nikol takes over its dead feeds.

Run: `npm run check 2>&1 | tail -3`
Expected: `svelte-check found 0 errors`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/calendar.ts src/routes/api/availability/+server.ts src/routes/app/dashboard/+page.svelte tests/unit/calendar-ics.test.mjs tests/unit/availability-calendar-ids.test.mjs tests/characterization/availability-per-tutor.test.mjs
git commit -F- <<'EOF'
The booking page's hours are each tutor's own: their hours, their calendars, their lessons

A signed-in family sees only their tutor's hours; ?tutor= narrows to one.
A failing feed is reported by tutor and position. The unused Google
Calendar API fallback (GOOGLE_API_KEY + AVAILABILITY_CALENDAR_IDS) is gone.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M83cAin9ny5QGUYH4Ydu6F
EOF
```

---

### Task 8: The robot's calendar write, with the calendar as a parameter

**Files:**
- Create: `src/lib/server/lesson-calendar.ts`
- Modify: `src/routes/api/book/+server.ts`: imports at :24-28; delete `serviceAccount`, `b64url`, `buildJWT`, `getAccessToken` at :220-304; the calendar `try` at :418-442
- Modify: `tests/unit/boot-checks.test.mjs` (`'no required var carries a personal address as its default'` also scans the new file)
- Test: `tests/unit/lesson-calendar.test.mjs`

**Interfaces:**
- Produces:
  - `interface ServiceAccount { email: string; privateKey: string }`
  - `serviceAccount(): ServiceAccount | null`
  - `insertLessonEvent(sa: ServiceAccount, calendarId: string, event: unknown, fetchImpl?: typeof fetch): Promise<{ id: string }>`, which throws `Token error <status>: …` or `Calendar error <status>: …`.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/lesson-calendar.test.mjs
//
// The robot writes a lesson into the calendar it is given — each tutor has
// their own (migration 029). Google is faked; the key is made up here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { insertLessonEvent } from '../../src/lib/server/lesson-calendar.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const SA = { email: 'robot@example-project.iam.gserviceaccount.com', privateKey };

function fakeGoogle(answers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const a = answers.shift();
    return new Response(typeof a.body === 'string' ? a.body : JSON.stringify(a.body), { status: a.status });
  };
  return { calls, fetchImpl };
}

test('the event goes into the calendar it is given, signed in as the robot', async () => {
  const g = fakeGoogle([{ status: 200, body: { access_token: 'tok' } }, { status: 200, body: { id: 'evt1' } }]);
  const event = { summary: 'שיעור' };
  const created = await insertLessonEvent(SA, 'lior-lessons@group.calendar.google.com', event, g.fetchImpl);
  assert.equal(created.id, 'evt1');

  assert.equal(g.calls[0].url, 'https://oauth2.googleapis.com/token');
  const [h, c, sig] = new URLSearchParams(String(g.calls[0].init.body)).get('assertion').split('.');
  assert.equal(JSON.parse(Buffer.from(c, 'base64url')).iss, SA.email);
  assert.ok(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, sig, 'base64url'));

  assert.equal(g.calls[1].url, 'https://www.googleapis.com/calendar/v3/calendars/lior-lessons%40group.calendar.google.com/events');
  assert.equal(g.calls[1].init.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(g.calls[1].init.body), event);
});

test("Google's refusal is the error, so the booking route can flag it", async () => {
  const insert = fakeGoogle([{ status: 200, body: { access_token: 'tok' } }, { status: 404, body: 'Not Found' }]);
  await assert.rejects(insertLessonEvent(SA, 'x@group.calendar.google.com', {}, insert.fetchImpl), /Calendar error 404: Not Found/);
  const token = fakeGoogle([{ status: 400, body: 'invalid_grant' }]);
  await assert.rejects(insertLessonEvent(SA, 'x@group.calendar.google.com', {}, token.fetchImpl), /Token error 400: invalid_grant/);
  assert.equal(token.calls.length, 1, 'no write without a token');
});
```

In `tests/unit/boot-checks.test.mjs`, in the test `'no required var carries a personal address as its default'`, replace

```js
  const src = readFileSync(join(root, 'src/routes/api/book/+server.ts'), 'utf8');
```

with

```js
  const src = ['src/routes/api/book/+server.ts', 'src/lib/server/lesson-calendar.ts']
    .map(f => readFileSync(join(root, f), 'utf8')).join('\n');
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/unit/lesson-calendar.test.mjs tests/unit/boot-checks.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lesson-calendar.ts`, from both files.

- [ ] **Step 3: Implement**

Create `src/lib/server/lesson-calendar.ts`, moving `serviceAccount`, `b64url`, `buildJWT` and `getAccessToken` out of the route with their comments:

```ts
/**
 * The calendar robot writes a lesson into a tutor's lesson calendar.
 *
 * Moved out of /api/book so the write can be tested with Google faked, and
 * so the calendar is a parameter: each tutor has their own (migration 029),
 * and there is no global one to fall back to.
 */
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

export interface ServiceAccount { email: string; privateKey: string }

/**
 * Service-account credentials.
 *
 * Preferred: GOOGLE_SERVICE_ACCOUNT_KEY_FILE, the path to the JSON Google
 * gives you. A PEM cannot survive a round trip through an env file —
 * systemd's EnvironmentFile eats the backslashes, so "\n" arrives as "n"
 * and the key no longer decodes. Reading the file keeps the newlines
 * intact. Read on every booking, so a key swapped in place is used at once.
 */
export function serviceAccount(): ServiceAccount | null {
  const file = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  if (file) {
    try {
      const j = JSON.parse(readFileSync(file, 'utf8'));
      if (j.client_email && j.private_key) {
        return { email: j.client_email, privateKey: j.private_key };
      }
      console.error('[book] key file is missing client_email/private_key');
    } catch (err) {
      console.error('[book] cannot read key file:', (err as Error).message);
    }
    return null;
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!email || !raw) return null;

  const privateKey = raw.replace(/\\n/g, '\n');
  if (!privateKey.includes('\n')) {
    console.error('[book] private key has no line breaks — set GOOGLE_SERVICE_ACCOUNT_KEY_FILE instead');
    return null;
  }
  return { email, privateKey };
}

function b64url(str: string): string {
  return Buffer.from(str).toString('base64url');
}

function buildJWT(email: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      iss: email,
      scope: 'https://www.googleapis.com/auth/calendar.events',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    }),
  );
  const data = `${header}.${payload}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(data);
  const signature = sign.sign(privateKey, 'base64url');
  return `${data}.${signature}`;
}

async function getAccessToken(sa: ServiceAccount, fetchImpl: typeof fetch): Promise<string> {
  const r = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: buildJWT(sa.email, sa.privateKey),
    }),
  });

  /* Read as text first — Google doesn't always return JSON (a plain
     "Forbidden." body has been seen here). Parsing straight to JSON on a
     non-OK response crashed with an opaque "Unexpected token" instead of
     the actual reason the token request failed. */
  const raw = await r.text();
  if (!r.ok) throw new Error(`Token error ${r.status}: ${raw.slice(0, 300)}`);

  let data: { access_token?: string };
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Token response was not JSON: ${raw.slice(0, 300)}`);
  }
  return data.access_token ?? '';
}

/** Writes the event into `calendarId` and returns it. Throws with Google's
 *  answer on any failure, for the caller to flag (flagCalendarFailure). */
export async function insertLessonEvent(
  sa: ServiceAccount, calendarId: string, event: unknown, fetchImpl: typeof fetch = fetch,
): Promise<{ id: string }> {
  const token = await getAccessToken(sa, fetchImpl);
  const r = await fetchImpl(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    },
  );
  if (!r.ok) {
    const errBody = await r.text();
    throw new Error(`Calendar error ${r.status}: ${errBody.slice(0, 300)}`);
  }
  return await r.json();
}
```

In `src/routes/api/book/+server.ts`:
- Delete the imports `import crypto from 'node:crypto';` and `import { readFileSync } from 'node:fs';`.
- Add `import { serviceAccount, insertLessonEvent } from '$server/lesson-calendar.ts';`.
- Delete the functions `serviceAccount`, `b64url`, `buildJWT`, `getAccessToken` and their doc comments.
- In `book()`, replace the whole `try` block body, from `// ── Get access token via service account JWT` through `created = await r.json();`, with:

```ts
    const event = bookingEvent({ name, subject, request: requestText, level, phone, email, start, end, durationMin }, place);
    created = await insertLessonEvent(sa, calendarId, event);
```

- [ ] **Step 4: Run them to see them pass, and build**

Run: `node --test tests/unit/lesson-calendar.test.mjs tests/unit/boot-checks.test.mjs && npm run build > /dev/null && node --test tests/characterization/booking.test.mjs`
Expected: PASS, with no failures.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/lesson-calendar.ts src/routes/api/book/+server.ts tests/unit/lesson-calendar.test.mjs tests/unit/boot-checks.test.mjs
git commit -F- <<'EOF'
The robot's calendar write moves out of the booking route, with the calendar as a parameter

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M83cAin9ny5QGUYH4Ydu6F
EOF
```

---

### Task 9: A booking is assigned its tutor

**Files:**
- Create: `src/lib/server/tutor-assign.ts`
- Modify: `src/lib/server/enroll.ts` (`enrollFromBooking` takes the tutor; `EnrollResult.teacherName` doc)
- Modify: `src/routes/api/book/+server.ts` (imports, `book()`, `holdForConfirmation`, `confirmHeld`, `CompleteCtx`, `completeBooking`)
- Test: `tests/unit/tutor-assign.test.mjs`, `tests/unit/enroll-tutor.test.mjs`, `tests/characterization/per-tutor-booking.test.mjs`

**Interfaces:**
- Consumes:
  - `Candidates`, `bookingCandidates`, `heldCandidates`, `bookableTutors` (Task 6);
  - `pickTutor`, `TutorDay` (Task 5);
  - `fetchTutorBusy` (Task 7);
  - `slotTakenFor`, `readBookingsFor`, `reserveBooking({ teacherId })` (Task 2);
  - `holdBooking({ teacherId })`, `HeldBooking.teacherId` (Task 2);
  - `insertLessonEvent`, `serviceAccount` (Task 8).
- Produces:
  - `tutorsToAsk(c: Candidates): TeacherRow[]`
  - `calendarBusyAround(tutors: TeacherRow[], start: string, end: string): Promise<Map<number, BusyInterval[]>>`
  - `interface Assignment { tutor: TeacherRow | null; tutorBusy: boolean }`
  - `assignTutor(c: Candidates, start: string, end: string, calendar: Map<number, BusyInterval[]>): Assignment` (synchronous)
  - `enrollFromBooking(booking: BookingInput, teacher?: TeacherRow | null): EnrollResult`
  - The TUTOR_BUSY answer: `409 { code: 'TUTOR_BUSY', error: 'השעה הזאת לא פנויה אצל המורה שלכם', tutorId }`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/tutor-assign.test.mjs
//
// Choosing the tutor at submit: calendars read first, the choice made
// synchronously against the database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'assign-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const S = await import('../../src/lib/server/tutor-settings.ts');
const C = await import('../../src/lib/server/tutor-candidates.ts');
const A = await import('../../src/lib/server/tutor-assign.ts');

const [nikol, lior] = E.listTeachers();
for (const t of [nikol, lior]) {
  S.updateTutorSettings(t.id, { calendarId: `t${t.id}@group.calendar.google.com`, busyIcs: [`https://feeds.example.test/${t.id}.ics`] });
}
// Mondays at 10:00–11:30 Israel (UTC+2).
const MON = (d) => ({ start: `2030-03-${d}T08:00:00.000Z`, end: `2030-03-${d}T09:30:00.000Z` });
const newFamily = (email) => C.bookingCandidates({ email, name: 'חדש', subject: 'מתמטיקה' });

test("a returning family's busy tutor, with another tutor free, is TUTOR_BUSY", () => {
  const at = MON('04');
  const account = E.createAccount({ name: 'כהן', credential: 'x', email: 'cohen@example.com' });
  const s = E.createStudent({ code: 'ta1', name: 'דנה', accountId: account.id, credential: 'x' });
  E.upsertEnrollment({ studentId: s.id, subject: 'מתמטיקה', teacherId: nikol.id });
  E.reserveBooking({ studentId: s.id, ...at, durationMin: 90, teacherId: nikol.id });
  const c = C.bookingCandidates({ email: 'cohen@example.com', name: 'דנה', subject: 'מתמטיקה' });
  assert.deepEqual(A.assignTutor(c, at.start, at.end, new Map()), { tutor: null, tutorBusy: true });
  assert.equal(A.assignTutor(newFamily('new@example.com'), at.start, at.end, new Map()).tutor.id, lior.id,
    'a new family at that hour gets Lior');
});

test('busy in her calendar counts as busy', () => {
  const at = MON('11');
  assert.equal(A.assignTutor(newFamily('a@example.com'), at.start, at.end, new Map([[nikol.id, [at]]])).tutor.id, lior.id);
});

test('nobody free and nobody else: a plain refusal', () => {
  const at = MON('18');
  assert.deepEqual(A.assignTutor(newFamily('b@example.com'), at.start, at.end, new Map([[nikol.id, [at]], [lior.id, [at]]])),
    { tutor: null, tutorBusy: false });
});

test("a returning family's calendars to read include the other tutors, for TUTOR_BUSY", () => {
  const c = C.bookingCandidates({ email: 'cohen@example.com', name: 'דנה', subject: 'מתמטיקה' });
  assert.deepEqual(A.tutorsToAsk(c).map(t => t.id), [nikol.id, lior.id]);
  assert.deepEqual(A.tutorsToAsk(C.heldCandidates(lior.id)).map(t => t.id), [lior.id]);
});

const ICS = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:x@test\r\nDTSTAMP:20300101T000000Z\r\nDTSTART:20300325T080000Z\r\nDTEND:20300325T090000Z\r\nSUMMARY:x\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

test('a feed that cannot be read counts as free, and says so without the address', async () => {
  const original = globalThis.fetch;
  const saved = console.error;
  const errors = [];
  globalThis.fetch = async () => { throw new Error('request to https://feeds.example.test/1.ics failed'); };
  console.error = (...a) => errors.push(a.map(String).join(' '));
  try {
    const busy = await A.calendarBusyAround([E.getTeacher(nikol.id)], MON('25').start, MON('25').end);
    assert.deepEqual(busy.get(nikol.id), []);
    assert.equal(errors.length, 1);
    assert.doesNotMatch(errors[0], /feeds\.example/);
  } finally {
    globalThis.fetch = original;
    console.error = saved;
  }
});

test("each tutor's busy times come from their own feeds", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(String(url).endsWith(`/${nikol.id}.ics`) ? ICS : 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
  try {
    const busy = await A.calendarBusyAround([E.getTeacher(nikol.id), E.getTeacher(lior.id)], MON('25').start, MON('25').end);
    assert.equal(busy.get(nikol.id).length, 1);
    assert.equal(busy.get(lior.id).length, 0);
  } finally {
    globalThis.fetch = original;
  }
});

/* The write itself is tested with Google faked (lesson-calendar.test.mjs);
   the harness has no service account, so this pins which calendar the route
   hands it. */
test("the booking route writes the event into the booking tutor's calendar, and no other", () => {
  const route = readFileSync(new URL('../../src/routes/api/book/+server.ts', import.meta.url), 'utf8');
  assert.match(route, /insertLessonEvent\(sa, tutor\.calendar_id, event\)/);
  assert.doesNotMatch(route, /process\.env\.CALENDAR_ID/);
});
```

```js
// tests/unit/enroll-tutor.test.mjs
//
// Enrolment takes the tutor /api/book chose, and the family's page names them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = await mkdtemp(join(tmpdir(), 'enroll-tutor-'));
process.env.DB_PATH = join(dir, 'results.db');
process.env.PORTAL_DIR = join(dir, 'portal');
const E = await import('../../src/lib/server/entities.ts');
const { enrollFromBooking } = await import('../../src/lib/server/enroll.ts');
const [nikol, lior] = E.listTeachers();
const booking = (over) => ({ name: 'דנה', email: 'e@example.com', subject: 'מתמטיקה', level: 'ח', start: '2030-01-01T08:00:00Z', ...over });

test('a new family is enrolled with the tutor the booking was given, and their page names them', () => {
  const r = enrollFromBooking(booking({ email: 'one@example.com' }), lior);
  assert.equal(r.enrollment.teacher_id, lior.id);
  assert.equal(r.teacherName, 'ליאור');
  assert.equal(JSON.parse(readFileSync(join(dir, 'portal', `${r.student.code}.json`), 'utf8')).tutor, 'ליאור');
});

test('without one, the default tutor, as before', () => {
  assert.equal(enrollFromBooking(booking({ email: 'two@example.com' })).enrollment.teacher_id, nikol.id);
});

test("booking again with another tutor keeps the student's own", () => {
  enrollFromBooking(booking({ email: 'three@example.com' }), lior);
  assert.equal(enrollFromBooking(booking({ email: 'three@example.com' }), nikol).enrollment.teacher_id, lior.id);
});
```

```js
// tests/characterization/per-tutor-booking.test.mjs
//
// Each lesson goes to its own tutor
// (docs/superpowers/specs/2026-10-17-per-tutor-booking-design.md): a new
// family to whoever is free, Nikol first; a returning family only ever to
// their own tutor. Lior "takes bookings" here through the database, with a
// busy feed on port 1: refused at once, so his calendar reads as free.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, familySession } from './harness.mjs';

const NIKOL = 1, LIOR = 2;
const HOUR = { start: '2027-03-15T10:00:00+02:00', end: '2027-03-15T11:30:00+02:00' };
const LATER = { start: '2027-03-16T10:00:00+02:00', end: '2027-03-16T11:30:00+02:00' };
const TAKEN = { error: 'השעה הזו כבר תפוסה' };

function run(dbPath, sql, ...params) {
  const db = new DatabaseSync(dbPath);
  try { db.prepare(sql).run(...params); } finally { db.close(); }
}
function rows(dbPath, sql, ...params) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { return db.prepare(sql).all(...params); } finally { db.close(); }
}
const liorTakesBookings = (dbPath) => run(dbPath,
  `UPDATE teachers SET calendar_id = 'lior-lessons@example.com', busy_ics = 'https://127.0.0.1:1/lior.ics' WHERE id = ?`, LIOR);
const tutorsOf = (dbPath, email) => rows(dbPath, `
  SELECT b.teacher_id AS t FROM bookings_v2 b
    JOIN students_v2 s ON s.id = b.student_id JOIN accounts a ON a.id = s.account_id
   WHERE a.email = ? AND b.status = 'confirmed' ORDER BY b.id`, email).map(r => r.t);
const confirmToken = (id, expMs) => {
  const payload = `p.${id}.${expMs}`;
  return `${payload}.${createHmac('sha256', 'test-secret-not-a-real-one').update(payload).digest('base64url')}`;
};
const book = (baseUrl, over = {}, headers = {}) => fetch(`${baseUrl}/api/book`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify({ name: 'דנה', subject: 'מתמטיקה', level: 'כיתה ח', phone: '0501234567',
    email: 'dana@example.com', durationMin: 90, ...HOUR, ...over }),
});

test('two new families at one hour: Nikol, then Lior, then nobody', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    liorTakesBookings(dbPath);
    assert.equal((await book(baseUrl, { email: 'a@example.com' })).status, 200);
    assert.equal((await book(baseUrl, { email: 'b@example.com' })).status, 200);
    const third = await book(baseUrl, { email: 'c@example.com' });
    assert.equal(third.status, 409);
    assert.deepEqual(await third.json(), TAKEN);
    assert.deepEqual(tutorsOf(dbPath, 'a@example.com'), [NIKOL]);
    assert.deepEqual(tutorsOf(dbPath, 'b@example.com'), [LIOR]);
  } finally { await stop(); }
});

test('until Lior takes bookings, everything goes to Nikol and a taken hour is refused, as today', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    assert.equal((await book(baseUrl, { email: 'a@example.com' })).status, 200);
    const second = await book(baseUrl, { email: 'b@example.com' });
    assert.equal(second.status, 409);
    assert.deepEqual(await second.json(), TAKEN);
    assert.deepEqual(tutorsOf(dbPath, 'a@example.com'), [NIKOL]);
  } finally { await stop(); }
});

test('two families booking one hour at the same moment land with two tutors', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    liorTakesBookings(dbPath);
    const [x, y] = await Promise.all([book(baseUrl, { email: 'x@example.com' }), book(baseUrl, { email: 'y@example.com' })]);
    assert.deepEqual([x.status, y.status], [200, 200]);
    assert.deepEqual([...tutorsOf(dbPath, 'x@example.com'), ...tutorsOf(dbPath, 'y@example.com')].sort(), [NIKOL, LIOR]);
  } finally { await stop(); }
});

test('a returning family whose tutor is busy is told so, and never handed the other tutor', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    liorTakesBookings(dbPath);
    const first = await (await book(baseUrl)).json();
    const cookie = await familySession(first.portal.link);
    const signedIn = await book(baseUrl, { name: 'נועה' }, { Cookie: cookie });
    assert.equal(signedIn.status, 409);
    assert.deepEqual(await signedIn.json(), { code: 'TUTOR_BUSY', error: 'השעה הזאת לא פנויה אצל המורה שלכם', tutorId: NIKOL });
    // Not signed in: the hold path decides the same way.
    const signedOut = await book(baseUrl, { name: 'נועה' });
    assert.equal(signedOut.status, 409);
    assert.equal((await signedOut.json()).code, 'TUTOR_BUSY');
    assert.deepEqual(tutorsOf(dbPath, 'dana@example.com'), [NIKOL], 'nothing was booked with Lior');
    assert.equal(rows(dbPath, `SELECT COUNT(*) AS n FROM pending_bookings`)[0].n, 0, 'nothing was held');
  } finally { await stop(); }
});

test('a known email that is not signed in is held with their tutor, and confirms with that tutor', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    await book(baseUrl);
    liorTakesBookings(dbPath);
    const answer = await (await book(baseUrl, { name: 'נועה', ...LATER })).json();
    assert.equal(answer.awaitingConfirmation, true);
    const [hold] = rows(dbPath, `SELECT id, teacher_id, expires_at FROM pending_bookings`);
    assert.equal(hold.teacher_id, NIKOL);
    // Meanwhile the family moves to Lior. The held lesson stays Nikol's.
    run(dbPath, `UPDATE enrollments SET teacher_id = ?`, LIOR);
    const confirmed = await fetch(`${baseUrl}/api/book`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: confirmToken(hold.id, Date.parse(hold.expires_at)) }),
    });
    assert.equal(confirmed.status, 200, await confirmed.clone().text());
    assert.deepEqual(tutorsOf(dbPath, 'dana@example.com'), [NIKOL, NIKOL]);
  } finally { await stop(); }
});

test("booking again keeps the tutor; a moved student's next lesson goes to the new tutor, the earlier one stays", async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    liorTakesBookings(dbPath);
    const first = await (await book(baseUrl)).json();
    const cookie = await familySession(first.portal.link);
    run(dbPath, `UPDATE enrollments SET teacher_id = ?`, LIOR);
    assert.equal((await book(baseUrl, LATER, { Cookie: cookie })).status, 200);
    assert.deepEqual(tutorsOf(dbPath, 'dana@example.com'), [NIKOL, LIOR]);
    assert.deepEqual(rows(dbPath, `SELECT teacher_id FROM enrollments`).map(r => r.teacher_id), [LIOR],
      'booking again did not put her back with Nikol');
  } finally { await stop(); }
});

test("a family booked with Lior has his name on their page", async () => {
  const { baseUrl, dbPath, dataDir, stop } = await startServer();
  try {
    liorTakesBookings(dbPath);
    await book(baseUrl, { email: 'a@example.com' });
    const b = await (await book(baseUrl, { email: 'b@example.com', name: 'יואב' })).json();
    const page = JSON.parse(readFileSync(join(dataDir, 'portal', `${b.portal.code}.json`), 'utf8'));
    assert.equal(page.tutor, 'ליאור');
  } finally { await stop(); }
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm run build && node --test tests/unit/tutor-assign.test.mjs tests/unit/enroll-tutor.test.mjs tests/characterization/per-tutor-booking.test.mjs`
Expected: FAIL.
- `ERR_MODULE_NOT_FOUND` for `tutor-assign.ts`.
- `enroll-tutor` fails on `teacher_id` (`1 !== 2`).
- The characterization run fails on: the second family getting 409 instead of 200, the missing `TUTOR_BUSY`, and `tutorsOf` showing `[1]` where `[2]` is expected.

- [ ] **Step 3: Implement**

Create `src/lib/server/tutor-assign.ts`:

```ts
/**
 * Choosing the tutor for one booking
 * (docs/superpowers/specs/2026-10-17-per-tutor-booking-design.md, "Booking").
 *
 * Two halves, because of the race defense. The candidates' calendars are
 * read first — async, BEFORE /api/book's synchronous block. The choice is
 * then made synchronously, INSIDE that block, against the database as it
 * is at that instant, so the tutor chosen is the tutor reserveBooking
 * claims the hour for, with nothing awaited between.
 */
import { fetchTutorBusy, type BusyInterval } from './calendar.ts';
import { readBookingsFor, type TeacherRow } from './entities.ts';
import { busyAddresses, teachingHours } from './tutor-settings.ts';
import { bookableTutors, type Candidates } from './tutor-candidates.ts';
import { pickTutor, type TutorDay } from './tutor-slots.ts';

/** A day either side of the lesson: enough for any buffer or break. */
const MARGIN_MS = 24 * 3600 * 1000;
const around = (start: string, end: string) => ({
  from: new Date(Date.parse(start) - MARGIN_MS).toISOString(),
  to: new Date(Date.parse(end) + MARGIN_MS).toISOString(),
});

/** Whose calendars to read: the candidates and — for a returning family —
 *  everyone else who takes bookings, because TUTOR_BUSY depends on whether
 *  another tutor is free. */
export function tutorsToAsk(c: Candidates): TeacherRow[] {
  const all = c.returning ? [...c.tutors, ...bookableTutors()] : c.tutors;
  return [...new Map(all.map(t => [t.id, t])).values()];
}

/**
 * Each tutor's calendar busy times around [start, end), from the same
 * 5-minute cache the hours page fills. A feed that cannot be read counts as
 * free — the fail-open availability already applies — and is recorded for
 * the dashboard's warning (calendar.ts).
 */
export async function calendarBusyAround(
  tutors: TeacherRow[], start: string, end: string,
): Promise<Map<number, BusyInterval[]>> {
  const { from, to } = around(start, end);
  const reads = await Promise.all(tutors.map(async t => {
    const read = await fetchTutorBusy({ id: t.id, name: t.name, addresses: busyAddresses(t) }, from, to);
    return [t.id, read.busy] as const;
  }));
  return new Map(reads);
}

export interface Assignment {
  /** Who teaches it, or null when no candidate is free. */
  tutor: TeacherRow | null;
  /** No candidate is free, the family is returning, and another tutor who
   *  takes bookings is free: their own tutor is the busy one. */
  tutorBusy: boolean;
}

/** SYNCHRONOUS — call it inside /api/book's no-await block, right before
 *  enrolment and reserveBooking. */
export function assignTutor(
  c: Candidates, start: string, end: string, calendar: Map<number, BusyInterval[]>,
): Assignment {
  const { from, to } = around(start, end);
  const day = (t: TeacherRow): TutorDay => ({
    hours: teachingHours(t),
    calendar: calendar.get(t.id) ?? [],
    bookings: readBookingsFor(t.id, from, to),
  });
  const tutor = pickTutor(c.tutors, start, end, day);
  if (tutor || !c.returning) return { tutor, tutorBusy: false };
  const others = bookableTutors().filter(t => !c.tutors.some(x => x.id === t.id));
  return { tutor: null, tutorBusy: pickTutor(others, start, end, day) !== null };
}
```

In `src/lib/server/enroll.ts`:
- Add `type TeacherRow` to the `./entities.ts` import.
- Change the signature to `export function enrollFromBooking(booking: BookingInput, teacher: TeacherRow | null = defaultTeacher()): EnrollResult {`.
- Delete the line `const teacher = defaultTeacher();` inside the transaction.
- Replace the `teacherName` doc comment in `EnrollResult` with:

```ts
  /** The tutor this booking was given (by /api/book; the default teacher
   *  when the caller names none), or null when there is no active teacher
   *  — independent of whether this booking had a subject to enrol in. The
   *  booking confirmation email names this tutor rather than a hardcoded one. */
```

In `src/routes/api/book/+server.ts`:

1. Replace the entities import line with:

```ts
import { reserveBooking, slotTakenFor, cancelBooking, findAccountByEmail, type AccountRow, type TeacherRow } from '$server/entities.ts';
import { bookingCandidates, heldCandidates, type Candidates } from '$server/tutor-candidates.ts';
import { assignTutor, calendarBusyAround, tutorsToAsk, type Assignment } from '$server/tutor-assign.ts';
```

2. Change `book()`'s signature to:

```ts
async function book(
  body: ConfirmedBookBody, enrolled: EnrollResult | null,
  /** The family account this request is signed in as, if any. */
  sessionAccountId: number | null,
  /** Who teaches it: the tutor completeBooking assigned (migration 029). */
  tutor: TeacherRow,
): Promise<BookResult> {
```

3. In `book()`, replace everything from `/* The room is the lesson's teacher's:` through the `const booking = { … tutorName: teacher?.name ?? null };` line with:

```ts
  /* Their room, their name, their lesson calendar: all the booking
     tutor's, never the student's tutor of the moment (spec D6). */
  const place = lessonPlace(body.mode ?? null, tutor.meet_url ?? null);
  const sa = serviceAccount();

  const booking = { name, subject, request: requestText, phone, email, level, start, durationMin, place, tutorName: tutor.name };
```

4. In `book()`'s calendar `try`, replace the two lines Task 8 left with:

```ts
    /* No fallback calendar. Only a tutor with one is ever assigned
       (takesBookings), so reaching here without one means it was cleared
       after this booking was held: the booking stands, and is flagged like
       any write that failed. */
    if (!tutor.calendar_id) throw new Error(`no lesson calendar for ${tutor.name}`);
    const event = bookingEvent({ name, subject, request: requestText, level, phone, email, start, end, durationMin }, place);
    created = await insertLessonEvent(sa, tutor.calendar_id, event);
```

5. Add, directly above `interface CompleteCtx`:

```ts
/** 409 when no candidate is free. A returning family whose own tutor is
 *  busy, while another tutor is free, is told so and handed their tutor's
 *  id, so the page can reload that tutor's hours — never offered the other
 *  tutor (spec D3). The id reveals nothing the tutors' public page doesn't. */
function noTutorFree(c: Candidates, a: Assignment): Response {
  if (a.tutorBusy) {
    return json({ code: 'TUTOR_BUSY', error: 'השעה הזאת לא פנויה אצל המורה שלכם', tutorId: c.familyTutorId }, { status: 409 });
  }
  return json({ error: 'השעה הזו כבר תפוסה' }, { status: 409 });
}
```

6. Add to `CompleteCtx`:

```ts
  /** A confirmed hold's tutor (pending_bookings.teacher_id): it books with
   *  them, and only their hour is checked again. */
  heldTutorId?: number | null;
```

7. In `holdForConfirmation`, replace

```ts
  if (slotTaken(body.start, body.end)) {
    return json({ error: 'השעה הזו כבר תפוסה' }, { status: 409 });
  }
  const id = holdBooking({ accountId: account.id, body: { ...body, attribution: extra.attribution, heardFrom: extra.heardFrom } });
```

with

```ts
  /* The choice completeBooking would make, so the hold is with the tutor
     the booking will be. Calendars first; from the choice to holdBooking
     nothing is awaited, as with reserveBooking. */
  const candidates = bookingCandidates(body);
  const calendar = await calendarBusyAround(tutorsToAsk(candidates), body.start, body.end);
  const assigned = assignTutor(candidates, body.start, body.end, calendar);
  if (!assigned.tutor) return noTutorFree(candidates, assigned);
  const id = holdBooking({
    accountId: account.id, teacherId: assigned.tutor.id,
    body: { ...body, attribution: extra.attribution, heardFrom: extra.heardFrom },
  });
```

8. In `confirmHeld`, add `heldTutorId: held.teacherId,` to the context object passed to `completeBooking`.

9. In `completeBooking`, directly after the `sourceUtm` line, insert:

```ts

  /* Who may teach this lesson (tutor-candidates.ts), and when each of them
     is busy in their own calendars. These are the only awaits before the
     hour is claimed, and they come BEFORE the synchronous block below, so
     they open no race: the choice is made against the database as it is
     when the block runs. A confirmed hold keeps the tutor it was held with. */
  const candidates = ctx.heldTutorId != null ? heldCandidates(ctx.heldTutorId) : bookingCandidates(body);
  const calendar = await calendarBusyAround(tutorsToAsk(candidates), body.start, body.end);

  /* ── Synchronous from here to reserveBooking's return. ── The tutor is
     chosen, the family enrolled with them, and the hour claimed for them,
     with nothing awaited between: two families at one hour can land with
     two tutors, never with one. */
  const assigned = assignTutor(candidates, body.start, body.end, calendar);
  const tutor = assigned.tutor;
  if (!tutor) return noTutorFree(candidates, assigned);
```

10. In `completeBooking`:
    - replace `enrolled = enrollFromBooking(body);` with `enrolled = enrollFromBooking(body, tutor);`;
    - replace `if (slotTaken(body.start, body.end)) {` with `if (slotTakenFor(tutor.id, body.start, body.end)) {`;
    - add `teacherId: tutor.id,` to the `reserveBooking({ … })` argument after `mode: …`;
    - replace `result = await book(body, enrolled, ctx.sessionAccountId);` with `result = await book(body, enrolled, ctx.sessionAccountId, tutor);`.

- [ ] **Step 4: Run them to see them pass, then the whole suite**

Run: `npm run build && node --test tests/unit/tutor-assign.test.mjs tests/unit/enroll-tutor.test.mjs tests/characterization/per-tutor-booking.test.mjs`
Expected: PASS, with no failures.

Run: `node --test "tests/**/*.test.mjs" > /tmp/claude-1000/suite-t9.log 2>&1; tail -12 /tmp/claude-1000/suite-t9.log`
Expected: `# fail 0`. Every existing booking characterization test passes unchanged; this is goal 4.

Run: `npm run check 2>&1 | tail -3`
Expected: `svelte-check found 0 errors`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/tutor-assign.ts src/lib/server/enroll.ts src/routes/api/book/+server.ts tests/unit/tutor-assign.test.mjs tests/unit/enroll-tutor.test.mjs tests/characterization/per-tutor-booking.test.mjs
git commit -F- <<'EOF'
Each booking is assigned its tutor: whoever is free, Nikol first; a returning family only theirs

The event goes to that tutor's lesson calendar with their room and name.
A returning family whose tutor is busy gets TUTOR_BUSY with their tutor's
id. A hold keeps its tutor through confirmation.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M83cAin9ny5QGUYH4Ydu6F
EOF
```

---

### Task 10: Reminders follow the booking's tutor

**Files:**
- Modify: `src/lib/server/reminders.ts:128-151`
- Test: `tests/unit/reminder-tutor.test.mjs`

**Interfaces:**
- Consumes: `bookings_v2.teacher_id` (Task 2), `setEnrollmentTeacher` (Task 2).
- Produces: `pendingReminders()` takes `meetUrl` from the booking's tutor.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/reminder-tutor.test.mjs
//
// A reminder carries the room of the tutor the lesson was booked with —
// moving the student since does not move a booked lesson (spec D6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'reminder-tutor-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const R = await import('../../src/lib/server/reminders.ts');
const { handle } = await import('../../src/lib/server/db.ts');

const [nikol, lior] = E.listTeachers();
const NIKOL_ROOM = 'https://meet.google.com/aaa-bbbb-ccc';
const LIOR_ROOM = 'https://meet.google.com/ddd-eeee-fff';
handle().prepare(`UPDATE teachers SET meet_url = ? WHERE id = ?`).run(NIKOL_ROOM, nikol.id);
handle().prepare(`UPDATE teachers SET meet_url = ? WHERE id = ?`).run(LIOR_ROOM, lior.id);

test("the reminder carries the room of the lesson's tutor, not the student's tutor today", () => {
  const NOW = '2031-03-01T09:00:00.000Z';
  const start = new Date(Date.parse(NOW) + 20 * 3600e3).toISOString();
  const account = E.createAccount({ name: 'משפחה', credential: 'x', email: 'r@example.com' });
  const s = E.createStudent({ code: 'rt1', name: 'דנה', accountId: account.id, credential: 'x' });
  const enr = E.upsertEnrollment({ studentId: s.id, subject: 'מתמטיקה', teacherId: nikol.id });
  const id = E.reserveBooking({ studentId: s.id, enrollmentId: enr.id, start, end: start, durationMin: 45, mode: 'online', teacherId: nikol.id });
  E.setEnrollmentTeacher(enr.id, lior.id);
  assert.equal(R.pendingReminders(NOW).find(b => b.id === id).meetUrl, NIKOL_ROOM);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test tests/unit/reminder-tutor.test.mjs`
Expected: FAIL: the actual value is `'https://meet.google.com/ddd-eeee-fff'` where `'https://meet.google.com/aaa-bbbb-ccc'` is expected.

- [ ] **Step 3: Implement**

In `src/lib/server/reminders.ts`'s `pendingReminders` SELECT, replace `b.mode AS mode, e.teacher_id AS teacherId` with `b.mode AS mode, b.teacher_id AS teacherId`. Replace the comment above the final `return` with:

```ts
  /* The room is the booking's tutor's (bookings_v2.teacher_id, migration
     029): a student moved to another tutor keeps the room of a lesson they
     had already booked. Looked up only for what is due, and through
     lessonTeacher so a reminder and the booking email can never name
     different rooms. */
```

- [ ] **Step 4: Run it to see it pass, with the reminder suites**

Run: `node --test tests/unit/reminder-tutor.test.mjs tests/unit/lesson-reminders.test.mjs tests/unit/lesson-mode.test.mjs`
Expected: PASS, with no failures.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/reminders.ts tests/unit/reminder-tutor.test.mjs
git commit -F- <<'EOF'
A reminder carries the room of the tutor the lesson was booked with

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M83cAin9ny5QGUYH4Ydu6F
EOF
```

---

### Task 11: Tutor settings from the dashboard

**Files:**
- Create: `src/routes/api/teachers/[id]/+server.ts`
- Modify: `src/routes/app/dashboard/+page.server.ts:14-15,54-60`
- Replace: `src/lib/components/TutorsCard.svelte`
- Modify: `src/routes/app/dashboard/+page.svelte:1237`
- Test: `tests/characterization/tutor-settings.test.mjs`

**Interfaces:**
- Consumes: Task 3 (`parseBusyAddresses`, `updateTutorSettings`, `tutorCardView`), `$lib/teaching-hours.ts`, `clearSourceIssues` (Task 7).
- Produces:
  - `PATCH /api/teachers/:id` with body `{ calendarId?: string | null, busyIcs?: string, teachingHours?: Record<string,[string,string]> | null }`. It answers `{ tutor: tutorCardView }`, or 400 `{ error }`, 401, or 404.
  - `pageData.tutors`: `tutorCardView[]`. `tutorsDefaultId` is removed.

- [ ] **Step 1: Write the failing test**

```js
// tests/characterization/tutor-settings.test.mjs
//
// A tutor's booking settings from the "מורים" card. The busy addresses are
// secrets: no response, page or API carries them back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, login } from './harness.mjs';

const SECRET_A = 'https://calendar.google.com/calendar/ical/lior/private-DO-NOT-LEAK/basic.ics';
const SECRET_B = 'https://calendar.google.com/calendar/ical/x/private-ALSO-SECRET/basic.ics';
const markup = (h) => h.split(/<script nonce=/)[0];
const patch = (baseUrl, cookie, id, body) => fetch(`${baseUrl}/api/teachers/${id}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
});
function lior(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { return { ...db.prepare(`SELECT calendar_id, busy_ics, teaching_hours FROM teachers WHERE id = 2`).get() }; } finally { db.close(); }
}

test('only a dashboard session changes a tutor, and only a real one', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    assert.equal((await patch(baseUrl, null, 2, { calendarId: 'x@example.com' })).status, 401);
    assert.equal((await patch(baseUrl, await login(baseUrl), 999, { calendarId: 'x@example.com' })).status, 404);
  } finally { await stop(); }
});

test("saving a tutor's settings shows them ready, and never sends an address back", async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const before = markup(await (await fetch(`${baseUrl}/app/dashboard`, { headers: { cookie } })).text());
    assert.match(before, /לא מקבל\/ת הזמנות עדיין: אין יומן שיעורים · אין כתובת יומן פרטית/, 'Lior, before');
    assert.match(before, /מקבל\/ת הזמנות ✓/, 'Nikol took over the .env values');

    const r = await patch(baseUrl, cookie, 2, {
      calendarId: 'lior-lessons@group.calendar.google.com',
      busyIcs: `${SECRET_A}\n${SECRET_B}\n`,
      teachingHours: { 0: ['09:00', '18:00'], 5: ['08:00', '12:00'] },
    });
    assert.equal(r.status, 200);
    const text = await r.text();
    assert.doesNotMatch(text, /DO-NOT-LEAK|ALSO-SECRET/);
    const { tutor } = JSON.parse(text);
    assert.equal(tutor.busyCount, 2);
    assert.deepEqual(tutor.missing, []);
    assert.deepEqual(tutor.teachingHours, { 0: ['09:00', '18:00'], 5: ['08:00', '12:00'] });

    for (const path of ['/app/dashboard', '/api/students', '/api/calendar-failures']) {
      const body = await (await fetch(`${baseUrl}${path}`, { headers: { cookie } })).text();
      assert.doesNotMatch(body, /DO-NOT-LEAK|ALSO-SECRET/, path);
    }
    const after = markup(await (await fetch(`${baseUrl}/app/dashboard`, { headers: { cookie } })).text());
    assert.match(after, /2 כתובות שמורות/);
    assert.doesNotMatch(after, /לא מקבל\/ת הזמנות/);
  } finally { await stop(); }
});

test('a bad address, bad hours or a bad calendar id is refused and nothing is saved', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    for (const [body, error] of [
      [{ busyIcs: 'http://calendar.google.com/x.ics' }, /https/],
      [{ teachingHours: { 6: ['08:00', '12:00'] } }, /שעות/],
      [{ teachingHours: { 0: ['12:00', '09:00'] } }, /שעות/],
      [{ calendarId: 'not a calendar' }, /יומן/],
    ]) {
      const r = await patch(baseUrl, cookie, 2, body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.match((await r.json()).error, error);
    }
    assert.deepEqual(lior(dbPath), { calendar_id: null, busy_ics: null, teaching_hours: null });
  } finally { await stop(); }
});

test('leaving the addresses out keeps the ones saved', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    await patch(baseUrl, cookie, 2, { busyIcs: SECRET_A });
    await patch(baseUrl, cookie, 2, { calendarId: 'lior-lessons@group.calendar.google.com', teachingHours: null });
    assert.equal(lior(dbPath).busy_ics, SECRET_A);
  } finally { await stop(); }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run build && node --test tests/characterization/tutor-settings.test.mjs`
Expected: FAIL. PATCH answers `405` where `401` is expected, and the dashboard markup lacks `לא מקבל/ת הזמנות עדיין`.

- [ ] **Step 3: Implement**

Create `src/routes/api/teachers/[id]/+server.ts`:

```ts
/**
 * A tutor's booking settings, from the "מורים" card: lesson calendar,
 * private busy addresses and teaching hours (migration 029,
 * $server/tutor-settings.ts).
 *
 * The answer is the card's view of the tutor, with the addresses as a COUNT.
 * No response from this route, or any other, carries a busy_ics value.
 */
import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { readJson } from '$server/http.ts';
import { getTeacher } from '$server/entities.ts';
import { clearSourceIssues } from '$server/calendar.ts';
import { parseBusyAddresses, tutorCardView, updateTutorSettings, type TutorSettingsPatch } from '$server/tutor-settings.ts';
import { parseTeachingHours } from '$lib/teaching-hours.ts';
import type { RequestHandler } from './$types';

/** A Google calendar id: `…@group.calendar.google.com`, or an account's address. */
const CALENDAR_ID = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const PATCH: RequestHandler = async (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;
  const id = Number(event.params.id);
  const teacher = Number.isInteger(id) && id > 0 ? getTeacher(id) : null;
  if (!teacher) return json({ error: 'teacher not found' }, { status: 404 });

  const parsed = await readJson(event.request);
  if (parsed instanceof Response) return parsed;
  const body = (parsed ?? {}) as Record<string, unknown>;

  /* Every field is checked before anything is written, so a refused
     request leaves the tutor exactly as they were. */
  const patch: TutorSettingsPatch = {};
  if (body.calendarId !== undefined) {
    const value = body.calendarId === null ? '' : typeof body.calendarId === 'string' ? body.calendarId.trim() : null;
    if (value === null || (value && !CALENDAR_ID.test(value))) {
      return json({ error: 'מזהה יומן השיעורים לא תקין — הוא נראה כמו …@group.calendar.google.com' }, { status: 400 });
    }
    patch.calendarId = value || null;
  }
  if (body.busyIcs !== undefined) {
    const list = parseBusyAddresses(body.busyIcs);
    if (!list) return json({ error: 'כל כתובת יומן צריכה להתחיל ב-https://' }, { status: 400 });
    patch.busyIcs = list;
  }
  if (body.teachingHours !== undefined) {
    const hours = body.teachingHours === null ? null : parseTeachingHours(body.teachingHours);
    if (body.teachingHours !== null && !hours) {
      return json({ error: 'שעות ההוראה לא תקינות — לכל יום שעת התחלה לפני שעת הסיום, ראשון עד שישי' }, { status: 400 });
    }
    patch.teachingHours = hours;
  }

  const updated = updateTutorSettings(teacher.id, patch)!;
  // New addresses: warnings about the old ones no longer mean anything.
  if (patch.busyIcs !== undefined) clearSourceIssues(teacher.id);
  return json({ tutor: tutorCardView(updated) }, { headers: { 'Cache-Control': 'no-store' } });
};
```

In `src/routes/app/dashboard/+page.server.ts`:
1. Replace `import { roster, enrollmentsForStudent, listTeachers, defaultTeacher } from '$server/entities.ts';` with these two lines:

```ts
import { roster, enrollmentsForStudent, listTeachers } from '$server/entities.ts';
import { tutorCardView } from '$server/tutor-settings.ts';
```

2. Replace the `tutors: …` and `tutorsDefaultId: …` entries, with their comments, with:

```ts
    /* The "מורים" card: each tutor's room and booking settings — the busy
       addresses only as a count (tutorCardView). Never setup_hash. */
    tutors: listTeachers().filter(t => t.active).map(tutorCardView),
```

In `src/routes/app/dashboard/+page.svelte`, replace

```svelte
  <TutorsCard tutors={pageData.tutors} defaultId={pageData.tutorsDefaultId} googleReady={pageData.googleReady} />
```

with

```svelte
  <TutorsCard tutors={pageData.tutors} googleReady={pageData.googleReady} />
```

Replace `src/lib/components/TutorsCard.svelte` with:

```svelte
<script lang="ts">
  /**
   * Each tutor: whether they take bookings, their booking settings and their
   * Meet room (docs/superpowers/specs/2026-10-17-per-tutor-booking-design.md,
   * 2026-10-16-tutor-meet-setup-design.md). The busy addresses are secrets:
   * the card only ever learns how many are saved, and replacing them means
   * pasting them again. The setup link goes straight to the tutor's
   * WhatsApp when the tutor has a phone.
   */
  import { untrack } from 'svelte';
  import { WEEKDAYS, WEEKDAY_NAMES, type TeachingHours, type Weekday } from '$lib/teaching-hours.ts';

  type Missing = 'calendar' | 'busy';
  type Tutor = {
    id: number; name: string; phone: string | null; meetUrl: string | null; account: string | null;
    calendarId: string | null; busyCount: number; teachingHours: TeachingHours; missing: Missing[];
  };
  type Draft = {
    calendarId: string;
    addresses: string;
    /** Showing the address box: no addresses saved yet, or "החלפה" pressed. */
    replacing: boolean;
    days: Record<Weekday, { on: boolean; from: string; to: string }>;
  };
  let { tutors, googleReady }: { tutors: Tutor[]; googleReady: boolean } = $props();

  // A one-time seed: from here on the card's own saves keep it current.
  let list = $state<Tutor[]>(untrack(() => tutors));
  let links = $state<Record<number, string>>({});
  let busy = $state<number | null>(null);
  let copied = $state<number | null>(null);
  let problem = $state('');
  let open = $state<number | null>(null);
  let draft = $state<Draft | null>(null);
  let saving = $state(false);
  let saved = $state<number | null>(null);

  const MISSING: Record<Missing, string> = { calendar: 'אין יומן שיעורים', busy: 'אין כתובת יומן פרטית' };
  const savedCount = (n: number) => (n === 1 ? 'כתובת אחת שמורה' : `${n} כתובות שמורות`);

  const message = (t: Tutor, link: string): string =>
    `היי ${t.name}, זה הקישור לחיבור חדר ה-Meet שלך לאתר מאה בקליק. לוקח דקה, פעם אחת: ${link}`;

  /** 0501234567 and 972501234567 both reach the same chat; no phone opens
   *  WhatsApp's contact picker. */
  function waHref(t: Tutor, link: string): string {
    const digits = (t.phone ?? '').replace(/\D/g, '');
    const to = digits.startsWith('0') ? `972${digits.slice(1)}` : digits;
    return `https://wa.me/${to}?text=${encodeURIComponent(message(t, link))}`;
  }

  async function mint(t: Tutor) {
    busy = t.id;
    problem = '';
    try {
      const r = await fetch(`/api/teachers/${t.id}/setup-link`, { method: 'POST' });
      if (r.status === 401) { problem = 'ההתחברות פגה. רעננו את הדף והתחברו שוב.'; return; }
      if (!r.ok) { problem = 'לא הצלחתי להכין קישור. נסו שוב.'; return; }
      links = { ...links, [t.id]: (await r.json()).link };
    } catch {
      problem = 'אין חיבור לשרת.';
    } finally {
      busy = null;
    }
  }

  async function copy(t: Tutor) {
    try {
      await navigator.clipboard.writeText(message(t, links[t.id]));
      copied = t.id;
      setTimeout(() => { if (copied === t.id) copied = null; }, 2000);
    } catch {
      problem = `ההעתקה לא הצליחה. הקישור: ${links[t.id]}`;
    }
  }

  function edit(t: Tutor) {
    problem = '';
    open = t.id;
    draft = {
      calendarId: t.calendarId ?? '',
      addresses: '',
      replacing: t.busyCount === 0,
      days: Object.fromEntries(WEEKDAYS.map(d => [d, {
        on: !!t.teachingHours[d],
        from: t.teachingHours[d]?.[0] ?? '08:00',
        to: t.teachingHours[d]?.[1] ?? '16:00',
      }])) as Draft['days'],
    };
  }

  function close() { open = null; draft = null; }

  async function save(t: Tutor) {
    if (!draft) return;
    saving = true;
    problem = '';
    const d = draft;
    const body: Record<string, unknown> = {
      calendarId: d.calendarId.trim() || null,
      teachingHours: Object.fromEntries(WEEKDAYS.filter(w => d.days[w].on).map(w => [w, [d.days[w].from, d.days[w].to]])),
    };
    /* An empty box while replacing saved addresses keeps them: clearing a
       tutor's busy times by accident would make them look free all week. */
    if (d.replacing && (d.addresses.trim() || t.busyCount === 0)) body.busyIcs = d.addresses;
    try {
      const r = await fetch(`/api/teachers/${t.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (r.status === 401) { problem = 'ההתחברות פגה. רעננו את הדף והתחברו שוב.'; return; }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { problem = j.error || 'השמירה לא הצליחה. נסו שוב.'; return; }
      list = list.map(x => (x.id === t.id ? { ...x, ...j.tutor } : x));
      close();
      saved = t.id;
      setTimeout(() => { if (saved === t.id) saved = null; }, 2500);
    } catch {
      problem = 'אין חיבור לשרת.';
    } finally {
      saving = false;
    }
  }
</script>

<div class="tutors">
  {#if !googleReady}
    <p class="off">החיבור ל-Google עוד לא הוגדר בשרת, ולכן אי אפשר עדיין לשלוח קישור הגדרה.</p>
  {/if}
  {#each list as t (t.id)}
    <div class="row">
      <div class="who">
        <b>{t.name}</b>
        {#if t.missing.length === 0}
          <div class="status ok">מקבל/ת הזמנות ✓</div>
        {:else}
          <div class="status missing">לא מקבל/ת הזמנות עדיין: {t.missing.map(m => MISSING[m]).join(' · ')}</div>
        {/if}
        {#if t.meetUrl}
          <div class="status ok">✓ חדר Meet{#if t.account} · <span dir="ltr">{t.account}</span>{/if} · <a href={t.meetUrl} target="_blank" rel="noopener">פתיחה</a></div>
        {:else}
          <div class="status missing">✗ אין חדר Meet</div>
        {/if}
        {#if t.busyCount}<div class="status">{savedCount(t.busyCount)}</div>{/if}
        {#if saved === t.id}<div class="status ok" role="status">✓ נשמר</div>{/if}
      </div>
      <div class="actions">
        <button class="act" aria-expanded={open === t.id} onclick={() => (open === t.id ? close() : edit(t))}>הגדרות הזמנה</button>
        {#if googleReady}
          {#if links[t.id]}
            <a class="act wa" href={waHref(t, links[t.id])} target="_blank" rel="noopener">שליחה בוואטסאפ</a>
            <button class="act" onclick={() => copy(t)}>{copied === t.id ? 'הועתק ✓' : 'העתקה'}</button>
          {:else}
            <button class="act" disabled={busy === t.id} onclick={() => mint(t)}>{busy === t.id ? 'מכין…' : 'שליחת קישור הגדרה'}</button>
          {/if}
        {/if}
      </div>
      {#if open === t.id && draft}
        <form class="settings" onsubmit={(e) => { e.preventDefault(); save(t); }}>
          <label class="field">
            <span class="label">יומן השיעורים (מזהה היומן ב-Google)</span>
            <input dir="ltr" bind:value={draft.calendarId} placeholder="…@group.calendar.google.com" />
          </label>
          <div class="field">
            <span class="label">כתובות יומן פרטיות (iCal) — מהן יודעים מתי {t.name} עסוק/ה</span>
            {#if !draft.replacing}
              <div class="saved">{savedCount(t.busyCount)} <button type="button" class="act small" onclick={() => { if (draft) draft.replacing = true; }}>החלפה</button></div>
            {:else}
              <textarea dir="ltr" rows="3" bind:value={draft.addresses} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"></textarea>
              <span class="hint">כתובת אחת בכל שורה. אחרי השמירה הן לא מוצגות שוב.</span>
            {/if}
          </div>
          <fieldset class="hours">
            <legend class="label">שעות הוראה (שעה אחרונה = סוף השיעור)</legend>
            {#each WEEKDAYS as d (d)}
              <div class="day">
                <label class="day-on"><input type="checkbox" bind:checked={draft.days[d].on} /> {WEEKDAY_NAMES[d]}</label>
                {#if draft.days[d].on}
                  <input type="time" bind:value={draft.days[d].from} aria-label={`${WEEKDAY_NAMES[d]} — משעה`} />
                  <span aria-hidden="true">–</span>
                  <input type="time" bind:value={draft.days[d].to} aria-label={`${WEEKDAY_NAMES[d]} — עד שעה`} />
                {:else}
                  <span class="off-day">לא מלמד/ת</span>
                {/if}
              </div>
            {/each}
          </fieldset>
          <div class="form-actions">
            <button class="act primary" type="submit" disabled={saving}>{saving ? 'שומר…' : 'שמירה'}</button>
            <button class="act" type="button" onclick={close}>ביטול</button>
          </div>
        </form>
      {/if}
    </div>
  {/each}
  {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
</div>

<style>
  .tutors { background: var(--bg-card); border: 1.5px solid var(--border-strong); border-radius: 18px; padding: 6px 14px; }
  .row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 0; border-bottom: 1px solid var(--border); }
  .row:last-of-type { border-bottom: 0; }
  .who { min-width: 0; }
  .status { font-size: .85rem; margin-top: 4px; overflow-wrap: anywhere; }
  .status.ok { color: var(--text); }
  .status.missing { color: var(--text-muted); }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .act { min-height: 44px; display: inline-flex; align-items: center; border: 1.5px solid var(--border-strong); background: none; border-radius: 999px; padding: 0 16px; cursor: pointer; font: inherit; font-size: .85rem; color: inherit; text-decoration: none; }
  .act.wa { background: #25d366; border-color: #25d366; color: #fff; font-weight: 700; }
  .act.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 700; }
  .act.small { min-height: 36px; padding: 0 12px; }
  .act:disabled { opacity: .6; cursor: default; }
  .settings { flex-basis: 100%; display: grid; gap: 14px; padding: 4px 0 6px; min-width: 0; }
  .field { display: grid; gap: 6px; min-width: 0; }
  .label { font-size: .85rem; font-weight: 700; }
  .settings input:not([type="checkbox"]), .settings textarea { width: 100%; max-width: 100%; box-sizing: border-box; min-height: 44px; border: 1.5px solid var(--border-strong); border-radius: 10px; padding: 8px 10px; font: inherit; background: var(--bg-card); color: inherit; }
  .settings input[type="time"] { width: auto; }
  .saved { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; font-size: .9rem; }
  .hint { font-size: .8rem; color: var(--text-muted); }
  .hours { border: 0; padding: 0; margin: 0; display: grid; gap: 8px; min-width: 0; }
  .day { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .day-on { display: inline-flex; align-items: center; gap: 6px; min-width: 5.5em; min-height: 44px; }
  .off-day { color: var(--text-muted); font-size: .85rem; }
  .form-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .off, .problem { font-size: .85rem; margin: 10px 0; }
  .problem { color: var(--danger); font-weight: 700; overflow-wrap: anywhere; }
</style>
```

- [ ] **Step 4: Run it to see it pass, with the setup-link suite**

Run: `npm run build && node --test tests/characterization/tutor-settings.test.mjs tests/characterization/tutor-setup.test.mjs tests/characterization/dashboard-card.test.mjs`
Expected: PASS, with no failures.

Run: `npm run check 2>&1 | tail -3 && node scripts/check-warnings.mjs`
Expected: `svelte-check found 0 errors`, and the warnings check exits 0.

- [ ] **Step 5: Commit**

```bash
git add 'src/routes/api/teachers/[id]/+server.ts' src/routes/app/dashboard/+page.server.ts src/routes/app/dashboard/+page.svelte src/lib/components/TutorsCard.svelte tests/characterization/tutor-settings.test.mjs
git commit -F- <<'EOF'
The "מורים" card sets each tutor's lesson calendar, private addresses and hours

It says whether the tutor takes bookings, or what is missing. Saved
addresses show as a count and are replaced by pasting them again; no
response carries them back.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M83cAin9ny5QGUYH4Ydu6F
EOF
```

---

### Task 12: Moving a student, and naming each upcoming lesson's tutor

**Files:**
- Create: `src/routes/api/enrollments/[id]/+server.ts`
- Modify: `src/lib/server/entities.ts:364-385` (`RosterRow`, `roster`)
- Modify: `src/routes/api/students/[code]/activity/+server.ts:4,21-28`
- Modify: `src/routes/app/dashboard/+page.svelte`: `NextLesson` at :90, `RealStudent` at :428-434, the card header at :997-1000, the next-lesson box at :1032, the profile panel at :1196-1199, and a `moveStudent` function
- Test: `tests/characterization/move-student.test.mjs`

**Interfaces:**
- Consumes: `setEnrollmentTeacher`, `nextBookingForStudent().teacherId` (Task 2); `pageData.tutors` (Task 11).
- Produces:
  - `PATCH /api/enrollments/:id` with body `{ teacherId }`. It answers `{ enrollment: { id, subject, teacherId } }`, or 400, 401, or 404.
  - `RosterRow.enrollments: { id: number; subject: string; teacherId: number | null }[]`.
  - The activity endpoint's `nextLesson.tutor: string | null`.

- [ ] **Step 1: Write the failing test**

```js
// tests/characterization/move-student.test.mjs
//
// Moving a student from their card changes that enrollment's tutor and
// nothing else: the lesson already booked stays with its tutor, and the
// next booking goes to the new one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, login, familySession } from './harness.mjs';

const NIKOL = 1, LIOR = 2;
const HOUR = { start: '2027-03-15T10:00:00+02:00', end: '2027-03-15T11:30:00+02:00' };
const LATER = { start: '2027-03-16T10:00:00+02:00', end: '2027-03-16T11:30:00+02:00' };
const markup = (h) => h.split(/<script nonce=/)[0];

function sql(dbPath, query, ...params) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { return db.prepare(query).all(...params); } finally { db.close(); }
}
function run(dbPath, query, ...params) {
  const db = new DatabaseSync(dbPath);
  try { db.prepare(query).run(...params); } finally { db.close(); }
}
const book = (baseUrl, over = {}, headers = {}) => fetch(`${baseUrl}/api/book`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify({ name: 'דנה', subject: 'מתמטיקה', level: 'כיתה ח', phone: '0501234567',
    email: 'dana@example.com', durationMin: 90, ...HOUR, ...over }),
});
const move = (baseUrl, id, teacherId, cookie) => fetch(`${baseUrl}/api/enrollments/${id}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ teacherId }),
});

test('moving a student: the card shows the new tutor, the booked lesson keeps its own, the next goes to the new one', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    run(dbPath, `UPDATE teachers SET calendar_id = 'lior-lessons@example.com', busy_ics = 'https://127.0.0.1:1/lior.ics' WHERE id = ?`, LIOR);
    const first = await (await book(baseUrl)).json();
    const cookie = await login(baseUrl);
    const [{ id }] = sql(dbPath, `SELECT id FROM enrollments`);

    assert.equal((await move(baseUrl, id, LIOR)).status, 401);
    const moved = await move(baseUrl, id, LIOR, cookie);
    assert.equal(moved.status, 200);
    assert.deepEqual((await moved.json()).enrollment, { id, subject: 'מתמטיקה', teacherId: LIOR });

    const { students } = await (await fetch(`${baseUrl}/api/students`, { headers: { cookie } })).json();
    assert.deepEqual(students[0].enrollments, [{ id, subject: 'מתמטיקה', teacherId: LIOR }]);
    assert.match(markup(await (await fetch(`${baseUrl}/app/dashboard`, { headers: { cookie } })).text()), /מתמטיקה · ליאור/);

    const activity = await (await fetch(`${baseUrl}/api/students/${first.portal.code}/activity`, { headers: { cookie } })).json();
    assert.equal(activity.nextLesson.tutor, 'ניקול', 'the lesson already booked is still Nikol\'s');

    const family = await familySession(first.portal.link);
    assert.equal((await book(baseUrl, LATER, { Cookie: family })).status, 200);
    assert.deepEqual(sql(dbPath, `SELECT teacher_id AS t FROM bookings_v2 ORDER BY id`).map(r => r.t), [NIKOL, LIOR]);
  } finally { await stop(); }
});

test('a tutor who is not active, or an enrollment that does not exist, is refused', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    await book(baseUrl);
    const cookie = await login(baseUrl);
    const [{ id }] = sql(dbPath, `SELECT id FROM enrollments`);
    assert.equal((await move(baseUrl, id, 999, cookie)).status, 400);
    assert.equal((await move(baseUrl, 999, LIOR, cookie)).status, 404);
    assert.deepEqual(sql(dbPath, `SELECT teacher_id AS t FROM enrollments`).map(r => r.t), [NIKOL]);
  } finally { await stop(); }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run build && node --test tests/characterization/move-student.test.mjs`
Expected: FAIL. The PATCH answers `404` where `401` is expected (no route yet), and `students[0].enrollments` is `undefined`.

- [ ] **Step 3: Implement**

Create `src/routes/api/enrollments/[id]/+server.ts`:

```ts
/**
 * Moving a student to another tutor, from their card on the dashboard. It
 * changes that enrollment's tutor and nothing else: lessons already booked
 * keep the tutor they were booked with (spec D6), and the next booking
 * follows the new one.
 */
import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { readJson } from '$server/http.ts';
import { getTeacher, setEnrollmentTeacher } from '$server/entities.ts';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;
  const parsed = await readJson(event.request);
  if (parsed instanceof Response) return parsed;

  const teacherId = Number((parsed as { teacherId?: unknown } | null)?.teacherId);
  const teacher = Number.isInteger(teacherId) && teacherId > 0 ? getTeacher(teacherId) : null;
  if (!teacher?.active) return json({ error: 'המורה הזה/הזאת לא נמצא/ת' }, { status: 400 });

  const id = Number(event.params.id);
  const enrollment = Number.isInteger(id) && id > 0 ? setEnrollmentTeacher(id, teacher.id) : null;
  if (!enrollment) return json({ error: 'enrollment not found' }, { status: 404 });
  return json({ enrollment: { id: enrollment.id, subject: enrollment.subject, teacherId: enrollment.teacher_id } });
};
```

In `src/lib/server/entities.ts`, replace `RosterRow` and `roster()` with:

```ts
/** The dashboard's roster: every student with the account contact beside
 *  it, so the tutor sees who to message without opening each family — and
 *  each enrollment with its tutor, for the card's tutor picker. */
export type RosterRow = StudentRow & {
  account_name: string;
  email: string | null;
  account_phone: string | null;
  subjects: string | null;
  enrollments: { id: number; subject: string; teacherId: number | null }[];
};

export function roster(): RosterRow[] {
  const rows = handle().prepare(`
    SELECT s.*,
           a.name  AS account_name,
           a.email AS email,
           a.phone AS account_phone,
           (SELECT GROUP_CONCAT(e.subject, ', ')
              FROM enrollments e WHERE e.student_id = s.id) AS subjects,
           (SELECT json_group_array(json_object('id', e.id, 'subject', e.subject, 'teacherId', e.teacher_id))
              FROM enrollments e WHERE e.student_id = s.id) AS enrollments_json
    FROM students_v2 s
    JOIN accounts a ON a.id = s.account_id
    ORDER BY s.created_at DESC
  `).all() as (Omit<RosterRow, 'enrollments'> & { enrollments_json: string })[];
  return rows.map(({ enrollments_json, ...r }) => ({
    ...r,
    enrollments: (JSON.parse(enrollments_json) as RosterRow['enrollments']).sort((a, b) => a.id - b.id),
  }));
}
```

In `src/routes/api/students/[code]/activity/+server.ts`:
- Change the import to `import { getStudentByCode, getTeacher, nextBookingForStudent } from '$server/entities.ts';`.
- Inside `nextLesson: booking ? { … }`, add after the `type:` line:

```ts
      /* Who teaches it: the booking's tutor, which moving the student does not change. */
      tutor: booking.teacherId != null ? getTeacher(booking.teacherId)?.name ?? null : null,
```

In `src/routes/app/dashboard/+page.svelte`:

1. Replace `interface NextLesson { date: string; time: string; type: string }` with `interface NextLesson { date: string; time: string; type: string; tutor?: string | null }`.
2. In `interface RealStudent`, after `subjects: string | null;`, add `enrollments: { id: number; subject: string; teacherId: number | null }[];`.
3. Directly after `let realStudents = $state<RealStudent[]>(…);`, add:

```ts
  const tutorName = (id: number | null): string | null => pageData.tutors.find(t => t.id === id)?.name ?? null;
  /** "ניקול", or "ניקול, ליאור" for a student with subjects at both. */
  const tutorsOf = (s: RealStudent): string =>
    [...new Set((s.enrollments ?? []).map(e => tutorName(e.teacherId)).filter(Boolean))].join(', ');

  /** Moves one enrollment to another tutor. Lessons already booked stay with
   *  the tutor they were booked with; the next booking goes to the new one. */
  async function moveStudent(s: RealStudent, enrollmentId: number, teacherId: number) {
    try {
      const r = await api(`/api/enrollments/${enrollmentId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ teacherId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast(j.error || 'ההעברה לא הצליחה', { kind: 'error' }); return; }
      realStudents = realStudents.map(x => (x.code !== s.code ? x : {
        ...x, enrollments: x.enrollments.map(e => (e.id === enrollmentId ? { ...e, teacherId } : e)),
      }));
      toast(`${s.name} עכשיו אצל ${tutorName(teacherId)}. שיעורים שכבר נקבעו נשארים כמו שהם.`);
    } catch {
      toast('אין חיבור לשרת — ההעברה לא נשמרה', { kind: 'error' });
    }
  }
```

4. In the card header, replace `<div class="sc-subject">{s.subjects || '—'}</div>` with:

```svelte
                <div class="sc-subject">{s.subjects || '—'}{tutorsOf(s) ? ` · ${tutorsOf(s)}` : ''}</div>
```

5. In the next-lesson box, replace `<div class="nl-meta">סוג: {ex.nextLesson.type || 'יחיד'}</div>` with:

```svelte
                  <div class="nl-meta">סוג: {ex.nextLesson.type || 'יחיד'}{ex.nextLesson.tutor ? ` · עם ${ex.nextLesson.tutor}` : ''}</div>
```

6. In the profile panel, directly after the field-row that holds `שם` and `מקצועות`, add:

```svelte
              {#each s.enrollments ?? [] as en (en.id)}
                <div class="field-row single">
                  <div class="field"><label for="pf-tutor-{en.id}">מורה{s.enrollments.length > 1 ? ` · ${en.subject}` : ''}</label>
                    <select id="pf-tutor-{en.id}" onchange={(e) => moveStudent(s, en.id, Number(e.currentTarget.value))}>
                      {#if en.teacherId == null}<option value="" selected>— לא נבחר —</option>{/if}
                      {#each pageData.tutors as tt (tt.id)}<option value={tt.id} selected={en.teacherId === tt.id}>{tt.name}</option>{/each}
                    </select>
                  </div>
                </div>
              {/each}
```

- [ ] **Step 4: Run it to see it pass, with the roster suites**

Run: `npm run build && node --test tests/characterization/move-student.test.mjs tests/characterization/students.test.mjs tests/characterization/dashboard-card.test.mjs tests/unit/tutor-roster-wiring.test.mjs`
Expected: PASS, with no failures.

Run: `npm run check 2>&1 | tail -3 && node scripts/check-warnings.mjs`
Expected: `svelte-check found 0 errors`, and the warnings check exits 0.

- [ ] **Step 5: Commit**

```bash
git add 'src/routes/api/enrollments/[id]/+server.ts' src/lib/server/entities.ts 'src/routes/api/students/[code]/activity/+server.ts' src/routes/app/dashboard/+page.svelte tests/characterization/move-student.test.mjs
git commit -F- <<'EOF'
A student's card shows their tutor and moves them to another; the next lesson names its tutor

Moving changes that enrollment only: lessons already booked keep their
tutor, and the next booking goes to the new one.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M83cAin9ny5QGUYH4Ydu6F
EOF
```

---

### Task 13: The booking page reloads the family's tutor's hours after TUTOR_BUSY

**Files:**
- Modify: `src/routes/booking/+page.svelte`: state near :55, `loadSlots` at :73, the 409 branch at :464, the slots step at :581-585
- Test: `tests/unit/booking-tutor-busy.test.mjs`

**Interfaces:**
- Consumes: the TUTOR_BUSY answer (Task 9) and `?tutor=` (Task 7).

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/booking-tutor-busy.test.mjs
//
// After TUTOR_BUSY the page keeps what the family typed, shows only their
// tutor's hours, and says why (spec D3). The rendered flow is checked in a
// browser before merge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../../src/routes/booking/+page.svelte', import.meta.url), 'utf8');

test("TUTOR_BUSY keeps the form, closes the sheet and reloads only their tutor's hours", () => {
  const at = page.indexOf("data.code === 'TUTOR_BUSY'");
  assert.ok(at > 0, 'the page knows the answer');
  const branch = page.slice(at, at + 700);
  assert.match(branch, /tutorFilter = data\.tutorId/);
  assert.match(branch, /closeSheet\(\)/);
  assert.match(branch, /loadSlots\(\)/);
  assert.doesNotMatch(branch, /(name|email|phone) = ''/, 'nothing they typed is cleared');
});

test('the hours ask for that tutor, and the page says whose they are', () => {
  assert.match(page, /&tutor=\$\{tutorFilter\}/);
  assert.match(page, /\{#if slotNotice\}/);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test tests/unit/booking-tutor-busy.test.mjs`
Expected: FAIL with `the page knows the answer` (indexOf is -1).

- [ ] **Step 3: Implement**

In `src/routes/booking/+page.svelte`:

1. Directly after `let openDay = $state(0);`, add:

```ts
  /* Set when /api/book answered TUTOR_BUSY: the family's tutor is busy at
     the hour they picked, though another tutor is not. A returning family
     stays with their tutor (spec D3), so from then on the hours shown are
     that tutor's alone, and the page says so. */
  let tutorFilter = $state<number | null>(null);
  let slotNotice = $state('');
```

2. In `loadSlots`, replace

```ts
      const res = await fetch(`/api/availability?duration=${selectedPlan!.minutes}`);
```

with

```ts
      const res = await fetch(`/api/availability?duration=${selectedPlan!.minutes}${tutorFilter ? `&tutor=${tutorFilter}` : ''}`);
```

3. In `submitBooking`, directly before `if (res.status === 409) {`, add the code below.
   - Keep `loadSlots()` within 300 characters of `res.status === 409`: `booking-honesty.test.mjs` checks the first 409 branch it finds.
   - Keep the comment above the `if`, so it does not count toward those 300 characters.

```ts
      /* TUTOR_BUSY: everything they typed stays, only the hour changes —
         back to the hours, which reload as their tutor's alone. */
      if (res.status === 409 && data.code === 'TUTOR_BUSY' && Number.isInteger(data.tutorId)) {
        tutorFilter = data.tutorId;
        closeSheet();
        loadSlots();
        slotNotice = data.error || 'השעה הזאת לא פנויה אצל המורה שלכם';
        submitting = false;
        return;
      }
```

4. In the slots step, directly after the `selected-plan-badge` div, add:

```svelte
      {#if slotNotice}
        <p class="slot-notice" role="status">{slotNotice}. אלה השעות הפנויות אצל המורה שלכם.</p>
      {/if}
```

5. Add to the page's `<style>`:

```css
  .slot-notice { border: 1.5px solid var(--border-strong); border-radius: 12px; padding: 10px 14px; margin: 10px 0; font-size: .9rem; line-height: 1.5; }
```

- [ ] **Step 4: Run it to see it pass, with the page's other source tests**

Run: `node --test tests/unit/booking-tutor-busy.test.mjs tests/unit/booking-honesty.test.mjs tests/unit/booking-page-honesty.test.mjs && npm run check 2>&1 | tail -3`
Expected: PASS, with no failures, and `svelte-check found 0 errors`.

- [ ] **Step 5: Commit**

```bash
git add src/routes/booking/+page.svelte tests/unit/booking-tutor-busy.test.mjs
git commit -F- <<'EOF'
After TUTOR_BUSY the booking page keeps the form and shows only the family's tutor's hours

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M83cAin9ny5QGUYH4Ydu6F
EOF
```

---

### Task 14: Docs, the whole suite, browser QA, and the PR

**Files:**
- Modify: `server/README.md`: the env block at :74-82, the calendar-reads paragraph at :90-95, `readBookings()` at :136
- Modify: `PRODUCT.md:258-259`

- [ ] **Step 1: Update the docs**

In `server/README.md`'s `.env` block, delete:
- the `CALENDAR_ICS_URLS=…` line;
- the four `AVAILABILITY_CALENDAR_IDS=…` lines;
- the `CALENDAR_ID=…` line.

Directly after the block's closing fence, add:

```markdown
Each tutor's lesson calendar, private iCal addresses and teaching hours are
not in `.env`. They live on the tutor's row (migration 029) and are set from
the dashboard's "מורים" card. A server upgraded from before that copies
`CALENDAR_ID` and `CALENDAR_ICS_URLS` onto the first tutor's row on its first
boot and logs `took over CALENDAR_ID and CALENDAR_ICS_URLS`; delete both lines
from `.env` after that, with a backup first.
```

Replace the paragraph that begins ``CALENDAR_ICS_URLS` is a comma/whitespace separated list`` (through `…recorded and surfaced separately.`) with:

```markdown
Each tutor's private iCal addresses (one per line on their "מורים" card) are
the read side only. Writing a booking into the calendar is a separate
mechanism (`GOOGLE_SERVICE_ACCOUNT_*` + that tutor's lesson calendar), and the
two are fully independent: availability can look healthy while an event
failed to be written, which is why write failures are recorded and surfaced
separately. A feed that fails is shown on the dashboard by tutor and position
(«היומן השני של ליאור»), never by address.
```

Replace ``That is the booking *write* path: `readBookings()` folds lessons booked`` with ``That is the booking *write* path: `readBookingsFor()` folds each tutor's lessons booked``.

In `PRODUCT.md`, replace

```markdown
- **Calendar** — two independent paths: an iCal feed for reading
  availability, a Google service account for writing booked events.
```

with

```markdown
- **Calendar** — per tutor, set on the dashboard's "מורים" card: private
  iCal feeds for reading their busy times, and their own lesson calendar,
  which a Google service account writes booked events into. Each booking
  records its tutor (`bookings_v2.teacher_id`).
```

- [ ] **Step 2: Run everything**

Run: `npm run build > /dev/null && node --test "tests/**/*.test.mjs" > /tmp/claude-1000/suite-final.log 2>&1; tail -12 /tmp/claude-1000/suite-final.log`
Expected: `# fail 0`.

Run: `npm run check 2>&1 | tail -3 && node scripts/check-warnings.mjs`
Expected: `svelte-check found 0 errors`, and the warnings check exits 0.

Run: `git grep -n -e CALENDAR_ICS_URLS -e AVAILABILITY_CALENDAR_IDS -e GOOGLE_API_KEY -e "process.env.CALENDAR_ID" -- src`
Expected: matches only in two places:
- `src/lib/server/tutor-settings.ts`: its comments and `adoptEnvCalendar` (`env.CALENDAR_ID`/`env.CALENDAR_ICS_URLS`);
- the takeover comment in `src/hooks.server.ts`.

There is no `process.env.CALENDAR_ID` anywhere.

- [ ] **Step 3: Browser QA against the built server, at 390px and 320px**

1. Start a local empty feed, then the built server with a fresh database. All of this runs on the local dev host; the values are test values.

```bash
QA=/tmp/claude-1000/qa-per-tutor; rm -rf $QA; mkdir -p $QA/portal
node -e "require('http').createServer((q,s)=>{s.writeHead(200,{'Content-Type':'text/calendar'});s.end('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n')}).listen(8799,'127.0.0.1')" &
PORT=4317 DB_PATH=$QA/results.db DATA_DIR=$QA PORTAL_DIR=$QA/portal ADMIN_PASSWORD=qa-password \
  SESSION_SECRET=qa-secret-not-real SITE_URL=http://127.0.0.1:4317 ORIGIN=http://127.0.0.1:4317 \
  PROTOCOL_HEADER=x-forwarded-proto CALENDAR_ID=qa-nikol@example.com \
  CALENDAR_ICS_URLS=http://127.0.0.1:8799/nikol.ics CODEX_BIN=/nonexistent node build/index.js &
```

2. Go through the flows with Playwright.
   - **New visitor:** on `/booking`, hours show with no "unconfirmed" warning. Book the first slot as a new family; the success screen shows.
   - **Card:** sign in at `/login` with `qa-password`, open `/app/dashboard`, and find "מורים".
     - Nikol shows `מקבל/ת הזמנות ✓`. Lior shows what is missing.
     - Open Lior's "הגדרות הזמנה". Set the calendar to `qa-lior@example.com`, the address to `https://127.0.0.1:1/lior.ics`, and Sunday 09:00–18:00. Save.
     - Lior now shows `מקבל/ת הזמנות ✓` and `כתובת אחת שמורה`. "החלפה" opens an empty box.
   - **Signed-in family:** the family from the first booking is signed in by that booking.
     - Open `/booking` again and pick the same slot for a second child. Expect the sheet to close, the notice `השעה הזאת לא פנויה אצל המורה שלכם. אלה השעות הפנויות אצל המורה שלכם.`, and that slot no longer listed.
     - Re-open a slot: the name, email and phone are still filled in.
   - **Student card:** the card header reads `מתמטיקה · ניקול`. In the profile tab, change "מורה" to ליאור; the toast says lessons already booked stay. The overview's next lesson still says `עם ניקול`.
   - **320px:** repeat the card and booking checks with no horizontal scroll and every button at least 44px tall.

3. Save screenshots of each check to the scratchpad and keep them for the PR description.

4. Stop the server and the feed by PID, per the QA-cleanup memory.

- [ ] **Step 4: Commit the docs, push, open the PR**

```bash
git add server/README.md PRODUCT.md
git commit -F- <<'EOF'
Docs: each tutor's calendar, busy addresses and hours live on the "מורים" card, not in .env

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M83cAin9ny5QGUYH4Ydu6F
EOF
git push -u origin feat/per-tutor-booking
gh pr create --base main --head feat/per-tutor-booking --title "Each lesson goes to its own tutor" --body-file /tmp/claude-1000/pr-per-tutor.md
```

The PR body (`/tmp/claude-1000/pr-per-tutor.md`) contains:
- what changes for families (nothing until Lior's row is filled in);
- the rulings R1–R6 above;
- the suite counts;
- the browser QA results with screenshots;
- the rollout: merge; check the boot log; back up and delete the two `.env` lines; then Lior's steps from the spec's "Rollout" 3–4;
- the attribution lines from Global Constraints for PRs.

---

### Task 15: Rollout, after review and merge

This is not code. It runs once the PR is approved. Merging deploys to production, under standing authorization: merge and watch the deploy.

- [ ] **Step 1: Merge, gated on CI**

Run: `gh pr checks <PR> --watch && gh pr merge <PR> --squash`
Then watch the post-merge run on `main` to the end: `gh run list --branch main --limit 1`, then `gh run watch <id>`.
Expected: build and deploy both succeed.

- [ ] **Step 2: Confirm Nikol's row took over `.env`, without printing a value**

Run: `ssh mea 'docker logs mea-beclick-app-1 2>&1 | grep -F "took over CALENDAR_ID"'`
Expected: one line naming ניקול.

Run the snippet below. It prints only whether each setting is present and how many feeds there are:

```bash
ssh mea 'docker exec -i mea-beclick-app-1 node --input-type=module -' <<'EOF'
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.env.DB_PATH, { readOnly: true });
for (const t of db.prepare('SELECT id, active, calendar_id, busy_ics FROM teachers ORDER BY id').all()) {
  console.log(JSON.stringify({ id: t.id, active: t.active, calendar: !!t.calendar_id, feeds: (t.busy_ics ?? '').split('\n').filter(Boolean).length }));
}
EOF
```

Expected:
- `{"id":1,"active":1,"calendar":true,"feeds":2}`
- `{"id":2,"active":1,"calendar":false,"feeds":0}`

- [ ] **Step 3: The booking page still offers hours**

Run: `curl -s 'https://meabeclick.com/api/availability?duration=45' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.slots.length, j.calendars, j.calendarFailures)})"`
Expected: a non-zero slot count, `2` calendars and `0` failures, matching the count from before the deploy.

- [ ] **Step 4: Back up `.env`, then delete the lines nothing reads any more**

Only after BOTH of these (final-review ruling, 2026-10-18):
- the calendar-robot move (#51) is done, because its script probes with the container's `CALENDAR_ID`;
- the deploy has run cleanly for a few days, because the previous image's boot check requires `CALENDAR_ID`, so a rollback without it would not boot.


```bash
ssh mea 'cd /home/meabeclick/mea-beclick && cp -p .env .env.bak-before-per-tutor-$(date +%F) \
  && sed -i "/^CALENDAR_ID=/d; /^CALENDAR_ICS_URLS=/d; /^AVAILABILITY_CALENDAR_IDS=/d; /^GOOGLE_API_KEY=/d" .env \
  && grep -cE "^(CALENDAR_ID|CALENDAR_ICS_URLS|AVAILABILITY_CALENDAR_IDS|GOOGLE_API_KEY)=" .env || true'
```

Expected: `0`. No restart is needed: the running app no longer reads them, and on the next start the row already has its values, so the takeover does not run again.

- [ ] **Step 5: Record it, and hand Lior his steps**

- Update the memory `calendar-setup.md`. Each tutor's lesson calendar and busy feeds now live on their `teachers` row, set from the "מורים" card. The `.env` lines are gone, with the backup named.
- Send Lior the spec's rollout steps 3–4:
  - rename "שיעורים - מאה בקליק" to "שיעורים - ניקול";
  - create "שיעורים - ליאור" and share it with the calendar robot ("Make changes to events") and with whoever sees the current calendar;
  - copy its private address and his personal calendar's private address into his row on the card.
- Watch for "מקבל הזמנות ✓", and confirm the next real booking lands where it should.
