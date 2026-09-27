# Design — Real entities and relationships (teacher / account / student)

Status: awaiting review, then implementation plan
Origin: the backend-architecture question raised after the SvelteKit cutover —
whether teacher/student/parent linkage and tracking was ever done properly, or
was deliberately left alone by the migration.

It was deliberately left alone. The migration's own ledger records the schema
as out of scope; `src/lib/server/db.ts` is a faithful port of the deleted
`server/db.mjs`, tables and all.

## 1. Context

The model cannot express the sentence the business runs on: *this lesson
belongs to this student, taught by this teacher, and this person is
responsible for paying for it.*

Five tables, zero `FOREIGN KEY` constraints. The only primary key is
`students.code`, and it is joined to nothing. Every real relationship in the
system is a Hebrew display-name string:

```
students.code    = "noga"                 <- the PK, referenced by nothing
lessons.student  = booking.name           = "ניקול ניסימוב"   queue.ts:77
results.student  = the ?s= query param    = "נוגה"            portal/[code]:48
bookings.name    = a free-text form field = "ניקול ניסימוב"
```

This is not a future scale problem. Every claim below was verified against
the live production database and the running code, and each one is a defect
present today.

### 1.1 The collision has already happened

Three students exist. One of them only exists under its current key because
`makeCode` (`enroll.ts:41-47`) found the name taken and appended a digit:

```
noga    נוגה
nikol   ניקול
nikol2  ניקול ניסימוב     <- disambiguated by suffix, not by identity
```

All three carry the phone `0546969891`, which is also the tutor's own number,
hardcoded in seven source files. The rationale recorded at `db.ts:174-179` —
that a phone identifies a returning booker — is already false in the data.

### 1.2 The primary key joins to nothing

`students.code` is immutable: only `password` is ever updated (`db.ts:467`,
`db.ts:483`), and no rename path exists. Meanwhile every other table keys on
the display name, **including the HMAC**. `gameUrl` signs over
`{dataId, student}` where `student` is the Hebrew name (`urls.ts`,
`portal/[code]:48`). A rename would not merely orphan history; it would 403
every homework link already sent to a family.

### 1.3 The parent/student boundary is client-side only

`checkPin`'s second argument is named `_kind` and is ignored. Its own comment
states it (`db.ts:486-489`):

> One password unlocks both the student and parent portal views — `kind`
> no longer selects a different secret.

So `students.student_pin` and `students.parent_pin` are dead columns: written
at enrollment, read by nothing. `kind=parent` is a query parameter the client
sets for itself, so any student holding their own link can open
`/app/parent?s=<their code>` and get the parent view.

Nothing has leaked, because of 1.4. Moving payments into the database removes
the accident that was protecting it.

### 1.4 The parent portal's Payments section has never rendered

`getBalance(data.name)` (`portal/[code]:98`) passes `"נוגה"` into a table
whose Student column reads `Lior` (`mea-beclick-kb/pricing/Summary.md`).
String compare, no match, silent `null`. A fifth name-string join, failing
silently in production since it shipped.

### 1.5 Homework completion is write-only

`done` is read in five places across the student and parent pages and written
in none. `appendToPortal` sets `done: false` (`queue.ts:223`); nothing flips
it. The two `true` values in `portal/noga.json` were typed by hand.

The system already knows the work was done — `results` records the play,
matched by the identical `data_id` — and never joins the two. A finished
assignment shows `📝 פתוח` forever.

### 1.6 A student already has two subjects

`students.subject` is one column. Booking 7 is `ניקול ניסימוב · מתמטיקה` and
booking 11 is `ניקול ניסימוב · עברית`. For that student the column holds `""`.

### 1.7 Not every student is paid for by a parent

`mea-beclick-kb/pricing/Lior.md` bills a student directly. A `parents` table
would therefore leave adult self-paying students with no row, forcing a
second code path through balance, login and billing — the same mismodelling
reproduced one level up. The responsible party is an **account**, not a
parent.

### 1.8 Generated lessons are unreachable

`queue.ts:271` slugifies with `\p{L}`, which passes Hebrew through, producing
slugs like `בדיקת-מערכת-אינטגרציה-בהצבה-m8x2k`. `lessonUrl` then calls
`assertPathSegment(/^[a-z0-9-]+$/)`, which throws. Every generated lesson
404s.

## 2. Scope

**In:** entity model, relationships, keys, the store consolidation, payments,
a versioned migration runner, and the defects above that the model itself
causes.

**Out, deliberately:**

- **Per-teacher authentication.** `teachers` is seeded with one row and
  nothing authenticates against it. Onboarding a second working tutor is a
  later auth change plus a data change, not a migration.
