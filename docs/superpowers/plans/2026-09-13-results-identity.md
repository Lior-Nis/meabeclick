# Game Results Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Game results stop being keyed on a child's Hebrew display name and become keyed on `students_v2.id`, so two children sharing a first name no longer share a results history and a rename no longer orphans one.

**Architecture:** `results_v2` and `src/lib/server/results.ts` already exist and are already read by `lessons.ts`; nothing needs inventing. The work is a single resolution policy shared by a backfill migration and the live write path, a move of attributable history out of the legacy `results` table, and a union read that keeps the tutor dashboard's API contract byte-identical.

**Tech Stack:** SvelteKit 2, TypeScript, `node:sqlite` (`DatabaseSync`), `node --test` with `node:assert/strict`, Playwright MCP for the browser proof.

**Spec:** `docs/superpowers/specs/2026-09-13-results-identity-design.md`

## Global Constraints

- Inside `src/lib/server/**` use **relative imports only** (`./db.ts`, `../../plan-status.ts`). Never `$lib`/`$server` there — unit tests import those files under plain Node, where Vite aliases do not resolve. Route files under `src/routes/**` use the aliases normally.
- Row shapes read from SQLite are **`type` aliases, never `interface`**. TypeScript gives an alias an implicit index signature and an interface none, so only the alias form can be cast from a `node:sqlite` row. `npm test` will not catch this; `npm run check` will.
- **Run all three gates before every commit**: `npm run build`, `npm test`, `npm run check`. 34 `check` warnings are the standing baseline; **0 errors** is the bar.
- `npm run build` before any characterization test — the harness spawns `build/index.js` and does not build for you.
- Never compare booking timestamps as strings against `Z`-formatted values. Not triggered by this plan, but `results.at` is written as `new Date().toISOString()` and must stay that way.
- The test harness blocks mail credentials, so senders return `false`. **No test may assert an email was sent.** Nothing here sends mail.
- `"end"` is a reserved word and stays quoted in every query touching `bookings_v2`.
- **Test honesty:** before relying on an assertion, ask what would happen if the thing it checks were deleted. **Never copy the code under test into the test file.** If a fix claims to repair a test, produce the deliberate-failure proof — break the subject, paste the failure, restore it.
- Commit messages end with: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## Task order is load-bearing

Tasks 1→2→3 must land before Task 4. Task 3 makes `readResults()` read both tables; Task 4 starts writing new plays to `results_v2`. In the other order there is an intermediate commit where new plays are invisible on the tutor dashboard.

---

### Task 1: Resolution helpers

**Files:**
- Modify: `src/lib/server/results.ts`
- Test: `tests/unit/results-identity.test.mjs` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `resolveStudent(ref: string): number | null` — a `students_v2.id`, or null.
  - `studentRefById(id: number): { code: string; name: string } | null`

  Every later task uses both. `resolveStudent` answers *which student is this*; `studentRefById` answers *what do we call them*. Do not collapse them — one string serving as both identity and label is the original bug.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/results-identity.test.mjs`. Note the `DB_PATH` + dynamic-import preamble: `src/lib/server/db.ts` opens its database at module load, so `DB_PATH` must be set **before** the import, which is why these are `await import(...)` and not static imports.

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'res-id-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const R = await import('../../src/lib/server/results.ts');

const acct = E.createAccount({ name: 'משפחה', credential: 'x' });
const noga = E.createStudent({ code: 'noga', name: 'נוגה', accountId: acct.id, credential: 'p' });

test('resolveStudent: a code resolves to that student', () => {
  assert.equal(R.resolveStudent('noga'), noga.id);
});

test('resolveStudent: a name unique across students resolves', () => {
  assert.equal(R.resolveStudent('נוגה'), noga.id);
});

test('resolveStudent: a name shared by two students does not resolve', () => {
  const a = E.createStudent({ code: 'or-a', name: 'אור', accountId: acct.id, credential: 'p' });
  const b = E.createStudent({ code: 'or-b', name: 'אור', accountId: acct.id, credential: 'p' });
  assert.notEqual(a.id, b.id);
  assert.equal(R.resolveStudent('אור'), null);
});

test('resolveStudent: an unknown string does not resolve', () => {
  assert.equal(R.resolveStudent('nobody-at-all'), null);
});

test('resolveStudent: code is tried before name', () => {
  // 'dan' is BOTH one student's code and another student's display name.
  // Code must win, or the wrong child gets the play.
  const byCode = E.createStudent({ code: 'dan', name: 'דניאל', accountId: acct.id, credential: 'p' });
  const byName = E.createStudent({ code: 'dani-2', name: 'dan', accountId: acct.id, credential: 'p' });
  assert.equal(R.resolveStudent('dan'), byCode.id);
  assert.notEqual(R.resolveStudent('dan'), byName.id);
});

test('studentRefById: a known id returns both strings', () => {
  assert.deepEqual(R.studentRefById(noga.id), { code: 'noga', name: 'נוגה' });
});

test('studentRefById: an unknown id returns null', () => {
  assert.equal(R.studentRefById(999999), null);
});

test('resolveStudent and studentRefById round-trip a code', () => {
  assert.equal(studentRefByIdCode('noga'), 'noga');
});

function studentRefByIdCode(code) {
  const id = R.resolveStudent(code);
  return id === null ? null : R.studentRefById(id).code;
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern="resolveStudent|studentRefById"`

