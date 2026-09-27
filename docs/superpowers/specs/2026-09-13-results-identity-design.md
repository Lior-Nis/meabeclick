# Game results get a real identity

Slice 1 of the evidence decomposition. Todoist `id:6hRhqR5c68wXWXFH`.

## 1. Why this exists, and what the task got wrong

The task asks to link `results_v2` and `homework` rows to `plan_nodes.id` so that
practice evidence can move a learning plan. Both tables exist. Neither has a
single production row, because nothing writes to them.

- `/api/game-result` calls `writeResult` from `src/lib/server/db.ts:219`, which
  inserts into the legacy `results` table, **keyed on the student's Hebrew
  display name**. The `student_id`-keyed `writeResult` in
  `src/lib/server/results.ts:21` — the one that targets `results_v2` — is
  imported by one unit test and by no route.
- Homework the family sees lives in a per-student JSON file on disk
  (`portalDir()/<code>.json`, written by `enroll.ts:149`). The legacy
  `lessons.homework` column is a second copy. The `homework` table, whose writer
  `addHomework` lives in `src/lib/server/lessons.ts:76`, is an unwired third —
  no route imports that module at all.

There is a second gap the tables do not show: **nothing maps a game or a
homework item to a skill.** A result's only identity is `data_id` + `template`,
where `template` is a generic engine (`Quiz`, `Matching`, `NumberLine`), and
`plan_nodes.key` is curriculum-shaped (`func.basics.linquad`). Lesson
preparation (`src/lib/server/lesson/prep.ts`) is keyed on student *name*,
subject, topic and level — it never sees an enrollment or a plan node, so the
material it generates cannot inherit one. A skill cannot be inferred from a
finished game after the fact. The link has to be stamped when work is
**assigned**.

The schema half of the task's premise does hold. `plan_events.source` is
CHECK-constrained and `report_id` is present, exactly as `004_learning_plans.ts:16`
anticipated. It is the evidence feeding it that does not exist.

So the task is three slices, not one:

| Slice | What it does | State |
|---|---|---|
| 1 | Evidence identity — game results become `student_id`-keyed | **this spec** |
| 1b | Homework: three copies become one table | not started |
| 2 | Skill attribution — stamp `plan_node_id` when work is assigned | not started |
| 3 | Drafts and tutor approval — evidence becomes a draft `plan_event` | not started |

Slice 3 depends on 2, which depends on 1 and 1b. The Todoist task stays open
until all four ship.

## 2. Scope of this spec

Game results only. Homework is deliberately excluded: moving it changes what
the family portal reads, which is a user-facing surface deserving its own
design and its own approval.

Explicitly **not** in scope: any plan-node link, any draft event, any approval
UI, and any change to the tutor dashboard.

## 3. The bug being fixed, in the words of the code

`src/lib/server/results.ts:3` already documents it:

> The retired version keyed on the Hebrew display name taken from the `?s=`
> query parameter, which meant two children sharing a first name shared a
> results history, and renaming a child orphaned theirs.

That is still live behaviour. `api/portal/[code]/+server.ts:139` signs
`data.name` — the display name — into the link, so `results.student` holds
display names today. The fix was written and never connected. This slice
connects it.

## 4. Design

### 4.1 Resolution — one policy, one function

Add to `src/lib/server/results.ts`:

```
resolveStudent(ref: string): number | null
```

1. Exact match on `students_v2.code` → that id.
2. Otherwise match on `students_v2.name`, resolving **only if exactly one**
   student carries that name.
3. Otherwise `null`.

Both the backfill and the live write path use it, so there is a single
attribution rule that cannot drift into two.

It returns an **id**, not a code or a name. The two call sites that need a
human-facing or URL-facing string (§4.4 and §4.5) get it from a companion
lookup in the same module:

```
studentRefById(id: number): { code: string; name: string } | null
```

Keeping these separate matters: `resolveStudent` answers *which student is
this*, and `studentRefById` answers *what do we call them*. Collapsing the two
is what produced the original bug, where one string served as identity and
label at once.

Relative imports only inside `src/lib/server/**` (`./db.ts`), per the repo rule:
unit tests import these files under plain Node, where Vite aliases do not
resolve.

`students_v2.code` is `NOT NULL UNIQUE` (`001_entities.ts:42`). `name` is
`NOT NULL` but **not** unique, which is exactly why step 2 needs the count
guard.

### 4.2 Migration `008_results_identity.ts` — backfill

Every legacy `results` row whose `student` resolves unambiguously **moves** to
`results_v2`, preserving its original `at`: it is inserted there and then
deleted from `results`. Rows that do not resolve stay in `results`, untouched
and undeleted — the judgement migration 006 made for bookings it could not
attribute.

