# Payments on the entity model — design

**Date:** 2026-09-05
**Branch:** `feat/payments`
**Status:** awaiting review

Replaces the hand-maintained Markdown ledger with integer money in SQLite,
wires `bookings_v2` so a charge knows which lesson it belongs to, and gives
the tutor a way to record payment that is not editing a table by hand.

---

## 1. Why

### 1.1 The parent portal has never shown a balance

`src/lib/server/pricing.ts` reads `mea-beclick-kb/pricing/Summary.md` at
request time and parses its `## Overview` pipe table. `getBalance()` matches
on the student's **display name**.

The KB table's `Student` column is **Latin** (`Lior`); students in
`students_v2` carry **Hebrew** display names (`נוגה`). `normalize()` trims,
strips bold and collapses whitespace — it does not transliterate. So the
match never succeeds and `getBalance()` returns `null` on every call.

The parent board renders its balance behind `{#if CURRENT.balance}`, so the
section has silently rendered nothing in production for its entire life.
Verified 2026-09-04 by comparing the scripts of both sides against the real
data.

### 1.2 The replacement already exists, unwired

`src/lib/server/payments.ts` and the `payments` table (migration 001) are
built and covered by six unit tests: `amount_agorot INTEGER`, an `addPayment`
guard that **throws** rather than rounds on a non-integer, and
`balanceForAccount()` which already sums owed minus paid **across every child
on an account**. Nothing under `src/routes/` imports it.

This is the third time this repo has had a designed replacement sitting
unwired behind a legacy path (entities, bookings_v2, payments). This spec
retires the first of the two remaining.

### 1.3 A משולש lesson cannot be recorded

```sql
kind TEXT NOT NULL CHECK (kind IN ('single', 'double'))
```

Three plans are sold (45 / 90 / 135 minutes). An insert for the 135-minute
plan is rejected by the constraint.

### 1.4 A charge cannot point at its lesson

`payments.booking_id` references `bookings_v2`, which nothing writes.
`reserveBooking()` still writes the legacy `bookings` table, keyed by name
and phone, with no student on it.

---

## 2. Decisions

Settled with Lior on 2026-09-04/05. Recorded here because each one closes off
alternatives that would otherwise look reasonable to a later reader.

| # | Decision | Rejected alternative |
|---|---|---|
| D1 | **A confirmed booking creates the `owed` row automatically**, at the plan price. | Nikol records every charge by hand — the same manual burden as the Markdown, just with a nicer form. Also rejected: a `pending` state she confirms per lesson, which adds a decision she does not make today. |
| D2 | **The balance splits "due now" from "upcoming"**, derived by comparing the lesson date to today. No extra status and no extra work. | One combined number, which tells a parent they owe for a lesson that has not happened. Also rejected: creating the row only after the lesson, which needs a scheduled job and loses forward visibility. |
| D3 | **One row per lesson; status flips `owed` → `paid`.** | A double-entry ledger where a lump payment settles oldest-first. Correct for irregular transfers, but two concepts where one will do at this scale. |
| D4 | **Wire `bookings_v2` as part of this change.** | Leaving `booking_id` permanently NULL and voiding a cancelled lesson's charge by matching student + date — approximate, on money, and it keeps the schema advertising a link it never has. |

**D1 has a consequence that shapes the rest of this spec:** if a booking
creates a debt, a cancelled booking must destroy it. That is the whole reason
D4 is in scope.

---

## 3. Migration 003

### 3.1 Rebuilding `payments`

SQLite cannot alter a CHECK constraint in place, so the table is rebuilt:

```sql
CREATE TABLE payments_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id    INTEGER NOT NULL REFERENCES accounts(id),
  student_id    INTEGER NOT NULL REFERENCES students_v2(id),
  booking_id    INTEGER REFERENCES bookings_v2(id),
  date          TEXT    NOT NULL,
  kind          TEXT    NOT NULL CHECK (kind IN ('single', 'double', 'triple')),
  amount_agorot INTEGER NOT NULL,
  status        TEXT    NOT NULL CHECK (status IN ('owed', 'paid', 'void')),
  note          TEXT
);

INSERT INTO payments_new
  SELECT id, account_id, student_id, booking_id, date, kind, amount_agorot, status, note
  FROM payments;

DROP TABLE payments;
ALTER TABLE payments_new RENAME TO payments;

CREATE INDEX idx_payments_account ON payments(account_id);
CREATE INDEX idx_payments_student ON payments(student_id, date DESC);
```