Expected: FAIL — `R.resolveStudent is not a function`.

- [ ] **Step 3: Implement the helpers**

Append to `src/lib/server/results.ts` (it already imports `handle` from `./db.ts`):

```typescript
type StudentIdRow = { id: number };
type StudentRefRow = { code: string; name: string };

/**
 * Which student is this reference? Code first, then a display name that is
 * unique across students. Ambiguous or unknown returns null — never a guess.
 *
 * A guess here files one child's work under another child's name, which is
 * the defect this module's header describes and cannot be undone by hand.
 * Shared by the live write path and migration 008's backfill so there is one
 * attribution rule rather than two that drift.
 */
export function resolveStudent(ref: string): number | null {
  const db = handle();

  const byCode = db.prepare(
    `SELECT id FROM students_v2 WHERE code = ?`
  ).get(ref) as StudentIdRow | undefined;
  if (byCode) return byCode.id;

  const byName = db.prepare(
    `SELECT id FROM students_v2 WHERE name = ?
       AND (SELECT COUNT(*) FROM students_v2 s2 WHERE s2.name = ?) = 1`
  ).get(ref, ref) as StudentIdRow | undefined;
  return byName?.id ?? null;
}

/** What do we call this student? The URL-facing code and the display name. */
export function studentRefById(id: number): { code: string; name: string } | null {
  const row = handle().prepare(
    `SELECT code, name FROM students_v2 WHERE id = ?`
  ).get(id) as StudentRefRow | undefined;
  return row ? { code: row.code, name: row.name } : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --test-name-pattern="resolveStudent|studentRefById"`
Expected: PASS, 8 tests.

- [ ] **Step 5: Run all three gates**

```bash
npm run build && npm test && npm run check
```
Expected: build clean, all tests pass, `check` reports 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/results.ts tests/unit/results-identity.test.mjs
git commit -m "$(cat <<'EOF'
Give a student reference one way to become an id

resolveStudent tries code, then a display name unique across students,
and refuses to guess otherwise. studentRefById is the inverse lookup for
the two places that need a label rather than an identity.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Migration 008 — move attributable history

**Files:**
- Create: `src/lib/server/migrations/008_results_identity.ts`
- Modify: `src/lib/server/migrations/list.ts`
- Test: `tests/unit/results-backfill.test.mjs` (create)

**Interfaces:**
- Consumes: the resolution rule from Task 1, re-expressed in SQL (migrations are pure SQL strings and cannot call TypeScript).
- Produces: the invariant every later task relies on — **`results` and `results_v2` are disjoint.** `results` holds exactly the plays that could not be attributed; `results_v2` holds exactly the plays that could.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/results-backfill.test.mjs`, following `tests/unit/backfill-booking-enrollment.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../../src/lib/server/migrations/index.ts';
import { MIGRATIONS } from '../../src/lib/server/migrations/list.ts';

async function freshDb() {
  const dir = await mkdtemp(join(tmpdir(), 'results-backfill-'));
  const db = new DatabaseSync(join(dir, 'test.db'));
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

/** Apply migrations 1..7, leaving 008 as the pending one migrate() will run. */
function applyThrough7(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
  for (const m of MIGRATIONS.filter(m => m.version <= 7).sort((a, b) => a.version - b.version)) {
    db.exec(m.sql);
    db.prepare(`INSERT INTO schema_version (version, applied_at) VALUES (?, ?)`).run(m.version, '2026-01-01');
  }
}

/** The legacy table, verbatim from src/lib/server/db.ts. */
function createLegacyResults(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS results (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      student  TEXT    NOT NULL,
      at       TEXT    NOT NULL,
      data_id  TEXT,
      template TEXT,
      score    INTEGER,
      total    INTEGER,
      tries    INTEGER,
      stars    INTEGER,
      seconds  INTEGER,
      missed   TEXT
    );
  `);
}

function seedStudent(db, { code, name }) {
  db.prepare(`INSERT INTO accounts (name, phone, credential, is_self, created_at)
              VALUES ('משפחה', NULL, 'x', 0, '2026-01-01T00:00:00.000Z')`).run();
  const accountId = db.prepare(`SELECT id FROM accounts ORDER BY id DESC LIMIT 1`).get().id;
  db.prepare(`INSERT INTO students_v2 (code, name, account_id, credential, created_at)
              VALUES (?, ?, ?, 'x', '2026-01-01T00:00:00.000Z')`).run(code, name, accountId);
  return db.prepare(`SELECT id FROM students_v2 WHERE code = ?`).get(code).id;
}

function seedResult(db, student, dataId, at) {
  db.prepare(`INSERT INTO results (student, at, data_id, template, score, total, tries, stars, seconds, missed)
              VALUES (?, ?, ?, 'quiz', 8, 10, 1, 3, 60, '[]')`).run(student, at, dataId);
}

test('backfill: a result under a unique display name moves to results_v2', async () => {
  const db = await freshDb();
  applyThrough7(db);
  createLegacyResults(db);
  const lizaId = seedStudent(db, { code: 'noga', name: 'נוגה' });
  seedResult(db, 'נוגה', 'noga-quiz', '2026-05-01T10:00:00.000Z');

  migrate(db);

  const moved = db.prepare(`SELECT * FROM results_v2`).all();
  assert.equal(moved.length, 1);
  assert.equal(moved[0].student_id, lizaId);
  assert.equal(moved[0].data_id, 'noga-quiz');
  // The original timestamp survives: a play's date is part of the evidence.
  assert.equal(moved[0].at, '2026-05-01T10:00:00.000Z');

  // Moved, not copied — otherwise the union in readResults double-counts it.
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM results`).get().n, 0);
});

