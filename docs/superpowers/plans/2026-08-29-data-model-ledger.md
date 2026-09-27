# SDD ledger — plan: docs/superpowers/plans/2026-08-29-data-model.md

Spec: docs/superpowers/specs/2026-08-29-data-model-design.md (read, reachable)
Branch: feat/data-model
Scope: Phase 1 only (Tasks 1-5). Phases 2-3 are scope notes, not tasks.

## Pre-flight conflict scan

### Cross-task: shared files and interfaces

| Tasks | Produces / Consumes | Finding |
|---|---|---|
| T1 → T2 | T1 adds `migrate()` call inside `singleton('db',...)`; T2 adds `export function handle()` to the same file, just after it | Clean. Sequential edits to non-overlapping regions of `db.ts`. |
| T2 → T3 | T2 creates `entities.ts` with `handle` import + teachers/accounts; T3 appends students/enrollments | Clean. T3 is append-only; no redefinition. |
| T2 → T4/T5 | `handle()` from `db.ts` consumed by `lessons.ts`, `results.ts`, `payments.ts` | Clean. Import chain entities/lessons/results/payments → db → migrations. No cycle. |
| T3 → T4 | T4 test consumes `E.createAccount`, `E.createStudent` | Clean. |
| T3 → T5 | T5 test consumes `E.createAccount`, `E.createStudent` | Clean. |
| **T4 → T5** | **T4's test imports `../../src/lib/server/results.ts`, which T5 creates** | **CONFLICT — backwards dependency. T4 would end on a red test and a commit, which its own review would fail.** |
| T4 → T4 | `homeworkForStudent` SQL reads `results_v2`; `writeResult` (T5) is the only writer | Same conflict, same root: derived completion cannot be tested without a result writer. |
| T1 → T3/T4/T5 | `PRAGMA foreign_keys = ON` set in T1; FK-violation tests in T3 and T5 depend on it | Clean, but note: if T1 Step 5 is skipped the FK tests silently pass-by-not-throwing. Both tests assert `throws`, so they fail loudly instead. Verified correct. |

### Per-task: internal self-consistency

| Task | Check | Finding |
|---|---|---|
| T1 | Test 3 pre-creates `teachers`, expects throw + no version row. `pending()` creates `schema_version` outside the transaction, so the table exists but stays empty after ROLLBACK | Consistent — assertion handles both branches. |
| T1 | `DatabaseSync` already imported in `db.ts`; `NUMBERED` regex matches `001_entities.sql` → 1 | Consistent. |
| T2 | Step 3 writes `import { handle } from './db.ts'` before Step 4 creates it | Consistent — steps are sequential, first test run is Step 5. |
| T3 | `upsertEnrollment` uses `ON CONFLICT (student_id, subject)`, which requires the UNIQUE constraint declared in T1's schema | Consistent. |
| T3 | FK test expects `/FOREIGN KEY/i`; node:sqlite raises "FOREIGN KEY constraint failed" | Consistent. |
| T4 | `finishLesson` COALESCEs every optional field, so a status-only update cannot blank a title | Consistent. |
| T4 | `newLessonSlug` uses `b % 30` over a 256-value byte — slight modulo bias | Not a defect at this size: 10 chars over a 30-char alphabet is ~49 bits even with bias. Noted, not ruled on. |
| T5 | FK test passes a valid `studentId` with `accountId: 99999`, so the violation is unambiguously on `account_id` | Consistent. |
| All | Money is INTEGER agorot throughout; no float arithmetic in any task | Consistent with Global Constraints. |

### Rulings

Ruling: Fold `results.ts` (writeResult, getBest, resultsForStudent) out of Task 5
and into Task 4 — Task 4's own tests for derived homework completion require a
result writer, so as written Task 4 ends red and its review would fail. Task 5
becomes payments-only. Why: each task must end with an independently testable
deliverable, and `results` is the table `homeworkForStudent` derives from, so
they belong to one reviewable unit. Cost if wrong: Task 4 grows to three files
(~150 lines) and one review covers both accessors instead of two reviews; no
behavioural difference, and Phase 2 is unaffected.

## Progress
Task 1: implementer DONE_WITH_CONCERNS, commit 149ed87. 82/82 tests pass, but
deviated: dropped the new students table and made every student_id a bare TEXT
column with NO REFERENCES clause.