Columns are listed explicitly in the INSERT rather than `SELECT *`, so a
future column added to one table and not the other fails loudly instead of
shifting values into the wrong columns.

**Foreign keys during the rebuild.** SQLite's documented table-rebuild
procedure turns `foreign_keys` off first, and `PRAGMA foreign_keys` is a
no-op inside a transaction — which is where the migration runner puts it. It
is safe here for one specific reason: **nothing references `payments`**, so
dropping it breaks no child rows. The migration must not be copied as a
template for rebuilding a table that *is* referenced. A test asserts the FKs
still bite afterwards (§8).

### 3.2 No `bookings` backfill

Legacy `bookings` rows are **not** migrated into `bookings_v2`. They carry a
name and a phone, not a student, so matching them would mean name-matching —
the exact linkage this whole line of work exists to remove — applied to rows
that will carry money.

Instead the overlap check and `readBookings()` read **both** tables (§4.3).
New bookings go to `bookings_v2`; legacy rows keep blocking their slots and
age out. Nothing is invented and no history is lost.

---

## 4. Booking writes `bookings_v2` and a charge

### 4.1 The ordering problem

`bookings_v2.student_id` is `NOT NULL`, but today the handler reserves the
slot **before** enrolling, so no student exists yet:

```
reserveBooking(body)   ← synchronous, decides the race
await book(body)       ← enrollment happens in here
```

The reservation is first on purpose: it is what stops two parents taking the
same hour, and it must be decided before any `await`.

### 4.2 The fix: enroll, then reserve — both still synchronous

`enrollFromBooking()` contains no `async`, `await` or `Promise` (verified
2026-09-04); it uses the synchronous `node:sqlite` and `fs` APIs throughout.
So the order can become:

```
enrollFromBooking(body)   ← synchronous
reserveBooking({ ...body, studentId, enrollmentId })   ← synchronous
await book(body)          ← async work starts only now
```

The race property is preserved exactly: both steps complete before the event
loop yields, so two concurrent requests still cannot both win the hour.

**The cost, stated plainly:** a request that loses the race now creates the
account and student before returning 409. This is benign because enrollment
is idempotent by construction — the same email resolves to the same account
and the same name to the same student — so the family's retry reuses the
record rather than duplicating it. A student who never books is
indistinguishable from one whose first booking failed, and the tutor can
delete either.

### 4.3 The overlap check reads both tables

```sql
SELECT 1 FROM (
  SELECT start, "end", status FROM bookings
  UNION ALL
  SELECT start, "end", status FROM bookings_v2
) WHERE status = 'confirmed' AND "end" > ? AND start < ?
LIMIT 1
```

`readBookings(fromIso, toIso)` gets the same treatment, so availability keeps
seeing legacy lessons. Both unions carry a comment saying they exist only
until the legacy table holds no future rows, and how to check that.

### 4.4 Creating the charge

After a successful reservation:

```ts
addPayment({
  accountId:    account.id,
  studentId:    student.id,
  bookingId,
  date:         lessonDate,        // YYYY-MM-DD, the lesson's own date
  kind:         kindFor(durationMin),   // 45→single, 90→double, 135→triple
  amountAgorot: agorot(plan.shekels),   // from src/lib/plans.ts
  status:       'owed',
});
```

The amount comes from `PLANS` — the same source the form, the confirmation
email and the success summary already read, so a price change cannot make
them disagree.

Two rules inherited from how booking already behaves:

- **A failed charge must never lose the booking.** Wrapped in try/catch and
  logged, exactly as enrollment already is. A booking that exists without a
  charge is a bookkeeping gap the tutor can fix; a lost booking is a family
  who thinks they have a lesson and does not.
- **Releasing the hour voids the charge.** The existing path that calls
  `cancelBooking(bookingId)` when the calendar/email step fails downstream
  also sets the charge to `void`.