test('backfill: a result under a shared display name stays in the legacy table', async () => {
  const db = await freshDb();
  applyThrough7(db);
  createLegacyResults(db);
  seedStudent(db, { code: 'or-a', name: 'אור' });
  seedStudent(db, { code: 'or-b', name: 'אור' });
  seedResult(db, 'אור', 'or-quiz', '2026-05-02T10:00:00.000Z');

  migrate(db);

  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM results_v2`).get().n, 0);
  const left = db.prepare(`SELECT * FROM results`).all();
  assert.equal(left.length, 1);
  assert.equal(left[0].data_id, 'or-quiz');
});

test('backfill: a result under an unknown name stays in the legacy table', async () => {
  const db = await freshDb();
  applyThrough7(db);
  createLegacyResults(db);
  seedStudent(db, { code: 'noga', name: 'נוגה' });
  seedResult(db, 'מישהו אחר', 'ghost-quiz', '2026-05-03T10:00:00.000Z');

  migrate(db);

  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM results_v2`).get().n, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM results`).get().n, 1);
});

test('backfill: a result under a code moves too', async () => {
  const db = await freshDb();
  applyThrough7(db);
  createLegacyResults(db);
  const lizaId = seedStudent(db, { code: 'noga', name: 'נוגה' });
  seedResult(db, 'noga', 'by-code', '2026-05-04T10:00:00.000Z');

  migrate(db);

  const moved = db.prepare(`SELECT * FROM results_v2`).all();
  assert.equal(moved.length, 1);
  assert.equal(moved[0].student_id, lizaId);
});

test('backfill: the two tables are disjoint and nothing is lost', async () => {
  const db = await freshDb();
  applyThrough7(db);
  createLegacyResults(db);
  seedStudent(db, { code: 'noga', name: 'נוגה' });
  seedStudent(db, { code: 'or-a', name: 'אור' });
  seedStudent(db, { code: 'or-b', name: 'אור' });

  seedResult(db, 'נוגה', 'a', '2026-05-01T00:00:00.000Z');      // resolves
  seedResult(db, 'noga', 'b', '2026-05-02T00:00:00.000Z');      // resolves by code
  seedResult(db, 'אור', 'c', '2026-05-03T00:00:00.000Z');       // ambiguous
  seedResult(db, 'רפאל', 'd', '2026-05-04T00:00:00.000Z');      // unknown
  const seeded = 4;

  migrate(db);

  const inV2 = db.prepare(`SELECT COUNT(*) AS n FROM results_v2`).get().n;
  const inLegacy = db.prepare(`SELECT COUNT(*) AS n FROM results`).get().n;
  // This is the assertion that catches the INSERT and DELETE resolution
  // expressions drifting apart: drift either duplicates rows across both
  // tables or destroys them without landing.
  assert.equal(inV2, 2);
  assert.equal(inLegacy, 2);
  assert.equal(inV2 + inLegacy, seeded);
});

test('migrate succeeds on a database where the legacy results table never existed', async () => {
  const db = await freshDb();
  applyThrough7(db);
  // Deliberately NO createLegacyResults(db). On a fresh deployment migrate()
  // runs inside db.ts's singleton factory BEFORE the db.exec block that
  // creates the legacy table, so a migration reading `results` without
  // creating it first makes the app refuse to boot.
  assert.doesNotThrow(() => migrate(db));
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM results_v2`).get().n, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern="backfill:|legacy results table never existed"`

Expected: FAIL. The first five fail because `results_v2` stays empty (no migration 008 exists yet). The last passes trivially for now — that is expected; it becomes a real guard in Step 3 and you will prove it in Step 5.

- [ ] **Step 3: Write the migration**

Create `src/lib/server/migrations/008_results_identity.ts`:

```typescript
/**
 * Migration 008 — game results get a real identity.
 *
 * The legacy `results` table is keyed on a child's Hebrew display name, so
 * two children sharing a first name share one history and renaming a child
 * orphans theirs (src/lib/server/results.ts:3 documents the defect). The
 * student_id-keyed replacement, results_v2, has existed since migration 001
 * and has never been written to.
 *
 * Rows whose `student` resolves unambiguously MOVE here: inserted into
 * results_v2, then deleted from `results`. A move, not a copy, because
 * readResults() reads the union of both tables — a row left in both would be
 * counted twice on the tutor dashboard. The invariant this establishes:
 *
 *   `results` holds exactly the plays that could not be attributed;
 *   `results_v2` holds exactly the plays that could.
 *
 * The alternative (copy, and have the union skip legacy rows that resolve)
 * is wrong in a case that will occur: a student created AFTER this migration
 * whose name matches an orphaned row makes that row newly resolvable, so the
 * union would skip it while results_v2 still does not contain it, and a real
 * play silently vanishes. Moving has no such state.
 *
 * Ambiguous and unknown rows are left alone, undeleted — the judgement
 * migration 006 made for bookings it could not attribute. Guessing files one
 * child's work under another's name, which cannot be undone by hand.
 *
 * ## Why this creates the legacy table
 *
 * `migrate()` is called from inside db.ts's singleton factory (db.ts:97),
 * and the `db.exec` block that creates the legacy `results` table runs
 * AFTER it (db.ts:108). On a fresh database this migration therefore
 * executes before that table exists, and migrate() rethrows on failure
 * (migrations/index.ts:50), so a bare `SELECT ... FROM results` here would
 * make the app refuse to boot. Restating the frozen legacy definition is the
 * price of not reordering module-level side effects in db.ts. On a fresh
 * database the table is then empty and this migration is a no-op.
 *
 * The INSERT lists its columns rather than SELECT *, so a column added to
 * one table and not the other fails loudly instead of shifting values
 * (005_lesson_reports.ts:13). No table is rebuilt and nothing is dropped, so
 * none of the foreign-key hazards 003, 005 and 007 document apply here.
 *
 * The DELETE repeats the resolution expression rather than sharing the
 * subquery, because SQLite cannot delete from a table through a subquery
 * alias. The two MUST stay identical; tests/unit/results-backfill.test.mjs
 * asserts the tables are disjoint and lossless, which is what catches drift.
 */