Ruling: The deviation is rejected; the collision it worked around is real and is
my plan defect. `CREATE TABLE students` in 001_entities.sql collides with the
CREATE TABLE IF NOT EXISTS students still in db.ts, and the collision is fatal
(migrate creates the new shape, the old CREATE IF NOT EXISTS no-ops, then
`UPDATE students SET password = student_pin` throws on the missing column).
The plan already solves this for every other colliding table with a _v2 suffix
and I omitted it for students alone. Fix: students_v2 with INTEGER surrogate PK,
and every student_id becomes INTEGER NOT NULL REFERENCES students_v2(id).
Why: TEXT student_id with no FK reproduces the exact defect spec §1.2 and §3.2
exist to remove — the surrogate key is the single load-bearing decision of the
design (Q2). Cost if wrong: one extra rename in Phase 2's drop-and-rename step.
Task 1: fix round 1/5 (1 addressed, 0 open — students_v2 surrogate PK restored,
all six student_id columns now INTEGER NOT NULL REFERENCES students_v2(id);
commits 149ed87..a9bd02f). Verified independently by reading the SQL, not by
trusting the report: the previous report was confidently wrong, and 82/82 green
proved only that the change was invisible to consumers that do not exist yet.
Task 1: task review dispatched (sonnet) over bd7a914..a9bd02f.
Task 1: review verdicts — spec COMPLIANCE, quality APPROVED with 1 Important.
Task 1: minor (deferred): PRAGMA foreign_keys is set only on db.ts's singleton
connection; migrations.test.mjs opens raw DatabaseSync handles without it. Not a
defect here (Task 1 tests no FK behaviour) but any future FK test must go
through db.ts rather than a raw handle.
Ruling: Accept the Important finding against my own plan text. The plan's
rollback test collides on `teachers`, the FIRST CREATE TABLE in 001, so nothing
has succeeded when it fails and the assertion holds even with BEGIN/COMMIT/
ROLLBACK deleted from migrate() entirely — a test that cannot fail. Replaced
with a collision on `payments` (near the end of 001) asserting that teachers,
accounts and students_v2 are all absent after rollback, plus a required
demonstration that the test fails when ROLLBACK is commented out. Why: the
whole reason the spec chose a versioned runner over try{ALTER TABLE}catch{} is
that a half-applied schema must be impossible; shipping that guarantee
unverified is shipping the thing the runner exists to prevent. Cost if wrong:
one extra test round on Task 1; no production impact.
Task 1: fix round 2/5 (1 addressed, 0 open — rollback test now collides on a
late table and asserts three earlier tables are absent; implementer demonstrated
it FAILS with ROLLBACK commented out and PASSES restored; commits a9bd02f..9b89e67).
Task 1: complete (commits bd7a914..9b89e67, review clean). 82/82 verified by the
controller running npm test directly, not from the report.
Task 2: implementer DONE, commit c08861d. 86/86 verified by controller running
npm test directly. Task review dispatched (sonnet) over 9b89e67..c08861d.
Task 2: review verdicts — spec COMPLIANCE, quality APPROVED with 1 Important.
Task 2: minor (deferred): Number(info.lastInsertRowid)! non-null assertion after
insert — safe in practice, unenforced by the type checker. Same pattern recurs in
createAccount and will recur in Task 3's createStudent.
Ruling: Accept the Important finding. defaultTeacher()'s `active = 1` filter is
untested — createTeacher hard-codes active:1 and nothing can deactivate a
teacher, so deleting the clause would keep every test green. Fixed by driving
the column directly through the shared handle() in the test, NOT by adding a
setTeacherActive() accessor: the plan has no caller for one, and exporting an
API nobody calls to satisfy a test is scope creep. Why: defaultTeacher is what
every lesson and enrollment will attribute to a tutor once Phase 2 lands, so an
untested branch here silently mis-attributes work the moment a second teacher
is seeded. Cost if wrong: one extra test, no production surface.
Task 2: fix round 1/5 (1 addressed, 0 open — active filter now tested via the
shared handle, demonstrated to fail with the clause removed; commits c08861d..da1b62d).
Task 2: complete (commits 9b89e67..da1b62d, review clean). 87/87 verified by controller.
Task 3: implementer DONE, commit e4040d8. 93/93 verified by controller.
Task review dispatched (sonnet) over da1b62d..e4040d8.
Task 3: complete (commits da1b62d..e4040d8, review clean, no findings). 93/93.
Reviewer independently confirmed the surrogate key is intact in the schema and
that no query targets the legacy `students` table.
Task 4: implementer DONE, commit 77679d6. 98/98 verified by controller.
Task review dispatched (sonnet) over e4040d8..77679d6.
Task 4: review verdicts — spec COMPLIANCE, quality APPROVED with 1 Important.
Task 4: minor (deferred): newLessonSlug's `byte % 30` carries trivial modulo
bias (256 is not a multiple of 30). Harmless for a 10-char slug (~49 bits) and
no correctness impact; noted so the final review can triage.
Ruling: finishLesson assigning `problem` directly while COALESCE-ing the other
optional fields is DELIBERATE and stays. `problem` is a current-state field
recording why a lesson was held or failed, so a later successful finish must
clear it; COALESCE would render a stale Hebrew failure message beside working
slides indefinitely. The reviewer is right that an unexplained, untested
asymmetry is a trap, so it gets a comment and a test pinning both halves
(problem clears; coalesced fields survive a status-only update) rather than a
code change. Why: whichever Phase 2 task next touches finishLesson would
otherwise "fix" the inconsistency and silently resurrect stale errors. Cost if
wrong: if clearing turns out to be undesirable, one line and one assertion flip.
Task 4: fix round 1/5 (1 addressed, 0 open — comment added, SQL unchanged as the
ruling required, test pins both halves; commits 77679d6..64eca33).
Task 4: complete (commits e4040d8..64eca33, review clean). 99/99 verified.
Task 5: implementer DONE, commit 0dd1f69. Controller ran all three Phase 1
checkpoint gates independently: npm test 103/103, npm run check 0 errors
(81 warnings, all pre-existing), npm run build succeeds.
Task review dispatched (sonnet) over 64eca33..0dd1f69.
Task 5: review verdicts — spec COMPLIANCE, quality APPROVED with 2 Important.
Task 5: minor (deferred): the only-'paid' COALESCE branch in balanceForAccount
is untested (only-'owed' is incidentally covered); "empty account" and
"nonexistent account_id" are behaviourally identical today and not
distinguished; `kind` and `status` are free TEXT with no CHECK constraint while
TypeScript restricts them to 'owed'|'paid' and 'single'|'double' — worth
revisiting before Phase 2/3 add more writers to the table.
Ruling: Both Important findings are defects in my brief and share one fix.
Math.round(amountAgorot) silently coerced non-integer input, hiding exactly the
caller bug the integer-agorot invariant exists to catch; and the "no float
drift" test summed 3333 x 100 = 333300, which is exactly representable in
float64, so it would pass unchanged against a float implementation. Replaced
the rounding with a TypeError on non-integer input, renamed the misleading test
to what it actually proves (exact summation over many rows), and added a test
that a shekels-shaped amount (33.33) is rejected and writes no row. Why: a
silently rounded amount becomes a wrong balance a parent reads, and a test that
cannot fail is worse than no test because it advertises a guarantee nobody has.
Cost if wrong: a caller legitimately holding a fractional amount must round at
the call site, where the intent is visible, instead of here.
Task 5: fix round 1/5 (2 addressed, 0 open — Math.round removed, guard runs
before the INSERT, misleading test renamed, rejection test added at end of file;
commits 0dd1f69..5a52918).
Task 5: complete (commits 64eca33..5a52918, review clean). 104/104 verified.