### 4.5 `kindFor` lives in `plans.ts`

`plans.ts` gains `kind: 'single' | 'double' | 'triple'` on each `Plan`, so
the mapping is data rather than a switch that can drift from the ladder.

---

## 5. Due versus upcoming

`balanceForAccount(accountId, asOf)` gains a second argument and returns two
extra fields, `dueAgorot` and `upcomingAgorot`. It also **loses**
`balanceAgorot` — see the amendment below the field list:

```ts
{
  owedAgorot,      // every 'owed' row, given or not
  paidAgorot,
  dueAgorot,       // 'owed' AND date <= asOf
  upcomingAgorot,  // 'owed' AND date >  asOf
}
```

**Amended 2026-09-05, after the final review.** This section originally kept
`balanceAgorot` (owed − paid) as an unchanged carry-over. That was wrong under
D3: because a lesson is one row whose status *flips*, a paid row leaves the
`owed` sum and enters the `paid` sum, so the difference goes negative rather
than to zero. The parent view rendered it, and a family with one paid ₪215
lesson read `יתרה לתשלום −₪215` in red, subtitled "awaiting payment" — the
exact defect §1.1 exists to remove. The field has no correct consumer under
this model and its name invites the mistake, so it is deleted rather than
fixed. What a family owes is `dueAgorot`.

`void` rows are excluded from every figure.

`asOf` is a `YYYY-MM-DD` string computed in **`Asia/Jerusalem`**, not from
the server's local clock or UTC. `date` is stored in the same form, so the
comparison is a plain string comparison and a lesson dated *today* counts as
due. The caller supplies `asOf` rather than the function reading the clock,
so the boundary is testable without freezing time.

---

## 6. What each side sees

### 6.1 Parent

`GET /api/portal/:code?kind=parent` stops calling `getBalance(name)` and
returns:

```jsonc
"balance": { "dueAgorot": 21500, "upcomingAgorot": 43000, "paidAgorot": 64500 },
"charges": [ { "date": "2026-08-12", "kind": "double", "amountAgorot": 21500, "status": "paid" } ]
```

`balance` is the **account's** — the family total, which is what
`balanceForAccount` has always computed. `charges` are the selected child's,
so a parent can see which lessons a figure is made of.

The board renders three figures — `לתשלום עכשיו`, `מתוכנן קדימה`,
`שולם עד כה` — and the itemised list beneath. `plans.ts` gains
`formatAgorot()` so money is formatted in one place; it prints whole shekels
as `₪215` and only shows agorot when they are non-zero.

A student session still cannot reach `kind=parent` at all, so none of this is
visible to a child.

### 6.2 Tutor

Two endpoints behind her session:

- `GET /api/payments?student=<code>` — that student's charges, newest first.
- `POST /api/payments/mark` — `{ ids: number[], status: 'paid' | 'owed' | 'void' }`.
  Every id is checked to exist before any row is written, so a partially
  applied batch is impossible.

A new `תשלומים` panel, beside `כניסה לפורטל` and reading the **real
roster** — not `data.students`, the localStorage CRM the same page also
renders (see §6.3). Per student: open charges with checkboxes,
`סימון כשולם`, and a void action. Marking paid is reversible (back to
`owed`), because the common error is ticking the wrong row.

### 6.3 The tutor's headline figures are localStorage today

`src/routes/app/dashboard/+page.svelte:474` renders
`₪{totalPaidAll} מתוך ₪{totalOwedAll} סה"כ`, and both are `$derived` from
`data.students` — the local-only fake CRM in
`localStorage["tutor_dashboard_v2"]`, which the page's own header comment
describes as "synced to nothing". So the tutor's headline money figure differs
per device and disappears when she clears her browser.

This is the same defect as §1.1 wearing different clothes, and it is in scope
for one reason: shipping real charges in a panel while the header of the same
page shows a browser-local number is worse than either problem alone, because
the two will visibly disagree.

`payments.ts` gains `balanceAllAccounts(asOf)` — the same query as
`balanceForAccount` without the account filter — and the three tiles read
from it. The localStorage CRM is left otherwise untouched: retiring it is its
own change and is not attempted here.