- **Rate limiting on portal credentials.** Still the repo's most concrete
  safety gap — a four-digit `Math.random()` PIN with no throttling anywhere
  — and still a separate change.
- **`mea-beclick-kb/students/`.** The tutor's Obsidian vault is hers; the
  application does not read it and will not start.
- **No ORM, no leaving SQLite, no repository or service layers.** The
  simplicity is load-bearing: `node:sqlite` running in-process in a single
  Node process is precisely what the lesson queue's rate limiter and the
  booking race defense depend on (`db.ts:336-342`).

## 3. Schema

```sql
teachers     id, name, phone, active

accounts     id, name, phone, credential, is_self, created_at

students     id, code UNIQUE, name, emoji, account_id -> accounts NOT NULL,
             progress, progress_note, credential, created_at

enrollments  id, student_id -> students, subject, level,
             teacher_id -> teachers
             UNIQUE (student_id, subject)

bookings     id, student_id -> students NOT NULL,
             enrollment_id -> enrollments,
             start, end, duration, at, status

lessons      id, student_id -> students, enrollment_id -> enrollments,
             teacher_id -> teachers, slug UNIQUE, topic, title, context,
             summary, status, problem, slides_path, lesson_at, created_at

homework     id, lesson_id -> lessons, student_id -> students,
             task, template, data_id, assigned_at, due_at, done_manual

results      id, student_id -> students NOT NULL, data_id, template,
             score, total, tries, stars, seconds, missed, at

payments     id, account_id -> accounts, student_id -> students,
             booking_id -> bookings NULL,
             date, kind, amount_agorot, status, note

calendar_failures  id, booking_id -> bookings, message, at, resolved
```

`PRAGMA foreign_keys = ON` at connection open — SQLite does not enforce
foreign keys by default, so declaring them without this changes nothing.

### 3.1 Why an account rather than a parent

One account is one billing contact and one login. A family is one account
with two students; an adult paying for themselves is one account with one
student, flagged `is_self`. Every student has exactly one account, always, so
balance, login and "who do we message" each have a single code path with no
self-payer special case (§1.7).

### 3.2 Why a surrogate student key

`students.code` becomes a mutable `UNIQUE` slug rather than the primary key.
The repo's most concrete safety gap is a four-digit PIN guarding a code that
*is* the child's transliterated first name. The one clean fix is an
unguessable portal link, which means changing the code — one row's `UPDATE`
against a surrogate key, versus a cascading rewrite across five tables and
every issued signature against a natural one.

### 3.3 Why teacher lives on the enrollment

Two tutors may split one child by subject (§1.6, and the venture already has
two tutors). `enrollments.teacher_id` is the current assignment;
`lessons.teacher_id` is the historical fact of who actually taught it.
Reassigning a student must not rewrite the history of lessons someone else
gave — the preservation of that distinction is the point of the exercise, is
free now, and is unreconstructable later.

### 3.4 Money

`amount_agorot INTEGER`, never a float. `kind` is `single | double`,
`status` is `owed | paid`. Balance is `SUM(owed) - SUM(paid)` over the
account. `booking_id` is nullable so a session booked through the site can
pre-fill its own payment row, while a manually recorded lesson needs no
booking to exist.

### 3.5 Credentials

`accounts.credential` and `students.credential` keep the existing
plaintext-by-design tradeoff, made explicitly rather than inherited: the
tutor reads a forgotten password back to a parent over the phone. This is
unchanged from `db.ts`'s current behaviour and is deliberately not improved
here — see the rate-limiting exclusion in §2.

## 4. What is deleted

| Removed | Why |
|---|---|
| `students.student_pin`, `students.parent_pin` | Dead columns (§1.3) |
| `students.subject`, `students.level` | Wrong for live data; moves to `enrollments` (§1.6) |
| `portal/*.json`, `PORTAL_DIR`, `paths.ts`'s `portalDir()` | Absorbed into the schema; ends the dual source of truth |
| the portal `games[]` array | Duplicates `homework`'s own `template`+`data_id`, item for item |
| `src/lib/server/pricing.ts` | Payments are rows; the Markdown parser goes with it |
| the `mea-beclick-kb/pricing` bind mount | No longer read by the application |
| `bookings.name/subject/level/phone` | Reachable via `student_id` and `enrollment_id` |
| `try { ALTER TABLE } catch {}` (`db.ts:172`, `db.ts:180`) | Replaced by the migration runner (§6) |

### 4.1 A note on PII placement