export const sql = `
CREATE TABLE IF NOT EXISTS results (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  student  TEXT    NOT NULL,
  at       TEXT    NOT NULL,
  data_id  TEXT,
  template TEXT,
  score    INTEGER,
  total    INTEGER,
  tries    INTEGER,
  stars    INTEGER,
  seconds  INTEGER,
  missed   TEXT
);

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
`;
```

- [ ] **Step 4: Register the migration**

In `src/lib/server/migrations/list.ts`, add the import beneath `sql007`:

```typescript
import { sql as sql008 } from './008_results_identity.ts';
```

and the entry at the end of the `MIGRATIONS` array:

```typescript
  { version: 8, name: '008_results_identity', sql: sql008 },
```

- [ ] **Step 5: Run the tests to verify they pass, and prove the boot guard is real**

Run: `npm test -- --test-name-pattern="backfill:|legacy results table never existed"`
Expected: PASS, 6 tests.

Then prove the last test is not passing for the wrong reason — it is the only guard on a boot failure, so it must be shown to fail when the guard is removed. Temporarily delete the `CREATE TABLE IF NOT EXISTS results (...);` statement from the migration's SQL and re-run:

Expected: FAIL with `no such table: results`. **Paste that failure output into the task report**, then restore the statement and re-run to confirm PASS.

- [ ] **Step 6: Run all three gates**

```bash
npm run build && npm test && npm run check
```
Expected: build clean, all tests pass, `check` reports 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/migrations/008_results_identity.ts src/lib/server/migrations/list.ts tests/unit/results-backfill.test.mjs
git commit -m "$(cat <<'EOF'
Move attributable game history onto student ids

Every legacy result whose student resolves unambiguously moves to
results_v2; ambiguous and unknown rows stay where they are rather than
being filed under a guessed child. A move rather than a copy, so the
union readResults is about to grow cannot double-count.

The migration creates the legacy table IF NOT EXISTS: migrate() runs
before db.ts creates it, so reading it bare would break a cold boot.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `readResults()` reads both tables

**Files:**
- Modify: `src/lib/server/db.ts:245` (`readResults`)
- Test: `tests/unit/results-union.test.mjs` (create)

**Interfaces:**
- Consumes: the disjointness invariant from Task 2.
- Produces: `readResults()` with an **unchanged** signature — `Record<string, StudentResultsSummary>` keyed by display name. `/api/results` and the tutor dashboard are not modified by this plan.

**Why this lands before Task 4:** Task 4 sends new plays to `results_v2`. If that happened first, there would be a commit where new plays are invisible on the dashboard.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/results-union.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'res-union-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const D = await import('../../src/lib/server/db.ts');
const R = await import('../../src/lib/server/results.ts');

const acct = E.createAccount({ name: 'משפחה', credential: 'x' });
const noga = E.createStudent({ code: 'noga', name: 'נוגה', accountId: acct.id, credential: 'p' });

test('a results_v2 play appears under the student display name', () => {
  R.writeResult({ studentId: noga.id, dataId: 'v2-quiz', template: 'quiz', score: 9, total: 10 });

  const all = D.readResults();
  assert.ok(all['נוגה'], 'expected a summary keyed by the display name');
  assert.equal(all['נוגה'].plays, 1);
  assert.equal(all['נוגה'].score, 9);
});

test('an unattributable legacy play still reaches the tutor', () => {
  // Written straight to the legacy table, as the live endpoint does when a
  // name cannot be resolved. Nothing may become invisible.
  D.writeResult({ student: 'אור', dataId: 'legacy-quiz', template: 'quiz', score: 4, total: 10 });

  const all = D.readResults();
  assert.ok(all['אור'], 'an unresolvable legacy play must still be visible');
  assert.equal(all['אור'].plays, 1);
  assert.equal(all['אור'].score, 4);
});

test('a student with plays in both tables is summarised once, counting both', () => {
  const dan = E.createStudent({ code: 'dan', name: 'דן', accountId: acct.id, credential: 'p' });
  R.writeResult({ studentId: dan.id, dataId: 'both-a', template: 'quiz', score: 5, total: 10 });
  D.writeResult({ student: 'דן', dataId: 'both-b', template: 'quiz', score: 6, total: 10 });

  const all = D.readResults();
  assert.equal(all['דן'].plays, 2, 'one merged history, not two entries');
  assert.equal(all['דן'].score, 11);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern="results_v2 play appears|unattributable legacy play|plays in both tables"`