**A move, not a copy, and that is load-bearing.** §4.6 reads the union of both
tables, so a row left in both would be counted twice on the tutor dashboard.
Moving establishes the invariant the union depends on:

> after 008, `results` holds exactly the plays that could not be attributed to
> a student, and `results_v2` holds exactly the plays that could.

The alternative — copy, and have the union skip legacy rows that resolve — is
not equivalent, and is wrong in a case that will occur: a student created
*after* the migration whose name matches an orphaned row would make that row
newly resolvable, so the union would skip it while `results_v2` still does not
contain it, and a real play would silently vanish. Moving has no such state.

The deletion is safe: it happens inside the transaction `migrations/index.ts:40`
opens, alongside the insert, so the row cannot be deleted without having landed
in `results_v2`. Its content is preserved in full; only its home changes.

**The migration must create the legacy `results` table `IF NOT EXISTS` before
reading it.** `migrate(handle)` runs at `db.ts:97`, inside the singleton
factory; the legacy `results` table is created by the `db.exec` block at
`db.ts:108`, *after* it. On a fresh database this migration therefore runs
before that table exists, and because `migrate()` rethrows on failure
(`migrations/index.ts:50`), a bare `SELECT ... FROM results` would make the app
**refuse to boot**. Restating the frozen legacy definition inside the migration
is the price of not reordering module-level side effects in `db.ts`. On a fresh
database the table is then empty and the backfill is a no-op; on the existing
deployment it already exists and `IF NOT EXISTS` does nothing.

The resolution rule expressed once, as a CTE, rather than repeated between the
`SELECT` list and the `WHERE`:

```sql
CREATE TABLE IF NOT EXISTS results ( ... );  -- verbatim from db.ts:108

INSERT INTO results_v2
  (student_id, at, data_id, template, score, total, tries, stars, seconds, missed)
SELECT sid, at, data_id, template, score, total, tries, stars, seconds, missed
FROM (
  SELECT r.*, COALESCE(
    (SELECT s.id FROM students_v2 s WHERE s.code = r.student),
    (SELECT s.id FROM students_v2 s WHERE s.name = r.student
       AND (SELECT COUNT(*) FROM students_v2 s2 WHERE s2.name = r.student) = 1)
  ) AS sid
  FROM results r
)
WHERE sid IS NOT NULL;

DELETE FROM results
WHERE COALESCE(
  (SELECT s.id FROM students_v2 s WHERE s.code = results.student),
  (SELECT s.id FROM students_v2 s WHERE s.name = results.student
     AND (SELECT COUNT(*) FROM students_v2 s2 WHERE s2.name = results.student) = 1)
) IS NOT NULL;
```

The `DELETE` repeats the resolution expression rather than sharing the CTE,
because SQLite cannot delete from a table through a subquery alias. The two
must stay identical — if they ever diverge, rows are either duplicated across
both tables or destroyed without landing. The migration test asserts the
totals, which is what catches a divergence.

Columns are listed explicitly rather than `SELECT *`, so a column added to one
table and not the other fails loudly instead of shifting values — the rule
`005_lesson_reports.ts:13` states.

No table is rebuilt and nothing is dropped, so none of the foreign-key hazards
documented in 003, 005 and 007 apply here.

This migration is additive and idempotent by virtue of the version record: it
runs exactly once, inside the transaction `migrations/index.ts:40` opens.

### 4.3 Write path