---

## 7. Retiring the Markdown path

1. Delete `src/lib/server/pricing.ts` and its import in the portal route.
   It has no unit tests of its own (checked 2026-09-05), so nothing is lost
   by deleting it outright; its table parser is reused by the import script
   in step 3 and then goes with it.
2. Remove the `./mea-beclick-kb/pricing:/app/mea-beclick-kb/pricing:ro` bind
   mount from `docker-compose.yml` — it exists solely for this read.
   `KB_PRICING_PATH` is not in `.env.example` and needs no change there.
3. **Import the existing ledger** with a one-off `scripts/import-ledger.mjs`.
   It parses `Summary.md`, proposes a Latin-name → student-code mapping, and
   **prints it without writing**. It writes only with `--commit`, and only
   after Lior has approved the mapping. The KB names are Latin and the
   students are Hebrew: this attribution is a human decision about real
   money, not something a migration should guess. The current ledger is
   roughly two rows.
4. `Summary.md` stays in the vault as history. It stops being code.

`mea-beclick-kb/notes/PRD.md` §2.6 and `Architecture Overview` both describe
the Markdown table as the payment source of truth and must be updated.

---

## 8. Testing

**Unit**

- `kindFor` maps 45/90/135 to single/double/triple, and rejects anything else.
- The due/upcoming boundary: a lesson dated exactly `asOf` is **due**, one
  dated `asOf + 1` is **upcoming**.
- `void` rows are excluded from due, upcoming, paid and balance.
- The existing integer guard still throws (regression on the rebuilt table).
- Migration 003: a `triple` / `void` row inserts successfully; a bogus `kind`
  and a bogus `status` are both still rejected; a payment referencing a
  nonexistent account is still rejected (proves the FKs survived the rebuild);
  existing rows survive with their values intact.

**Characterization** (against the built server)

- A booking creates exactly one `owed` charge, at the plan's price in agorot,
  linked to the booking.
- Two concurrent bookings of one hour still produce exactly one winner, and
  exactly one charge — the existing race tests must pass unchanged, now
  against the union query and the new ordering.
- A booking whose downstream step fails leaves its charge `void`, not `owed`.
- A parent reads their own family's balance; another family's returns 401.
- A student session gets 401 on `kind=parent` and on both payment endpoints.
- Availability still refuses a slot held by a **legacy** `bookings` row
  (proves the union works).
- `balanceAllAccounts` equals the sum of every account's `balanceForAccount`,
  so the tutor's headline figure and the parents' figures cannot disagree.

---

## 9. Out of scope

- **Automated collection** (Bit / PayBox) — evaluated and rejected 2026-08-23;
  nothing here changes that. This stores a ledger, it does not take money.
- Lump-sum payments that settle several lessons (D3).
- Invoices, receipts, or anything a tax authority would recognise.
- Repairing `getBalance` — it is deleted, not fixed.
- The parent-facing multi-child dashboard and the accelerated returning-family
  booking flow. Both were designed on 2026-09-04 and deliberately sequenced
  **after** this, because they render balance data that does not exist yet.

---

## 10. Risks

| Risk | Handling |
|---|---|
| The table rebuild runs with `foreign_keys` on, against SQLite's documented procedure. | Safe only because nothing references `payments`; asserted by a test, and the constraint is written into §3.1 so the pattern is not copied. |
| Reordering enroll/reserve creates a student for a booking that loses the race. | Benign: enrollment is idempotent, so the retry reuses the record. Stated in §4.2 rather than discovered later. |
| The union query is a transitional shape that could become permanent. | Commented at both call sites with the condition for removing it. |
| Importing the ledger attributes real money by matching a Latin name to a Hebrew one. | Never automatic. The script proposes, a human approves, `--commit` writes. |
| The dashboard shows real charges and a localStorage headline at the same time. | §6.3 moves the headline onto the same query; a test asserts the two agree. |
| A price change in `plans.ts` does not alter charges already written. | Correct and intended — a past lesson keeps the price it was sold at. Noted so it is not "fixed" later. |