Expected: FAIL on the first and third — `readResults()` reads only the legacy table, so `all['נוגה']` is `undefined`. The second passes already (legacy-only behaviour is unchanged); that is expected.

- [ ] **Step 3: Change the query**

`readResults()` currently starts with:

```javascript
  for (const r of db.prepare(`SELECT * FROM results ORDER BY at DESC`).all()) {
```

Replace that single query with the union of both tables, projecting `results_v2` into the legacy row shape by joining the display name. Everything after the loop — the per-student aggregation — is untouched:

```typescript
  const rows = db.prepare(`
    SELECT student, at, data_id, template, score, total, tries, stars, seconds, missed
    FROM results
    UNION ALL
    SELECT s.name AS student, r.at, r.data_id, r.template, r.score, r.total,
           r.tries, r.stars, r.seconds, r.missed
    FROM results_v2 r
    JOIN students_v2 s ON s.id = r.student_id
    ORDER BY at DESC
  `).all() as ResultRow[];

  for (const r of rows) {
```

`UNION ALL`, not `UNION`: it must not de-duplicate. Two genuinely identical plays (same game, same score, same second) are two plays, and the tables are disjoint by Task 2's invariant, so there is nothing to de-duplicate anyway.

Add a comment above the query explaining the union, since a reader will otherwise wonder why two tables:

```typescript
  /* Both tables, because migration 008 splits history by whether it could be
     attributed: results_v2 holds plays with a real student_id, `results` holds
     the ones whose display name was ambiguous or unknown. They are disjoint —
     008 MOVES rows rather than copying them — so UNION ALL cannot double-count,
     and nothing a child played is invisible to the tutor. Keyed by display name
     either way, so this function's contract (and /api/results, and the
     dashboard) is unchanged. */
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --test-name-pattern="results_v2 play appears|unattributable legacy play|plays in both tables"`
Expected: PASS, 3 tests.

- [ ] **Step 5: Run all three gates**

```bash
npm run build && npm test && npm run check
```
Expected: build clean, all tests pass, `check` reports 0 errors. Pay attention here — the `as ResultRow[]` cast is exactly where the `type`-alias-not-`interface` rule bites, and only `check` catches it.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/db.ts tests/unit/results-union.test.mjs
git commit -m "$(cat <<'EOF'
Show the tutor both halves of a split history

readResults now unions results_v2 with the legacy rows migration 008
could not attribute, keyed by display name as before, so its contract and
the dashboard that consumes it are untouched. Lands before the write path
moves, so no play is ever invisible between commits.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The write path resolves to an id

**Files:**
- Modify: `src/routes/api/game-result/+server.ts`
- Test: `tests/unit/results-write-path.test.mjs` (create)

**Interfaces:**
- Consumes: `resolveStudent` (Task 1); `readResults` union (Task 3).
- Produces: new plays land in `results_v2` whenever the reference resolves.

- [ ] **Step 1: Write the failing tests**

The route's decision is *resolve, else fall back*. Test that decision against the database, not by asserting on an HTTP response — the response is `{ ok: true }` either way, so an HTTP-only assertion could not fail and would be one of the dishonest tests the constraints forbid.

Create `tests/unit/results-write-path.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'res-write-')), 'results.db');
process.env.SESSION_SECRET = 'test-secret-for-signing';

const E = await import('../../src/lib/server/entities.ts');
const D = await import('../../src/lib/server/db.ts');
const U = await import('../../src/lib/server/urls.ts');
const { POST } = await import('../../src/routes/api/game-result/+server.ts');

const acct = E.createAccount({ name: 'משפחה', credential: 'x' });
const noga = E.createStudent({ code: 'noga', name: 'נוגה', accountId: acct.id, credential: 'p' });
E.createStudent({ code: 'or-a', name: 'אור', accountId: acct.id, credential: 'p' });
E.createStudent({ code: 'or-b', name: 'אור', accountId: acct.id, credential: 'p' });

/** A real signed submission, exactly as a game posts one.
 *  `sign()` is private to urls.ts, so the signature is taken from a real
 *  gameUrl() rather than re-implemented — a copied signer would only ever
 *  test itself. */
function post(student, dataId) {
  const t = new URL(`http://x${U.gameUrl({ template: 'quiz', dataId, student })}`)
    .searchParams.get('t');
  const request = new Request('http://localhost/api/game-result', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ student, dataId, t, template: 'quiz', score: 7, total: 10 }),
  });
  return POST({ request });
}

const v2Rows = () => D.handle().prepare(`SELECT * FROM results_v2`).all();
const legacyRows = () => D.handle().prepare(`SELECT * FROM results`).all();

test('a play submitted under a code lands in results_v2 with the student id', async () => {
  const res = await post('noga', 'code-quiz');
  assert.equal(res.status, 200);

  const row = v2Rows().find(r => r.data_id === 'code-quiz');
  assert.ok(row, 'expected a results_v2 row');
  assert.equal(row.student_id, noga.id);
  assert.equal(row.score, 7);
  assert.equal(legacyRows().some(r => r.data_id === 'code-quiz'), false);
});

test('an old link carrying a unique display name also lands in results_v2', async () => {
  await post('נוגה', 'name-quiz');

  const row = v2Rows().find(r => r.data_id === 'name-quiz');
  assert.ok(row, 'a resolvable old link must still be attributed');
  assert.equal(row.student_id, noga.id);
});