PHASE 1 COMPLETE. All five tasks done. Checkpoint gates verified by controller:
npm test 104/104, npm run check 0 errors, npm run build succeeds.

FINAL WHOLE-BRANCH REVIEW (opus, 18 commits): NOT READY. 1 Critical, 5 Important.
C1 VERIFIED BY CONTROLLER: `find build -name '*.sql'` returns nothing; the db
chunk bundles to build/server/chunks/chunks/db.js-<hash>.js and the Dockerfile
ships only /app/build. migrate()'s readdirSync would scan a directory with no
migrations, create an empty schema_version, and silently create zero tables.
Ruling C1: replace filesystem discovery with an explicit TypeScript migration
registry — each migration exports its SQL as a module constant. Why: a .sql
file next to a .ts file survives `node --test` (which loads source) but not
Vite bundling (which only carries imported modules), so the unit tests could
never have caught this. A module import is bundler-safe by construction rather
than by configuration. Cost if wrong: SQL loses .sql syntax highlighting.
Ruling (e), reversing my earlier deferral: fold CHECK constraints on
payments.kind and payments.status into 001 now. The reviewer is right that a
typo'd status silently vanishes from balanceForAccount's sums — the same class
as the Math.round coercion already rejected — and SQLite has no ALTER TABLE ADD
CONSTRAINT, so this is two words now versus a table rebuild against live payment
rows later. 001 is already being reopened for C1.
Ruling I1: fold in eager migration at boot. Same failure-invisibility family as
C1 — a migration that throws currently lets the process bind the port and 500
every DB route forever, which is worse than crash-looping.
Ruling I5: add FK coverage for the remaining student_id declarations. Five of
six would pass 104/104 if reverted to bare TEXT, which is the exact deviation
this branch shipped once in Task 1 round 1.
Ruling I2 (DEFERRED to Phase 2, not fixed here): create-accessors return row /
id / void across four sibling modules. Real inconsistency, but it is an API
shape decision better made when Phase 2's consumers exist and show what they
need. Recorded so Phase 2's plan starts from it. Cost if wrong: the reviewer is
right that it gets more expensive after Tasks 6-11 add callers.
I3, I4: deferred, non-blocking. Documented coercion asymmetry and thin coverage
of getBest/paymentsForAccount.
Final fix wave: commits 5a52918..1f971c7 (414bb05 C1+e, ad0dd2b CHECK test,
dbfe5db I1, 1f971c7 I5). Scoped re-review: all four ADDRESSED, no new breakage.
Re-reviewer diffed the deleted 001_entities.sql byte-for-byte against the new
template literal — every table, column, type, NOT NULL, DEFAULT, REFERENCES,
UNIQUE and all six indexes identical; only deltas are the two CHECK constraints
and the required backtick escaping.
Controller verified independently: 106/106, build succeeds, and the BUILT chunk
run against a fresh DB created all ten entity tables with schema_version = 1 row.
PHASE 1 COMPLETE AND CLEAN.