`docker-compose.yml:59-64` carries an explicit warning against merging the
tutor's payment-record vault into the application's data volume. This design
reaches a different end state than that warning anticipated: the bind mount
is **removed entirely**, and payment records live as rows in `results.db` —
one store, inside the volume the backup timer already covers. Net effect is
consolidation rather than duplication, but the separation stops being
enforced by the deployment, so it must be stated in `server/README.md` as a
property of backups instead.

## 5. Consequences that fall out of the model

- **`done` becomes real.** `done_manual OR EXISTS(SELECT 1 FROM results
  WHERE student_id = ? AND data_id = homework.data_id)`. `done_manual` covers
  non-game homework, which has no `data_id` to derive from. Fixes §1.5.
- **The payments disclosure closes structurally.** The account credential
  unlocks the account view — every child on the account, plus balance. The
  student credential unlocks only that student's page. `kind` stops being
  client-supplied. Fixes §1.3.
- **The signature stabilises.** `gameUrl` signs `{data_id, student_id}`
  rather than the Hebrew display name, so a rename no longer invalidates
  links already sent. Fixes §1.2.
- **Booking becomes atomic.** The overlap check, account, student, enrollment
  and booking insert run in one synchronous SQLite transaction. This is only
  possible because folding the portal into the database means enrollment no
  longer touches the filesystem. An enrollment failure now rolls the
  reservation back instead of relying on today's explicit `cancelBooking`
  call, and `bookings.student_id` can be `NOT NULL`.
- **Generated lessons become reachable.** `slug` is a random base32 token,
  so it cannot fail `assertPathSegment` by construction — the bug becomes
  unrepresentable rather than fixed. It also stops an unauthenticated lesson
  URL being guessable from a child's name. Fixes §1.8.
- **The tutor leaves the source.** Name and phone are read from `teachers`
  via the enrollment, not from seven hardcoded literals
  (`Header.svelte:51-52`, `enroll.ts:104-105`, `queue.ts:247`,
  `booking/+page.svelte:5-7`, `portal/+page.svelte:74`,
  `app/student/+page.svelte:61,296`, `remind/+server.ts:15`). Marketing copy
  on the homepage stays hardcoded — it is copy, not data.
- **Derived rather than stored:** `nextLesson` from bookings, `updated` from
  the newest lesson, balance from payments.

## 6. Migration and cutover

The new schema ships as `001_entities.sql` under a versioned runner — a
`schema_version` table, numbered files, each applied inside a transaction at
boot, refusing to start rather than running half a migration. Against an
empty database `001` simply creates everything.

Today's data arrives as a curated seed rather than a transform, because only
two records are real:

- **נוגה** — student, account, enrollment, and her portal history: three
  lesson summaries, four homework items, progress 72.
- **Lior** — account (`is_self`), student, enrollment, and one ₪100 payment
  dated 2026-04-07.

Everything else is test data and is not carried over: the `שיעור לדוגמה`
booking, both `ניקול` student rows, and the three remaining bookings, all of
which carry the tutor's own phone.

The seed is a checked-in SQL file (`seed/001_real_records.sql`) rather than a
script, so the exact rows entering production are reviewable in the diff.

### 6.1 The cutover is destructive and irreversible

Production's `results.db` is **not** empty — it holds three students, four
bookings and the live `portal/noga.json`. A curated seed does not merge with
that; it replaces it. The old database is discarded, along with the two
`ניקול` students and the four bookings, by decision rather than by accident.

This is the same shape as the failure found in the last cutover, where the
natural recovery step would have overwritten a real child's live record with
an older snapshot. It is safe here only because the discarding is deliberate
and enumerated above. The plan must therefore:

1. Take a timestamped copy of `results.db` **and** `portal/noga.json` off the
   box before anything runs, and verify the copy is readable.
2. Rehearse the seed against that copy locally, diffing the resulting rows
   against the enumerated list, before touching the live box.
3. Stop the container before replacing the database — `node:sqlite` holds an
   open handle, and swapping the file underneath a running process leaves it
   reading a deleted inode.
4. Keep the pre-cutover copy until נוגה's portal has been loaded and visually
   confirmed against the values in §6.

The pre-existing `portal/noga.json` is git-tracked *and* live-written, so the
copy in step 1 must come from the VPS, never from the repository.

## 7. Testing

The 79 existing tests stay green except where an API shape changes
deliberately; those changes are recorded in
`tests/characterization/expected-changes.mjs`, the same discipline the
SvelteKit migration used.

New coverage targets what was previously unrepresentable:

- two students on one account are isolated from each other's results
- renaming a student preserves their lessons, homework and results
- a student credential is refused at the account view
- `done` derives from a matching result
- the booking transaction rolls back cleanly on an enrollment failure
- a rotated `code` does not invalidate previously issued game links