test('a play under a shared name falls back to the legacy table rather than being dropped', async () => {
  await post('אור', 'shared-quiz');

  assert.equal(v2Rows().some(r => r.data_id === 'shared-quiz'), false);
  const row = legacyRows().find(r => r.data_id === 'shared-quiz');
  assert.ok(row, 'an unresolvable play must still be stored, never dropped');
  assert.equal(row.student, 'אור');
});

test('an unresolvable play still reaches the tutor through readResults', async () => {
  await post('אור', 'shared-quiz-2');
  assert.ok(D.readResults()['אור'], 'finished homework must not look broken');
});
```

Note on the `post()` helper: `urls.ts` exports `gameUrl`, `verifyGameSignature`, `assertPathSegment`, `lessonUrl` and `portalLink` — `sign()` itself is module-private. So the signature must come from a real `gameUrl()`, as above. **Do not copy `sign()` into the test file**: a copied signer tests itself, not the route, and that is one of the four ways tests were caught passing for the wrong reason on an earlier branch.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern="lands in results_v2|falls back to the legacy table|reaches the tutor through readResults"`

Expected: FAIL on the first two — the route writes to the legacy table, so `results_v2` is empty.

- [ ] **Step 3: Change the route**

In `src/routes/api/game-result/+server.ts`, add to the imports (route files use aliases, unlike `src/lib/server/**`):

```typescript
import { resolveStudent, writeResult as writeResultV2 } from '$server/results.ts';
```

Replace the `writeResult({ ...body, student });` call inside the existing `try` with:

```typescript
    /* Resolve to a real student id when we can. An unresolvable reference —
       a name two children share, arriving on a link already sent over
       WhatsApp — falls back to the legacy table rather than dropping the
       play: readResults() unions both, so the tutor still sees it. Refusing
       to guess is deliberate; attributing one child's work to another cannot
       be undone by hand. */
    const studentId = resolveStudent(student);
    if (studentId === null) {
      writeResult({ ...body, student });
    } else {
      writeResultV2({ ...body, studentId });
    }
```

Leave the surrounding `try`/`catch` and its "Never fail loudly" comment exactly as they are.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --test-name-pattern="lands in results_v2|falls back to the legacy table|reaches the tutor through readResults"`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run all three gates**

```bash
npm run build && npm test && npm run check
```
Expected: build clean, all tests pass, `check` reports 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/routes/api/game-result/+server.ts tests/unit/results-write-path.test.mjs
git commit -m "$(cat <<'EOF'
Record a finished game against a student id

The endpoint resolves the signed reference and writes results_v2 when it
can. An ambiguous name falls back to the legacy table instead of being
dropped — the endpoint's standing rule is that finished homework must
never look broken.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Links carry the code

**Files:**
- Modify: `src/routes/api/portal/[code]/+server.ts:139,144`
- Modify: `src/routes/api/lessons/+server.ts:51`
- Test: `tests/unit/game-links.test.mjs` (create)

**Interfaces:**
- Consumes: `resolveStudent`, `studentRefById` (Task 1).
- Produces: newly derived game URLs carry `?s=<code>`. `app/games/+page.server.ts:53` is **not** touched — it builds a demo link for `DEMO_STUDENT`, who is not a real student.

**Why no data migration:** both call sites derive URLs at read time, so new links take effect immediately. Links already sent keep verifying, because `verifyGameSignature` checks whatever `(dataId, student)` pair is in the request.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/game-links.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'links-')), 'results.db');
process.env.SESSION_SECRET = 'test-secret-for-signing';

const E = await import('../../src/lib/server/entities.ts');
const U = await import('../../src/lib/server/urls.ts');
const R = await import('../../src/lib/server/results.ts');

const acct = E.createAccount({ name: 'משפחה', credential: 'x' });
const noga = E.createStudent({ code: 'noga', name: 'נוגה', accountId: acct.id, credential: 'p' });

const sOf = (url) => new URL(`http://x${url}`).searchParams.get('s');
const tOf = (url) => new URL(`http://x${url}`).searchParams.get('t');

test('a link built for a known student carries the code, not the display name', () => {
  const ref = R.studentRefById(noga.id);
  const url = U.gameUrl({ template: 'quiz', dataId: 'd1', student: ref.code });
  assert.equal(sOf(url), 'noga');
  assert.notEqual(sOf(url), 'נוגה');
});

test('a code-carrying link verifies', () => {
  const url = U.gameUrl({ template: 'quiz', dataId: 'd1', student: 'noga' });
  assert.equal(U.verifyGameSignature({ dataId: 'd1', student: 'noga', t: tOf(url) }), true);
});

test('a link already sent under a display name still verifies', () => {
  // Signatures cover whatever pair is in the URL, so links in WhatsApp
  // threads keep working after this change. If this ever fails, every game
  // link a family already has is dead.
  const old = U.gameUrl({ template: 'quiz', dataId: 'd1', student: 'נוגה' });
  assert.equal(U.verifyGameSignature({ dataId: 'd1', student: 'נוגה', t: tOf(old) }), true);
});