`/api/game-result` resolves `?s=` to an id and writes through `results.ts`'s
`writeResult`. When it does **not** resolve — a shared first name arriving on an
old WhatsApp link — it falls back to the legacy `writeResult` rather than
dropping the play. The endpoint's existing contract, stated at
`api/game-result/+server.ts:38` ("Never fail loudly: a storage problem must not
make finished homework look broken"), holds unchanged.

The signature check is untouched. `verifyGameSignature` covers the
`(dataId, student)` pair actually present in the request, so it is indifferent
to which identity that pair carries.

### 4.4 Links carry the code

`gameUrl()` call sites pass `students_v2.code` instead of the display name.

The two live call sites derive their URLs at **read time**, not from anything
baked into storage, so new links take effect immediately with no data change:

- `api/portal/[code]/+server.ts:139,144` — already has `code` in its route
  params; it currently passes `data.name` instead.
- `api/lessons/+server.ts:51` — has only the legacy `lessons.student` string,
  so it maps that to a code with
  `studentRefById(resolveStudent(l.student))?.code`, falling back to passing
  the string through unchanged when either step yields nothing.

The third call site is not a live one:
- `app/games/+page.server.ts:53` — a demo link for a non-existent student
  (`DEMO_STUDENT`); left exactly as is.

Already-sent links keep working: they carry a name and a signature minted over
that name, and both still verify.

### 4.5 Display and personal best

`app/play/[template]/+page.server.ts` builds its subtitle from the raw `?s=`
value (`:51`), so with codes in links it would show `noga` where it now shows
`נוגה`. It maps the value to a display name with
`studentRefById(resolveStudent(student))?.name`, falling back to the raw value
when either step yields nothing — which also keeps an old name-carrying link
rendering exactly as it does today.

`getBest` becomes id-keyed with the same fallback. Without this a child's
personal best resets the day their links change shape — the regression the
comment at `+page.server.ts:10` says the server-side best exists to prevent.

### 4.6 `readResults()` keeps its contract

`readResults()` (`db.ts:245`) returns `Record<displayName, summary>` and feeds
`/api/results`, which feeds the tutor dashboard. Its shape does not change.
Underneath, it reads the **union** of `results_v2` (joined to `students_v2.name`)
and the legacy rows that never migrated, grouped by display name as today.

Two consequences:

- The tutor dashboard needs no change. That matters: it is the ~1300-line file
  already queued for its own task (`id:6hM24q3XQH678Jgq`), and this slice
  should not collide with it.
- **No row becomes invisible.** An unresolvable result still reaches the tutor
  through the legacy half of the union. This is why the design does not report
  an unmigrated count anywhere: nothing is hidden, so there is nothing to
  report. (An earlier draft proposed such a report; it was dropped as
  unnecessary, and `boot-checks.ts` would have been the wrong home for it
  regardless — that module is strictly fail-fast config validation.)

The union is a plain concatenation with no de-duplication, which is correct
only because §4.2 **moves** rather than copies: the two tables are disjoint by
construction. A student whose name resolves ambiguously has all their plays in
the legacy half; one who resolves has all of theirs in `results_v2`. Either
way the union groups them under the same display-name key, so the tutor sees
one merged history — the same one they see today.

## 5. Testing

Row shapes read from SQLite are declared as `type` aliases, never `interface`:
TypeScript gives an alias an implicit index signature and an interface none, so
only the alias form can be cast from a `node:sqlite` row. `npm test` does not
catch this; `npm run check` does.

**Unit — `resolveStudent`:** a code match; a unique-name match; an ambiguous
name returning `null`; an unknown string returning `null`; and a student whose
*name* happens to equal another student's *code*, proving code is tried first.

**Unit — `studentRefById`:** a known id returns both strings; an unknown id
returns `null`. Paired with `resolveStudent` in one round-trip test — a code in,
the same code out — since §4.4 and §4.5 both depend on that composition holding.

**Unit — migration 008:** seed legacy `results` with resolvable, ambiguous and
unknown rows; run `migrate`; assert resolvable rows landed in `results_v2` with
the right `student_id` and their original `at`, and that ambiguous and unknown
rows are still in `results` and absent from `results_v2`. Assert the tables are
**disjoint and lossless**: every seeded row appears in exactly one of them, and
the two counts sum to what was seeded — this is the assertion that catches the
`INSERT`/`DELETE` resolution expressions of §4.2 drifting apart. Assert separately that
`migrate` succeeds on a database where `results` was never created — the boot
trap of §4.2, which fails without the `CREATE TABLE IF NOT EXISTS`.

**Unit — `readResults` union:** one migrated student and one unmigrated name
both appear, and a student with plays in both tables appears once with both
counted.

**Playwright:** play a game through a real signed link, then assert an
id-keyed `results_v2` row exists and the tutor dashboard still shows the play.
`npm run build` first — the harness spawns `build/index.js` and does not build
for you.

**Test honesty.** Before relying on an assertion, ask what would happen if the
thing it checks were deleted. Never copy the code under test into the test file.
Four tests were caught passing for the wrong reason on an earlier branch. A fix
claiming to repair a test must come with the deliberate-failure proof: break the
subject, paste the failure, restore it.

The harness blocks mail credentials, so senders return `false`; no test may
assert an email was sent. Nothing in this slice sends mail.

## 6. Gates

`npm run build`, `npm test` and `npm run check` all pass before any commit.
34 `check` warnings are the standing baseline; 0 errors is the bar.

## 7. Risks

- **Boot failure on a fresh database** if §4.2's `CREATE TABLE IF NOT EXISTS`
  is omitted. Covered by a dedicated test.
- **A wrong attribution is unrecoverable in practice** — it files one child's
  work under another's name. Mitigated by refusing to resolve ambiguous names
  at all, in both the backfill and the live path.
- **Display regression** on the play page if §4.5 is missed: Hebrew names
  replaced by English codes on a child-facing screen.
- The legacy `results` table is never dropped by this slice. Retiring it
  belongs to a later one, after 1b.