test('a code-signed link does not verify against the display name', () => {
  const url = U.gameUrl({ template: 'quiz', dataId: 'd1', student: 'noga' });
  assert.equal(U.verifyGameSignature({ dataId: 'd1', student: 'נוגה', t: tOf(url) }), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern="carries the code|code-carrying link verifies|already sent under a display name|does not verify against the display name"`

Expected: these exercise `urls.ts`, which is unchanged, so they should **PASS immediately**. That is the point — they pin the signature behaviour the route change depends on, before the routes change. If any fails, stop: the premise of §4.4 is wrong and the task needs re-designing rather than implementing.

- [ ] **Step 3: Change the portal route**

In `src/routes/api/portal/[code]/+server.ts`, lines 139 and 144 pass `data.name` into `normalizeGameLike`. The route already has the student's `code` in its params. Pass `code` instead:

```typescript
        .map((g: unknown) => normalizeGameLike(g, code))
```
```typescript
        .map((h: unknown) => normalizeGameLike(h, code) ?? h)
```

Rename the parameter in `normalizeGameLike` (`:65`) from `studentName` to `studentRef`, so the name stops claiming it is a display name:

```typescript
function normalizeGameLike(entry: unknown, studentRef: string): Record<string, unknown> | null {
```
```typescript
      return { ...e, url: gameUrl({ template: e.template, dataId: e.dataId, student: studentRef }) };
```

Leave the `data.name` validation block above untouched — it guards the portal file's shape and is still needed for display.

- [ ] **Step 4: Change the lessons route**

In `src/routes/api/lessons/+server.ts`, the call at `:51` passes `l.student`, the legacy display-name string. Map it to a code, falling back to the raw string when it does not resolve. Add the import:

```typescript
import { resolveStudent, studentRefById } from '$server/results.ts';
```

and at the call site in the `GET` handler, where `l.student` is passed to `normalizeLessonGame`:

```typescript
      /* Prefer the stable code: the legacy lessons table stores a display
         name, which is ambiguous between two children sharing one and
         changes when a child is renamed. An unresolvable name passes through
         unchanged, producing exactly the link it produces today. */
      const id = resolveStudent(l.student);
      const ref = id === null ? l.student : (studentRefById(id)?.code ?? l.student);
```

and pass `ref` in place of `l.student`:

```typescript
      games: l.games.map(g => normalizeLessonGame(g, ref)),
```

- [ ] **Step 5: Run the tests and the full suite**

Run: `npm test`
Expected: PASS. Watch for regressions in `tests/unit/portal-file.test.mjs` and any characterization test covering the portal or lessons payload — a changed `?s=` value in a recorded response is a **real** change to review, not noise to re-record. If a characterization expectation changes, record it in `tests/characterization/expected-changes.mjs` the way that file's existing entries do, citing this plan.

- [ ] **Step 6: Run all three gates**

```bash
npm run build && npm test && npm run check
```
Expected: build clean, all tests pass, `check` reports 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/routes/api/portal/ src/routes/api/lessons/ tests/unit/game-links.test.mjs
git commit -m "$(cat <<'EOF'
Send game links out under a stable code

Both routes derive their links at read time, so switching the signed
reference from the display name to students_v2.code takes effect without
touching stored data, and links already in WhatsApp threads keep
verifying.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: The play page shows a name and remembers a best

**Files:**
- Modify: `src/routes/app/play/[template]/+page.server.ts:51-52`
- Modify: `src/lib/server/results.ts` (add `getBestById`)
- Test: `tests/unit/play-page.test.mjs` (create)

**Interfaces:**
- Consumes: `resolveStudent`, `studentRefById` (Task 1).
- Produces: `getBestById(studentId: number, dataId: string): number | null` in `results.ts`, reading `results_v2`.

**Why this matters:** with codes in links, `subject` would render `noga` where it renders `נוגה` today — an English code on a child-facing screen. And `getBest` keyed on the raw reference would reset every child's personal best the day their links change shape, which is the exact regression the comment at `+page.server.ts:10` says the server-side best exists to prevent.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/play-page.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'play-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const R = await import('../../src/lib/server/results.ts');

const acct = E.createAccount({ name: 'משפחה', credential: 'x' });
const noga = E.createStudent({ code: 'noga', name: 'נוגה', accountId: acct.id, credential: 'p' });

test('getBestById returns the highest score for that student and game', () => {
  R.writeResult({ studentId: noga.id, dataId: 'g1', template: 'quiz', score: 4, total: 10 });
  R.writeResult({ studentId: noga.id, dataId: 'g1', template: 'quiz', score: 9, total: 10 });
  R.writeResult({ studentId: noga.id, dataId: 'g1', template: 'quiz', score: 6, total: 10 });
  assert.equal(R.getBestById(noga.id, 'g1'), 9);
});

test('getBestById returns null for a game never played', () => {
  assert.equal(R.getBestById(noga.id, 'never-played'), null);
});

test("getBestById does not read another student's score", () => {
  const dan = E.createStudent({ code: 'dan', name: 'דן', accountId: acct.id, credential: 'p' });
  R.writeResult({ studentId: dan.id, dataId: 'g2', template: 'quiz', score: 10, total: 10 });
  assert.equal(R.getBestById(noga.id, 'g2'), null);
});

test('a best survives the link switching from a display name to a code', () => {
  // The regression this guards: a child plays under ?s=נוגה, links switch to
  // ?s=noga, and their personal best resets to nothing. Both references
  // resolve to the same id, so the best is the same.
  R.writeResult({ studentId: noga.id, dataId: 'g3', template: 'quiz', score: 8, total: 10 });
  const viaName = R.resolveStudent('נוגה');
  const viaCode = R.resolveStudent('noga');
  assert.equal(viaName, viaCode);
  assert.equal(R.getBestById(viaCode, 'g3'), 8);
});

test('a code resolves to the Hebrew display name for the page subtitle', () => {
  const id = R.resolveStudent('noga');
  assert.equal(R.studentRefById(id).name, 'נוגה');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern="getBestById|survives the link switching|resolves to the Hebrew display name"`
Expected: FAIL — `R.getBestById is not a function`.

- [ ] **Step 3: Add `getBestById`**

In `src/lib/server/results.ts`, beside the existing `getBest`:

```typescript
/**
 * Highest score for this student on this game, by id. The name-keyed getBest
 * above reads the legacy table and stays for callers that have only a name;
 * this one reads results_v2, so a child's best survives both a rename and the
 * switch of game links from display name to code.
 */
export function getBestById(studentId: number, dataId: string): number | null {
  const row = handle().prepare(
    `SELECT MAX(score) AS best FROM results_v2 WHERE student_id = ? AND data_id = ?`
  ).get(studentId, dataId) as { best: number | null } | undefined;
  return row?.best ?? null;
}
```

- [ ] **Step 4: Change the play page loader**

In `src/routes/app/play/[template]/+page.server.ts`, add to the imports:

```typescript
import { resolveStudent, studentRefById, getBestById } from '$server/results.ts';
```

After the signature check passes and before the return, resolve once:

```typescript
  /* `student` is whatever the signed link carries — a stable code on links
     built since this change, a display name on links already in a family's
     WhatsApp thread. Resolve once: the id keys the personal best, the name
     is what a child should see. Both fall back to the raw value, so an
     unresolvable old link renders exactly as it does today. */
  const studentId = resolveStudent(student);
  const ref = studentId === null ? null : studentRefById(studentId);
  const displayName = ref?.name ?? student;
```

Change the two fields in the returned object:

```typescript
    subject: [gameData.subject, displayName].filter(Boolean).join(' · '),
    best: studentId === null ? getBest(student, dataId) : getBestById(studentId, dataId),
```

Leave `student` in the returned object as the raw signed value — the client posts it back with the same `t`, so changing it would invalidate the submission's signature.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- --test-name-pattern="getBestById|survives the link switching|resolves to the Hebrew display name"`
Expected: PASS, 5 tests.

- [ ] **Step 6: Run all three gates**

```bash
npm run build && npm test && npm run check
```
Expected: build clean, all tests pass, `check` reports 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/results.ts "src/routes/app/play/[template]/+page.server.ts" tests/unit/play-page.test.mjs
git commit -m "$(cat <<'EOF'
Keep the child's name on screen and their best score intact

With codes in links the play page would greet a child in English and
show no personal best. It now resolves the reference once: the id keys
the best, the display name is what appears.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Browser proof

**Files:**
- No source changes. This task produces evidence.

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Build and start the app**

```bash
npm run build && npm test && npm run check
```
Then start the built server with a scratch database and a session secret, per `server/README.md`.

- [ ] **Step 2: Seed a student and a game link**

Create one student with a known code and Hebrew name, and derive a signed play URL for a game data file that exists under the content directory (see `src/lib/server/content.ts` for where `games-data` is read from).

- [ ] **Step 3: Play the game in a real browser**

Use the Playwright MCP tools. Open the signed link, confirm the subtitle shows the **Hebrew name** and not the code, complete the game so it posts a result.

- [ ] **Step 4: Assert the row is id-keyed**

Query the scratch database:

```bash
sqlite3 "$DB_PATH" "SELECT student_id, data_id, score FROM results_v2 ORDER BY id DESC LIMIT 1;"
sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM results;"
```
Expected: a `results_v2` row carrying the seeded student's id, and no new legacy row.

- [ ] **Step 5: Confirm the tutor still sees it**

Sign in to the dashboard and confirm the play appears under the child's Hebrew name.

- [ ] **Step 6: Capture the evidence**

Save the screenshots and the query output into the task report. Per the session's working agreement this proof is required before the PR goes up.

---

## Self-Review

**Spec coverage.** §4.1 resolution → Task 1. §4.2 migration and the boot trap → Task 2 (boot trap has its own test plus a deliberate-failure proof). §4.3 write path → Task 4. §4.4 links → Task 5. §4.5 display and best → Task 6. §4.6 union → Task 3. §5 testing → each task's tests, plus Task 7 for the browser proof. §6 gates → Global Constraints and every task's gate step. No spec section is unimplemented.

**Placeholder scan.** No TBDs. Every code step carries real code. Task 7 is deliberately procedural rather than code — it is a manual browser proof, and its assertions are exact.

**Type consistency.** `resolveStudent(ref: string): number | null` and `studentRefById(id: number): { code: string; name: string } | null` are defined in Task 1 and used with those exact signatures in Tasks 4, 5 and 6. `getBestById(studentId: number, dataId: string): number | null` is defined and used in Task 6. `writeResultV2` is the import alias for `results.ts`'s existing `writeResult`, whose input property is `studentId` (not `student`) — matching `src/lib/server/results.ts:21`.

**One risk left standing.** Task 5's characterization step may surface a recorded-response diff. That is a genuine review decision, not a mechanical re-record, and the task says so.
