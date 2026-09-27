# Lesson Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After each lesson the tutor ticks the skills she covered and sets a status on each, and the student's learning plan moves as a result — prompted by a dashboard queue and by one email per finished lesson.

**Architecture:** A report is one row per booking plus one `plan_events` row per skill, written in a single transaction with `source = 'report'` and a link back to the report. The queue is a query over bookings with no report, so it holds no state of its own. The email comes from a new secret-authenticated endpoint driven by a `systemd --user` timer built like the existing backup timer, which also revives the long-dead `/api/remind`.

**Tech Stack:** SvelteKit 2 (Svelte 5 runes, `adapter-node`), TypeScript, `node:sqlite`, nodemailer, `node --test`, systemd user timers. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-13-lesson-report-design.md` (read it before Task 1; it builds on `2026-09-12-learning-plan-design.md`, already shipped)

## Global Constraints

- Node `>=22.18`. Unit tests import `.ts` sources directly and rely on Node's type stripping.
- No new runtime or dev dependencies. Browser checks are ad-hoc scripts in /tmp, never committed.
- **Inside `src/lib/server/**` use relative imports only** (`./db.ts`, `../../plan-status.ts`) — unit tests import these files under plain Node where Vite aliases do not resolve. Route files under `src/routes/**` use `$server`/`$lib` normally.
- Row shapes read out of SQLite are declared as `type` aliases, never `interface`: TypeScript gives an alias an implicit index signature and an interface none, so only the alias form can be cast from a `node:sqlite` row.
- Every UI string is Hebrew. Pages are RTL, phone-first, must work at 320px with no horizontal scroll, and every tappable control is at least 44px tall.
- Status is never communicated by colour alone. Use existing tokens only.
- CSP is enforced: no new inline `<script>`, no new remote origins.
- Saving is never optimistic: write, then render what the server returned.
- `/api/reports` and `/app/report/*` are tutor-only. `/api/reports/prompt` is secret-only. No report data may appear in `/api/portal`, `/app/parent` or `/app/student`.
- Characterization tests spawn the production build: run `npm run build` before them, every time server code changes.
- The harness blocks `GMAIL_USER`/`GMAIL_APP_PASSWORD`, so `transport()` returns null and every sender returns `false` in tests. Never assert that an email was *sent* in a characterization test; assert selection counts and prove idempotence at the store level instead.
- Tests use invented names only. Never read `mea-beclick-kb/` (real student PII).
- `npm test` and `npm run check` (0 errors, 34 pre-existing warnings) must pass before every commit.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/server/migrations/005_lesson_reports.ts` | Schema: two tables, plus the `plan_events` rebuild. |
| `src/lib/server/reports/store.ts` | All report SQL: filing, the queue, prompt selection. |
| `src/routes/api/reports/+server.ts` | `POST` file or correct a report (tutor-only). |
| `src/routes/api/reports/prompt/+server.ts` | `POST` send prompts (secret-only). |
| `src/lib/server/email.ts` | Gains `sendReportPromptEmail`. |
| `src/lib/server/auth.ts`, `src/routes/login/+page.svelte` | The `?next=` return path. |
| `src/routes/app/report/[booking]/+page.server.ts` / `+page.svelte` | The form. |
| `src/lib/components/ReportQueue.svelte` | The dashboard banner. |
| `server/meabeclick-report-prompt.{service,timer}`, `server/meabeclick-remind.{service,timer}` | Scheduling. |

---

### Task 1: Schema

**Files:**
- Create: `src/lib/server/migrations/005_lesson_reports.ts`
- Modify: `src/lib/server/migrations/list.ts`
- Test: `tests/unit/report-schema.test.mjs`

**Interfaces:**
- Consumes: `migrate()` from `migrations/index.ts`; the tables of migration 004.
- Produces: `lesson_reports`, `report_prompts`, and a rebuilt `plan_events` carrying `report_id` and `source IN ('teacher','report')`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/report-schema.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../../src/lib/server/migrations/index.ts';
import { MIGRATIONS } from '../../src/lib/server/migrations/list.ts';

async function freshDb() {
  const dir = await mkdtemp(join(tmpdir(), 'report-schema-'));
  const db = new DatabaseSync(join(dir, 'test.db'));
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

/** Account → student → enrollment → booking → plan → one skill node. */
function seed(db) {
  db.prepare(`INSERT INTO accounts (name, phone, credential, is_self, created_at)
              VALUES ('משפחת כהן', NULL, 'x', 0, '2026-01-01T00:00:00.000Z')`).run();
  const accountId = db.prepare(`SELECT id FROM accounts ORDER BY id DESC LIMIT 1`).get().id;
  db.prepare(`INSERT INTO students_v2 (code, name, account_id, credential, created_at)
              VALUES ('yuval', 'יובל', ?, 'x', '2026-01-01T00:00:00.000Z')`).run(accountId);
  const studentId = db.prepare(`SELECT id FROM students_v2 WHERE code = 'yuval'`).get().id;
  db.prepare(`INSERT INTO enrollments (student_id, subject, level) VALUES (?, 'מתמטיקה', 'כיתה יא')`).run(studentId);
  const enrollmentId = db.prepare(`SELECT id FROM enrollments WHERE student_id = ?`).get(studentId).id;
  db.prepare(`INSERT INTO bookings_v2 (student_id, enrollment_id, start, "end", duration, at, status)
              VALUES (?, ?, '2026-06-01T14:00:00.000Z', '2026-06-01T15:30:00.000Z', 90, '2026-05-01T00:00:00.000Z', 'confirmed')`)
    .run(studentId, enrollmentId);
  const bookingId = db.prepare(`SELECT id FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get().id;
  db.prepare(`INSERT INTO plans (student_id, enrollment_id, template_id, template_version, goal, created_at)
              VALUES (?, ?, 'math-5u', 1, 'בגרות', '2026-05-02T00:00:00.000Z')`).run(studentId, enrollmentId);
  const planId = db.prepare(`SELECT id FROM plans ORDER BY id DESC LIMIT 1`).get().id;
  db.prepare(`INSERT INTO plan_nodes (plan_id, key, parent_id, kind, title, position)
              VALUES (?, 'calc.rules.power', NULL, 'skill', 'חוקי חזקות', 0)`).run(planId);
  const nodeId = db.prepare(`SELECT id FROM plan_nodes ORDER BY id DESC LIMIT 1`).get().id;
  return { studentId, enrollmentId, bookingId, planId, nodeId };
}

test('migration 005 adds the report tables', async () => {
  const db = await freshDb();
  migrate(db);
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r => r.name);
  for (const t of ['lesson_reports', 'report_prompts']) assert.ok(tables.includes(t), `expected ${t}`);
});

test('a booking can be reported once', async () => {
  const db = await freshDb();
  migrate(db);
  const { studentId, enrollmentId, bookingId } = seed(db);
  const file = () => db.prepare(
    `INSERT INTO lesson_reports (booking_id, student_id, enrollment_id, note, created_at, updated_at)
     VALUES (?, ?, ?, 'הערה', '2026-06-01T16:00:00.000Z', '2026-06-01T16:00:00.000Z')`
  ).run(bookingId, studentId, enrollmentId);
  file();
  assert.throws(file, /UNIQUE/i, 'a second report for the same lesson must be refused');
});

test('a lesson is prompted at most once', async () => {
  const db = await freshDb();
  migrate(db);
  const { bookingId } = seed(db);
  const mark = () => db.prepare(`INSERT INTO report_prompts (booking_id, sent_at) VALUES (?, '2026-06-01T16:00:00.000Z')`).run(bookingId);
  mark();
  assert.throws(mark, /UNIQUE|PRIMARY/i);
});

test('plan_events accepts the report source and rejects anything else', async () => {
  const db = await freshDb();
  migrate(db);
  const { studentId, enrollmentId, bookingId, planId, nodeId } = seed(db);
  db.prepare(`INSERT INTO lesson_reports (booking_id, student_id, enrollment_id, created_at, updated_at)
              VALUES (?, ?, ?, '2026-06-01T16:00:00.000Z', '2026-06-01T16:00:00.000Z')`).run(bookingId, studentId, enrollmentId);
  const reportId = db.prepare(`SELECT id FROM lesson_reports ORDER BY id DESC LIMIT 1`).get().id;

  db.prepare(`INSERT INTO plan_events (plan_id, node_id, type, status, source, report_id, at)
              VALUES (?, ?, 'status', 'guided', 'report', ?, '2026-06-01T16:00:00.000Z')`).run(planId, nodeId, reportId);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM plan_events WHERE source = 'report'`).get().n, 1);

  assert.throws(() => db.prepare(
    `INSERT INTO plan_events (plan_id, node_id, type, status, source, at)
     VALUES (?, ?, 'status', 'guided', 'robot', '2026-06-01T16:00:00.000Z')`
  ).run(planId, nodeId), /CHECK/i, 'an unknown source must still be rejected');
});

test('the rebuild preserves events written before it', async () => {
  // Apply everything up to 004, write an event, then apply 005 and read it back.
  const db = await freshDb();
  const upTo4 = MIGRATIONS.filter(m => m.version <= 4).sort((a, b) => a.version - b.version);
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
  for (const m of upTo4) {
    db.exec(m.sql);
    db.prepare(`INSERT INTO schema_version (version, applied_at) VALUES (?, ?)`).run(m.version, '2026-01-01');
  }
  const { planId, nodeId } = seed(db);
  db.prepare(`INSERT INTO plan_events (plan_id, node_id, type, status, note, evidence, source, at)
              VALUES (?, ?, 'status', 'independent', 'לפני המיגרציה', 'lesson', 'teacher', '2026-05-05T00:00:00.000Z')`)
    .run(planId, nodeId);

  migrate(db); // applies 005 only

  const row = db.prepare(`SELECT * FROM plan_events WHERE note = 'לפני המיגרציה'`).get();
  assert.ok(row, 'the pre-existing event survived the rebuild');
  assert.equal(row.status, 'independent');
  assert.equal(row.evidence, 'lesson');
  assert.equal(row.source, 'teacher');
  assert.equal(row.at, '2026-05-05T00:00:00.000Z');
  assert.equal(row.report_id, null);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/unit/report-schema.test.mjs`
Expected: FAIL — `no such table: lesson_reports`.

- [ ] **Step 3: Write the migration**

Create `src/lib/server/migrations/005_lesson_reports.ts`:

```ts
/**
 * Migration 005 — the end-of-lesson report.
 *
 * A report is one row per BOOKING (a lesson's identity is its booking), and
 * the skills it moves are ordinary plan_events carrying source='report' and
 * the report's id. That is why plan_events has to be rebuilt: SQLite cannot
 * alter a CHECK in place, and source was constrained to 'teacher' alone.
 *
 * The rebuild follows 003_payment_kinds.ts and is safe for the same stated
 * reason: NOTHING references plan_events, so dropping it orphans no child
 * rows. Do NOT copy this procedure onto a table that IS referenced — there
 * the rebuild has to happen outside the transaction (003 explains why).
 * The INSERT lists its columns rather than SELECT *, so a column added to
 * one table and not the other fails loudly instead of shifting values.
 *
 * report_prompts is deliberately NOT part of lesson_reports: the queue is
 * defined by the ABSENCE of a report, so recording "she has been emailed
 * about this lesson" must not create one.
 */
export const sql = `
CREATE TABLE lesson_reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id    INTEGER NOT NULL UNIQUE REFERENCES bookings_v2(id),
  student_id    INTEGER NOT NULL REFERENCES students_v2(id),
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id),
  note          TEXT,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);

CREATE TABLE report_prompts (
  booking_id INTEGER PRIMARY KEY REFERENCES bookings_v2(id),
  sent_at    TEXT    NOT NULL
);

CREATE TABLE plan_events_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id    INTEGER NOT NULL REFERENCES plans(id),
  node_id    INTEGER REFERENCES plan_nodes(id),
  type       TEXT    NOT NULL
             CHECK (type IN ('created', 'status', 'visibility', 'move', 'goal')),
  status     TEXT    CHECK (status IN ('not_checked', 'started', 'guided', 'with_help', 'independent', 'needs_review')),
  visibility TEXT    CHECK (visibility IN ('active', 'paused', 'hidden')),
  note       TEXT,
  evidence   TEXT    CHECK (evidence IN ('lesson', 'homework', 'game', 'test', 'other')),
  source     TEXT    NOT NULL DEFAULT 'teacher' CHECK (source IN ('teacher', 'report')),
  report_id  INTEGER REFERENCES lesson_reports(id),
  at         TEXT    NOT NULL
);

INSERT INTO plan_events_new (id, plan_id, node_id, type, status, visibility, note, evidence, source, at)
SELECT id, plan_id, node_id, type, status, visibility, note, evidence, source, at FROM plan_events;

DROP TABLE plan_events;
ALTER TABLE plan_events_new RENAME TO plan_events;

CREATE INDEX plan_events_node ON plan_events (node_id, id);
CREATE INDEX lesson_reports_booking ON lesson_reports (booking_id);
`;
```

- [ ] **Step 4: Register it**

In `src/lib/server/migrations/list.ts`, add `import { sql as sql005 } from './005_lesson_reports.ts';` beside the others and `{ version: 5, name: '005_lesson_reports', sql: sql005 },` at the end of `MIGRATIONS`.

- [ ] **Step 5: Run the tests**

Run: `node --test tests/unit/report-schema.test.mjs tests/unit/plan-schema.test.mjs tests/unit/migrations.test.mjs`
Expected: PASS. Then `npm test` — the existing plan tests must be unaffected by the rebuild.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/migrations/005_lesson_reports.ts src/lib/server/migrations/list.ts tests/unit/report-schema.test.mjs
git commit -m "Add the lesson-report schema

A report per booking, a record of which lessons have been emailed about,
and a rebuilt plan_events that accepts a second source and remembers
which report moved a skill. The rebuild is 003's procedure and carries
003's warning: nothing references plan_events, which is the only reason
it is safe here.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The report store and the queue

**Files:**
- Create: `src/lib/server/reports/store.ts`
- Test: `tests/unit/report-store.test.mjs`

**Interfaces:**
- Consumes: `handle()` from `../db.ts`; `SkillStatus` from `../../plan-status.ts`; `nodeInPlan`, `planForEnrollment` from `../plans/store.ts`.
- Produces:
  - `type ReportRow = { id, booking_id, student_id, enrollment_id, note, created_at, updated_at }`
  - `type PendingLesson = { bookingId, studentId, studentCode, studentName, subject, enrollmentId, start, end }`
  - `fileReport(input: { bookingId: number; note: string | null; entries: { nodeId: number; status: SkillStatus }[] }): number`
  - `reportForBooking(bookingId: number): ReportRow | null`
  - `bookingForReport(bookingId: number): { id, student_id, enrollment_id, start, end, status } | null`
  - `lessonsAwaitingReport(nowIso: string, sinceIso: string): PendingLesson[]`
  - `promptCandidates(nowIso: string): PendingLesson[]`
  - `markPrompted(bookingId: number, nowIso?: string): void`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/report-store.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'report-store-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const P = await import('../../src/lib/server/plans/store.ts');
const R = await import('../../src/lib/server/reports/store.ts');
const { handle } = await import('../../src/lib/server/db.ts');

const template = {
  id: 'demo', version: 1, subject: 'מתמטיקה', track: '5 יח״ל', reviewed: null,
  topics: [{ key: 't', title: 'נושא', branches: [{ key: 't.b', title: 'ענף', skills: [
    { key: 't.b.a', title: 'חוקי חזקות', requires: [] },
    { key: 't.b.b', title: 'כלל המנה', requires: ['t.b.a'] },
  ] }] }],
};

let seq = 0;
/** A student with a plan and one booking at the given times. */
function scenario({ start, end, status = 'confirmed' }) {
  seq += 1;
  const account = E.createAccount({ name: `משפחה ${seq}`, phone: null, credential: 'x' });
  const student = E.createStudent({ code: `kid${seq}`, name: `תלמיד ${seq}`, accountId: account.id, credential: 'x' });
  E.upsertEnrollment({ studentId: student.id, subject: 'מתמטיקה', level: 'כיתה יא', teacherId: null });
  const enrollment = E.enrollmentsForStudent(student.id)[0];
  handle().prepare(
    `INSERT INTO bookings_v2 (student_id, enrollment_id, start, "end", duration, at, status)
     VALUES (?, ?, ?, ?, 90, '2026-05-01T00:00:00.000Z', ?)`
  ).run(student.id, enrollment.id, start, end, status);
  const bookingId = Number(handle().prepare(`SELECT id FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get().id);
  const planId = P.createPlan({ studentId: student.id, enrollmentId: enrollment.id, template, goal: 'בגרות' });
  const skills = P.planData(planId).nodes.filter(n => n.kind === 'skill');
  return { student, enrollment, bookingId, planId, skills };
}

const NOW = '2026-06-01T18:00:00.000Z';
const past = { start: '2026-06-01T14:00:00.000Z', end: '2026-06-01T15:30:00.000Z' };
const future = { start: '2026-06-02T14:00:00.000Z', end: '2026-06-02T15:30:00.000Z' };
const WINDOW = '2026-05-18T00:00:00.000Z'; // 14 days back

test('a finished lesson with no report is awaiting one', () => {
  const s = scenario(past);
  const pending = R.lessonsAwaitingReport(NOW, WINDOW);
  assert.ok(pending.some(p => p.bookingId === s.bookingId));
});

test('a future lesson, a cancelled one, and a reported one are not', () => {
  const soon = scenario(future);
  const cancelled = scenario({ ...past, status: 'cancelled' });
  const done = scenario(past);
  R.fileReport({ bookingId: done.bookingId, note: null, entries: [] });

  const ids = R.lessonsAwaitingReport(NOW, WINDOW).map(p => p.bookingId);
  assert.ok(!ids.includes(soon.bookingId), 'a lesson that has not happened yet');
  assert.ok(!ids.includes(cancelled.bookingId), 'a cancelled lesson');
  assert.ok(!ids.includes(done.bookingId), 'a lesson already reported');
});

test('filing writes the report and one event per skill, in one transaction', () => {
  const s = scenario(past);
  const reportId = R.fileReport({
    bookingId: s.bookingId,
    note: 'נתקעה בשברים',
    entries: [
      { nodeId: s.skills[0].id, status: 'independent' },
      { nodeId: s.skills[1].id, status: 'guided' },
    ],
  });

  const report = R.reportForBooking(s.bookingId);
  assert.equal(report.id, reportId);
  assert.equal(report.note, 'נתקעה בשברים');

  const events = P.planData(s.planId).events.filter(e => e.type === 'status');
  assert.equal(events.length, 2);
  for (const e of events) {
    assert.equal(e.source, 'report');
    assert.equal(e.report_id, reportId);
    assert.equal(e.evidence, 'lesson');
  }
});

test('a note-only report is valid and moves nothing', () => {
  const s = scenario(past);
  R.fileReport({ bookingId: s.bookingId, note: 'שיחה על חרדת מבחנים', entries: [] });
  assert.ok(R.reportForBooking(s.bookingId));
  assert.equal(P.planData(s.planId).events.filter(e => e.type === 'status').length, 0);
});

test('a correction appends events and never deletes', () => {
  const s = scenario(past);
  R.fileReport({ bookingId: s.bookingId, note: 'ראשון', entries: [{ nodeId: s.skills[0].id, status: 'guided' }] });
  R.fileReport({ bookingId: s.bookingId, note: 'תיקון', entries: [{ nodeId: s.skills[0].id, status: 'needs_review' }] });

  const events = P.planData(s.planId).events.filter(e => e.type === 'status');
  assert.equal(events.length, 2, 'both judgements survive');
  assert.equal(events.at(-1).status, 'needs_review');
  assert.equal(R.reportForBooking(s.bookingId).note, 'תיקון');
  assert.equal(handle().prepare(`SELECT COUNT(*) AS n FROM lesson_reports WHERE booking_id = ?`).get(s.bookingId).n, 1);
});

test('a failed filing leaves neither the report nor its events', () => {
  const s = scenario(past);
  assert.throws(() => R.fileReport({
    bookingId: s.bookingId, note: null,
    entries: [{ nodeId: s.skills[0].id, status: 'guided' }, { nodeId: 999999, status: 'guided' }],
  }));
  assert.equal(R.reportForBooking(s.bookingId), null);
  assert.equal(P.planData(s.planId).events.filter(e => e.type === 'status').length, 0);
});

test('prompt candidates respect the 30-minute and 3-day windows', () => {
  const justEnded = scenario({ start: '2026-06-01T17:00:00.000Z', end: '2026-06-01T17:50:00.000Z' }); // 10 min ago
  const ready = scenario(past);                                                                        // 2.5 h ago
  const stale = scenario({ start: '2026-05-20T14:00:00.000Z', end: '2026-05-20T15:30:00.000Z' });      // 12 days ago

  const ids = R.promptCandidates(NOW).map(p => p.bookingId);
  assert.ok(!ids.includes(justEnded.bookingId), 'a lesson that may still be running');
  assert.ok(ids.includes(ready.bookingId));
  assert.ok(!ids.includes(stale.bookingId), 'too old to chase');
});

test('a lesson is offered for prompting once', () => {
  const s = scenario(past);
  assert.ok(R.promptCandidates(NOW).some(p => p.bookingId === s.bookingId));
  R.markPrompted(s.bookingId, NOW);
  assert.ok(!R.promptCandidates(NOW).some(p => p.bookingId === s.bookingId));
});

test('pending lessons carry what the queue and the email need', () => {
  const s = scenario(past);
  const row = R.lessonsAwaitingReport(NOW, WINDOW).find(p => p.bookingId === s.bookingId);
  assert.equal(row.studentCode, s.student.code);
  assert.equal(row.studentName, s.student.name);
  assert.equal(row.subject, 'מתמטיקה');
  assert.equal(row.enrollmentId, s.enrollment.id);
  assert.equal(row.end, past.end);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/unit/report-store.test.mjs`
Expected: FAIL — cannot find module `reports/store.ts`.

- [ ] **Step 3: Write the store**

Create `src/lib/server/reports/store.ts`:

```ts
/**
 * The end-of-lesson report: filing it, and finding the lessons that still
 * need one.
 *
 * The queue holds no state. "Awaiting a report" is a question asked of
 * bookings and lesson_reports every time, so it cannot drift out of step
 * with reality — filing removes a lesson from it, cancelling removes it too.
 *
 * Filing writes the report row and every skill event inside ONE transaction:
 * a lesson marked reported without the events it claims to have produced is
 * a record that lies.
 */
import { handle } from '../db.ts';
import type { SkillStatus } from '../../plan-status.ts';

export type ReportRow = {
  id: number; booking_id: number; student_id: number; enrollment_id: number;
  note: string | null; created_at: string; updated_at: string;
};

export type BookingRow = {
  id: number; student_id: number; enrollment_id: number | null;
  start: string; end: string; status: string;
};

export type PendingLesson = {
  bookingId: number; studentId: number; studentCode: string; studentName: string;
  subject: string; enrollmentId: number | null; start: string; end: string;
};

/** A lesson may still be running; do not chase one that just ended. */
const SETTLE_MS = 30 * 60 * 1000;
/** After this, an unreported lesson stops being chased by email. */
const CHASE_MS = 3 * 24 * 60 * 60 * 1000;

const now = (): string => new Date().toISOString();
const shift = (iso: string, ms: number): string => new Date(new Date(iso).getTime() + ms).toISOString();

const PENDING_SELECT = `
  SELECT b.id            AS bookingId,
         b.student_id    AS studentId,
         s.code          AS studentCode,
         s.name          AS studentName,
         e.subject       AS subject,
         b.enrollment_id AS enrollmentId,
         b.start         AS start,
         b."end"         AS "end"
    FROM bookings_v2 b
    JOIN students_v2 s ON s.id = b.student_id
    LEFT JOIN enrollments e ON e.id = b.enrollment_id
   WHERE b.status = 'confirmed'
     AND NOT EXISTS (SELECT 1 FROM lesson_reports r WHERE r.booking_id = b.id)
`;

/** Finished, unreported lessons — newest first — no older than `sinceIso`. */
export function lessonsAwaitingReport(nowIso: string = now(), sinceIso: string): PendingLesson[] {
  return handle().prepare(
    `${PENDING_SELECT} AND b."end" <= ? AND b."end" >= ? ORDER BY b."end" DESC`
  ).all(nowIso, sinceIso) as PendingLesson[];
}

/** Lessons to email about: settled, not stale, not already emailed. */
export function promptCandidates(nowIso: string = now()): PendingLesson[] {
  return handle().prepare(
    `${PENDING_SELECT}
       AND b."end" <= ?
       AND b."end" >= ?
       AND NOT EXISTS (SELECT 1 FROM report_prompts p WHERE p.booking_id = b.id)
     ORDER BY b."end" ASC`
  ).all(shift(nowIso, -SETTLE_MS), shift(nowIso, -CHASE_MS)) as PendingLesson[];
}

export function markPrompted(bookingId: number, nowIso: string = now()): void {
  handle().prepare(
    `INSERT OR IGNORE INTO report_prompts (booking_id, sent_at) VALUES (?, ?)`
  ).run(bookingId, nowIso);
}

export function bookingForReport(bookingId: number): BookingRow | null {
  return (handle().prepare(
    `SELECT id, student_id, enrollment_id, start, "end" AS end, status FROM bookings_v2 WHERE id = ?`
  ).get(bookingId) as BookingRow) ?? null;
}

export function reportForBooking(bookingId: number): ReportRow | null {
  return (handle().prepare(`SELECT * FROM lesson_reports WHERE booking_id = ?`).get(bookingId) as ReportRow) ?? null;
}

/**
 * Files a report, or corrects one. Returns the report id.
 *
 * A correction updates the row's note and APPENDS its events — the plan's
 * history is what she thought then and what she thinks now, never a rewrite.
 * Every event carries evidence 'lesson': the tutor watched it happen.
 */
export function fileReport(input: {
  bookingId: number; note: string | null;
  entries: { nodeId: number; status: SkillStatus }[];
}): number {
  const db = handle();
  const booking = bookingForReport(input.bookingId);
  if (!booking) throw new Error(`no booking ${input.bookingId}`);

  db.exec('BEGIN');
  try {
    const at = now();
    const existing = reportForBooking(input.bookingId);
    let reportId: number;

    if (existing) {
      db.prepare(`UPDATE lesson_reports SET note = ?, updated_at = ? WHERE id = ?`)
        .run(input.note, at, existing.id);
      reportId = existing.id;
    } else {
      db.prepare(
        `INSERT INTO lesson_reports (booking_id, student_id, enrollment_id, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(input.bookingId, booking.student_id, booking.enrollment_id, input.note, at, at);
      reportId = Number((db.prepare(`SELECT last_insert_rowid() AS id`).get() as { id: number }).id);
    }

    const insertEvent = db.prepare(
      `INSERT INTO plan_events (plan_id, node_id, type, status, note, evidence, source, report_id, at)
       SELECT plan_id, id, 'status', ?, NULL, 'lesson', 'report', ?, ?
         FROM plan_nodes WHERE id = ? AND kind = 'skill'`
    );
    for (const entry of input.entries) {
      const info = insertEvent.run(entry.status, reportId, at, entry.nodeId);
      // The SELECT yields no row for a node that does not exist or is not a
      // skill, so nothing is written — which would silently drop a judgement
      // the tutor believes she recorded.
      if (info.changes === 0) throw new Error(`node ${entry.nodeId} is not a skill in any plan`);
    }

    db.exec('COMMIT');
    return reportId;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/unit/report-store.test.mjs`
Expected: PASS, 9 tests. Then `npm test` and `npm run check`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/reports/store.ts tests/unit/report-store.test.mjs
git commit -m "Store lesson reports, and ask which lessons still need one

Filing writes the report row and one plan event per skill in a single
transaction, so a lesson can never be marked reported without the
judgements it claims. A correction updates the note and appends new
events rather than rewriting the old ones.

The queue is a question, not a table: a confirmed booking that has ended
and has no report. It cannot drift, and cancelling a lesson removes it
for free.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The filing endpoint

**Files:**
- Create: `src/routes/api/reports/+server.ts`
- Test: `tests/characterization/report-api.test.mjs`

**Interfaces:**
- Consumes: `apiAuthDenied`, `readJson`; `fileReport`, `reportForBooking`, `bookingForReport` from `$server/reports/store.ts`; `planForEnrollment`, `planData`, `lastLessonAt`, `nodeInPlan` from `$server/plans/store.ts`; `buildTree` from `$server/plans/view.ts`; `STATUSES` from `$lib/plan-status.ts`.
- Produces: `POST /api/reports` → `{ report, plan, tree, events }`.

- [ ] **Step 1: Write the failing test**

Create `tests/characterization/report-api.test.mjs`:

```js
// Filing a report is the one write in the product that records a judgement
// about a child from outside the plan page, so these pin who may do it and
// what a malformed one does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login, familySession } from './harness.mjs';

const book = (baseUrl, over = {}) => fetch(`${baseUrl}/api/book`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'יובל כהן', subject: 'מתמטיקה', level: 'כיתה יא',
    phone: '0501234567', email: 'orit@example.com', durationMin: 90,
    start: '2027-03-15T10:00:00+02:00', end: '2027-03-15T11:30:00+02:00',
    ...over,
  }),
}).then(r => r.json());

const post = (url, body, cookie) => fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify(body),
});

/** Books a lesson IN THE PAST (so it is reportable), creates a plan, and
 *  returns the ids the tests need. The booking API refuses a past slot, so
 *  the row is aged with a direct UPDATE through the test's own DB path. */
async function pastLesson(baseUrl, dbPath) {
  const booked = await book(baseUrl);
  const cookie = await login(baseUrl);
  const created = await (await post(`${baseUrl}/api/plans`, {
    code: booked.portal.code, subject: 'מתמטיקה', templateId: 'math-5u', goal: 'בגרות',
  }, cookie)).json();

  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath);
  db.prepare(`UPDATE bookings_v2 SET start = '2026-01-05T10:00:00.000Z', "end" = '2026-01-05T11:30:00.000Z'`).run();
  const bookingId = Number(db.prepare(`SELECT id FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get().id);
  db.close();

  const skill = created.tree[0].branches[0].skills[0];
  return { booked, cookie, bookingId, skill, planId: created.plan.id };
}

test('the tutor files a report and the plan moves', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const { cookie, bookingId, skill } = await pastLesson(baseUrl, dbPath);
    const res = await post(`${baseUrl}/api/reports`, {
      bookingId, note: 'נתקעה בשברים', entries: [{ nodeId: skill.id, status: 'guided' }],
    }, cookie);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.report.note, 'נתקעה בשברים');
    assert.equal(body.tree[0].branches[0].skills[0].status, 'guided');
    const written = body.events.filter(e => e.type === 'status');
    assert.equal(written.length, 1);
    assert.equal(written[0].source, 'report');
  } finally { await stop(); }
});

test('a note-only report is accepted', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const { cookie, bookingId } = await pastLesson(baseUrl, dbPath);
    const res = await post(`${baseUrl}/api/reports`, { bookingId, note: 'שיחה בלבד', entries: [] }, cookie);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).report.note, 'שיחה בלבד');
  } finally { await stop(); }
});

test('a lesson that has not happened yet cannot be reported', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const booked = await book(baseUrl);
    const cookie = await login(baseUrl);
    await post(`${baseUrl}/api/plans`, {
      code: booked.portal.code, subject: 'מתמטיקה', templateId: 'math-5u', goal: 'בגרות',
    }, cookie);
    // The booking is in 2027 and was never aged.
    const res = await post(`${baseUrl}/api/reports`, { bookingId: 1, note: 'מוקדם מדי', entries: [] }, cookie);
    assert.equal(res.status, 400);
  } finally { await stop(); }
});

test('malformed entries are refused, and nothing is written', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const { cookie, bookingId, skill } = await pastLesson(baseUrl, dbPath);
    const url = `${baseUrl}/api/reports`;

    assert.equal((await post(url, { bookingId, entries: [{ nodeId: skill.id, status: 'mastered' }] }, cookie)).status, 400);
    assert.equal((await post(url, { bookingId, entries: [{ nodeId: skill.id }] }, cookie)).status, 400, 'a ticked skill with no status');
    assert.equal((await post(url, { bookingId, note: 'x'.repeat(2001), entries: [] }, cookie)).status, 400);
    assert.equal((await post(url, { bookingId: 999999, entries: [] }, cookie)).status, 404);
    assert.equal((await post(url, { bookingId, entries: [{ nodeId: 999999, status: 'guided' }] }, cookie)).status, 404);

    // After every refusal, the lesson is still unreported.
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM lesson_reports`).get().n, 0);
    db.close();
  } finally { await stop(); }
});

test("a node from another student's plan is refused", async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const mine = await pastLesson(baseUrl, dbPath);
    const theirs = await book(baseUrl, {
      name: 'דנה לוי', email: 'dana@example.com',
      start: '2027-03-17T10:00:00+02:00', end: '2027-03-17T11:30:00+02:00',
    });
    const other = await (await post(`${baseUrl}/api/plans`, {
      code: theirs.portal.code, subject: 'מתמטיקה', templateId: 'math-4u', goal: 'בגרות',
    }, mine.cookie)).json();
    const foreign = other.tree[0].branches[0].skills[0];

    const res = await post(`${baseUrl}/api/reports`, {
      bookingId: mine.bookingId, entries: [{ nodeId: foreign.id, status: 'guided' }],
    }, mine.cookie);
    assert.equal(res.status, 404, "one lesson's report may not move another student's plan");
  } finally { await stop(); }
});

test('filing is tutor-only', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const { booked, bookingId, cookie } = await pastLesson(baseUrl, dbPath);
    const family = await familySession(booked.portal.link);
    for (const who of [undefined, family]) {
      assert.equal((await post(`${baseUrl}/api/reports`, { bookingId, entries: [] }, who)).status, 401);
    }
    assert.equal((await post(`${baseUrl}/api/reports`, { bookingId, entries: [] }, cookie)).status, 200);
  } finally { await stop(); }
});

test('no report reaches the family', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const { booked, bookingId, cookie } = await pastLesson(baseUrl, dbPath);
    await post(`${baseUrl}/api/reports`, { bookingId, note: 'הערה פנימית', entries: [] }, cookie);
    const family = await familySession(booked.portal.link);

    for (const url of [
      `${baseUrl}/api/portal/${booked.portal.code}?kind=parent`,
      `${baseUrl}/api/portal/${booked.portal.code}?kind=student`,
      `${baseUrl}/app/parent`,
    ]) {
      const text = await (await fetch(url, { headers: { Cookie: family } })).text();
      assert.doesNotMatch(text, /הערה פנימית/, `${url} leaked the report note`);
    }
  } finally { await stop(); }
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run build && node --test tests/characterization/report-api.test.mjs`
Expected: FAIL — the route 404s.

- [ ] **Step 3: Write the endpoint**

Create `src/routes/api/reports/+server.ts`:

```ts
/**
 * Filing (or correcting) one lesson's report. Tutor-only.
 *
 * Returns the refreshed plan view alongside the report, so the page that
 * posted it can show what the report moved without a second request — and
 * so nothing on screen is ever a guess about what was written.
 */
import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { readJson } from '$server/http.ts';
import { STATUSES, type SkillStatus } from '$lib/plan-status.ts';
import { fileReport, reportForBooking, bookingForReport } from '$server/reports/store.ts';
import { planForEnrollment, planData, nodeInPlan, lastLessonAt } from '$server/plans/store.ts';
import { buildTree } from '$server/plans/view.ts';
import type { RequestHandler } from './$types';

const NOT_FOUND = { error: 'לא נמצא' };
const MAX_NOTE = 2000;

export const POST: RequestHandler = async (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;

  const parsed = await readJson(event.request);
  if (parsed instanceof Response) return parsed;
  const body = parsed as Record<string, unknown>;

  const booking = bookingForReport(Number(body.bookingId));
  if (!booking) return json(NOT_FOUND, { status: 404 });
  if (booking.status !== 'confirmed') return json({ error: 'השיעור בוטל' }, { status: 400 });
  if (booking.end > new Date().toISOString()) {
    return json({ error: 'אי אפשר לדווח על שיעור שטרם הסתיים' }, { status: 400 });
  }

  const note = body.note == null ? null : String(body.note);
  if (note !== null && note.length > MAX_NOTE) return json({ error: 'ההערה ארוכה מדי' }, { status: 400 });

  const plan = booking.enrollment_id ? planForEnrollment(booking.enrollment_id) : null;

  const raw = Array.isArray(body.entries) ? body.entries : [];
  const entries: { nodeId: number; status: SkillStatus }[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return json({ error: 'רשומה לא תקינה' }, { status: 400 });
    const { nodeId, status } = item as Record<string, unknown>;
    const id = Number(nodeId);
    if (!Number.isInteger(id)) return json({ error: 'רשומה לא תקינה' }, { status: 400 });
    if (!STATUSES.includes(String(status) as SkillStatus)) {
      return json({ error: 'צריך לבחור מצב לכל יכולת שסומנה' }, { status: 400 });
    }
    // The node must belong to THIS lesson's plan: a report speaks for one
    // student, and an id from elsewhere is not a typo worth guessing about.
    if (!plan || !nodeInPlan(plan.id, id)) return json(NOT_FOUND, { status: 404 });
    entries.push({ nodeId: id, status: String(status) as SkillStatus });
  }

  fileReport({ bookingId: booking.id, note, entries });

  const report = reportForBooking(booking.id);
  if (!plan) return json({ report, plan: null, tree: [], events: [] });

  const fresh = planData(plan.id);
  return json({
    report,
    plan: fresh.plan,
    tree: buildTree(fresh.nodes, fresh.prereqs, fresh.events, lastLessonAt(booking.student_id)),
    events: fresh.events,
  });
};
```

- [ ] **Step 4: Run the tests**

Run: `npm run build && node --test tests/characterization/report-api.test.mjs`
Expected: PASS, 7 tests. Then `npm test && npm run check`.

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/reports tests/characterization/report-api.test.mjs
git commit -m "Add the tutor-only report filing endpoint

One POST files or corrects a lesson's report and returns the refreshed
plan view with it, so the page never guesses what the write did. A
lesson that has not ended, a cancelled one, a node from another
student's plan and a ticked skill with no status are all refused before
anything is written.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The login return path

**Files:**
- Modify: `src/lib/server/auth.ts` (`requireAuth` carries `?next=`)
- Modify: `src/routes/login/+page.svelte` (honour it, same-origin only)
- Test: `tests/characterization/login-next.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `requireAuth` redirecting to `/login?next=<pathname+search>`; the login page navigating there on success.

**Why this task exists:** the email links straight into a report form. A lapsed session currently swallows that and dumps her on the dashboard.

- [ ] **Step 1: Write the failing test**

Create `tests/characterization/login-next.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './harness.mjs';

test('a guarded page remembers where you were going', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/app/dashboard`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/login?next=%2Fapp%2Fdashboard');
  } finally { await stop(); }
});

test('the query string survives, because a report link carries one', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/app/plan/yuval?subject=%D7%9E%D7%AA%D7%9E%D7%98%D7%99%D7%A7%D7%94`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location'), /^\/login\?next=%2Fapp%2Fplan%2Fyuval%3Fsubject%3D/);
  } finally { await stop(); }
});

test('the login page only offers to return to a same-origin path', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    // The page must not turn ?next= into an off-site hop: this link arrives
    // in the tutor's own inbox, which is exactly where a phishing hop starts.
    const html = await (await fetch(`${baseUrl}/login?next=https://evil.example/steal`)).text();
    assert.doesNotMatch(html, /evil\.example/, 'an absolute URL must never reach the page');
  } finally { await stop(); }
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run build && node --test tests/characterization/login-next.test.mjs`
Expected: FAIL — the location header is `/login`.

- [ ] **Step 3: Carry the path**

In `src/lib/server/auth.ts`, replace the page branch of `requireAuth`:

```ts
export function requireAuth(event: RequestEvent): void {
  if (event.locals.authenticated) return;
  if (event.url.pathname.startsWith('/api/')) error(401, 'unauthorized');
  // Carry where she was going: the report email links straight into a form,
  // and a lapsed session must not swallow that and land her on the dashboard.
  const next = event.url.pathname + event.url.search;
  redirect(302, `/login?next=${encodeURIComponent(next)}`);
}
```

- [ ] **Step 4: Honour it, same-origin only**

In `src/routes/login/+page.svelte`, add a module-level helper and use it where the page currently sets `location.href = '/app/dashboard'`:

```ts
  import { page } from '$app/state';

  /** Only a path on this site. A `//host` or `https://host` value here would
   *  turn a link in the tutor's own inbox into a phishing hop. */
  function safeNext(raw: string | null): string {
    if (!raw) return '/app/dashboard';
    if (!raw.startsWith('/') || raw.startsWith('//')) return '/app/dashboard';
    return raw;
  }
```
```ts
        location.href = safeNext(page.url.searchParams.get('next'));
```

- [ ] **Step 5: Run the tests**

Run: `npm run build && node --test tests/characterization/login-next.test.mjs && npm test && npm run check`
Expected: PASS throughout. The existing auth characterization tests assert a redirect to `/login`; update their expectation to the `?next=` form if they compare exactly.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/auth.ts src/routes/login/+page.svelte tests/characterization/login-next.test.mjs tests/characterization/auth.test.mjs
git commit -m "Return the tutor to the page she asked for after signing in

Sign-in always landed on the dashboard, so a lapsed session swallowed
whatever link she tapped. The report email links straight into one
lesson's form, which makes that the difference between a report filed in
three taps and one abandoned.

Only a same-origin path is honoured: the link arrives in her own inbox,
which is where a phishing hop would start.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The form and the queue

**Files:**
- Create: `src/routes/app/report/[booking]/+page.server.ts`, `+page.svelte`
- Create: `src/lib/components/ReportQueue.svelte`
- Modify: `src/routes/app/dashboard/+page.server.ts` (add the pending list), `+page.svelte` (render the banner)
- Test: `tests/characterization/report-page.test.mjs`

**Interfaces:**
- Consumes: `requireAuth`; `bookingForReport`, `reportForBooking`, `lessonsAwaitingReport` from `$server/reports/store.ts`; `planForEnrollment`, `planData`, `lastLessonAt`; `buildTree`; `templatesForSubject`; `getStudentByCode`/student lookup by id from `$server/entities.ts`; `STATUSES`, `STATUS_LABEL` from `$lib/plan-status.ts`.
- Produces: the page at `/app/report/<booking id>`; `ReportQueue.svelte` taking `lessons: PendingLesson[]`.

**The dashboard already has the pattern to copy:** its calendar-failure banner (`.cf-banner` in `src/routes/app/dashboard/+page.svelte`) is exactly the shape this queue takes — same position, same weight.

- [ ] **Step 1: Write the failing test**

Create `tests/characterization/report-page.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login, familySession } from './harness.mjs';

const book = (baseUrl) => fetch(`${baseUrl}/api/book`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'יובל כהן', subject: 'מתמטיקה', level: 'כיתה יא',
    phone: '0501234567', email: 'orit@example.com', durationMin: 90,
    start: '2027-03-15T10:00:00+02:00', end: '2027-03-15T11:30:00+02:00',
  }),
}).then(r => r.json());

/** Books, plans, and ages the booking into the past so it is reportable. */
async function pastLesson(baseUrl, dbPath) {
  const booked = await book(baseUrl);
  const cookie = await login(baseUrl);
  await fetch(`${baseUrl}/api/plans`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ code: booked.portal.code, subject: 'מתמטיקה', templateId: 'math-5u', goal: 'בגרות' }),
  });
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath);
  db.prepare(`UPDATE bookings_v2 SET start = '2026-01-05T10:00:00.000Z', "end" = '2026-01-05T11:30:00.000Z'`).run();
  const bookingId = Number(db.prepare(`SELECT id FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get().id);
  db.close();
  return { booked, cookie, bookingId };
}

test('the report page needs a tutor session', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const { booked, bookingId } = await pastLesson(baseUrl, dbPath);
    const anon = await fetch(`${baseUrl}/app/report/${bookingId}`, { redirect: 'manual' });
    assert.equal(anon.status, 302);
    assert.match(anon.headers.get('location'), /^\/login\?next=/);

    const family = await familySession(booked.portal.link);
    const asFamily = await fetch(`${baseUrl}/app/report/${bookingId}`, { headers: { Cookie: family }, redirect: 'manual' });
    assert.equal(asFamily.status, 302);
  } finally { await stop(); }
});

test('the form names the lesson and offers the plan’s skills', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const { cookie, bookingId } = await pastLesson(baseUrl, dbPath);
    const html = await (await fetch(`${baseUrl}/app/report/${bookingId}`, { headers: { Cookie: cookie } })).text();
    assert.match(html, /יובל כהן/);
    assert.match(html, /מתמטיקה/);
    assert.match(html, /מה עברתם/);
    assert.match(html, /חוקי חזקות|נגזרת|פונקציה/, 'at least one real skill from the template');
  } finally { await stop(); }
});

test('an unknown lesson is a 404', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    assert.equal((await fetch(`${baseUrl}/app/report/999999`, { headers: { Cookie: cookie } })).status, 404);
  } finally { await stop(); }
});

test('the dashboard lists lessons awaiting a report, and stops once one is filed', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const { cookie, bookingId } = await pastLesson(baseUrl, dbPath);

    const before = await (await fetch(`${baseUrl}/app/dashboard`, { headers: { Cookie: cookie } })).text();
    assert.match(before, /מחכים לדיווח|מחכה לדיווח/);
    assert.match(before, new RegExp(`/app/report/${bookingId}`));

    await fetch(`${baseUrl}/api/reports`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ bookingId, note: 'דווח', entries: [] }),
    });

    const after = await (await fetch(`${baseUrl}/app/dashboard`, { headers: { Cookie: cookie } })).text();
    assert.doesNotMatch(after, new RegExp(`/app/report/${bookingId}`), 'a reported lesson leaves the queue');
  } finally { await stop(); }
});

test('a filed report is shown for correction, not as a blank form', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const { cookie, bookingId } = await pastLesson(baseUrl, dbPath);
    await fetch(`${baseUrl}/api/reports`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ bookingId, note: 'נתקעה בשברים', entries: [] }),
    });
    const html = await (await fetch(`${baseUrl}/app/report/${bookingId}`, { headers: { Cookie: cookie } })).text();
    assert.match(html, /נתקעה בשברים/, 'the note she filed');
    assert.match(html, /תיקון/, 'the button says it corrects');
  } finally { await stop(); }
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run build && node --test tests/characterization/report-page.test.mjs`
Expected: FAIL — `/app/report/<id>` 404s.

- [ ] **Step 3: Write the page load**

Create `src/routes/app/report/[booking]/+page.server.ts`:

```ts
/**
 * One lesson's report form. Tutor-only.
 *
 * Everything the form offers is decided here: which lesson, whose plan, and
 * which skills to put in front of her first — the ones the plan already
 * flags as recommended or in progress, because those are what a lesson
 * usually covers.
 */
import { error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth.ts';
import { bookingForReport, reportForBooking } from '$server/reports/store.ts';
import { planForEnrollment, planData, lastLessonAt } from '$server/plans/store.ts';
import { buildTree } from '$server/plans/view.ts';
import { templatesForSubject } from '$server/plans/templates.ts';
import { getStudent, enrollmentsForStudent } from '$server/entities.ts';
import type { PageServerLoad } from './$types';

const IN_PROGRESS = ['needs_review', 'guided', 'with_help', 'started'];

export const load: PageServerLoad = async (event) => {
  requireAuth(event);

  const booking = bookingForReport(Number(event.params.booking));
  if (!booking) error(404, 'לא נמצא');

  const student = getStudent(booking.student_id);
  if (!student) error(404, 'לא נמצא');

  const enrollment = enrollmentsForStudent(student.id).find(e => e.id === booking.enrollment_id) ?? null;
  const plan = booking.enrollment_id ? planForEnrollment(booking.enrollment_id) : null;

  let tree = [];
  if (plan) {
    const { nodes, prereqs, events } = planData(plan.id);
    tree = buildTree(nodes, prereqs, events, lastLessonAt(student.id));
  }

  const skills = tree.flatMap(t => t.branches.flatMap(b =>
    b.skills.map(s => ({ ...s, topic: t.title, branch: b.title }))))
    .filter(s => s.visibility !== 'hidden');

  return {
    booking: { id: booking.id, start: booking.start, end: booking.end },
    student: { code: student.code, name: student.name },
    subject: enrollment?.subject ?? null,
    planId: plan?.id ?? null,
    report: reportForBooking(booking.id),
    // Offered first, then everything else behind the search line.
    suggested: skills.filter(s => s.recommended || IN_PROGRESS.includes(s.status)),
    rest: skills.filter(s => !(s.recommended || IN_PROGRESS.includes(s.status))),
    templates: !plan && enrollment
      ? templatesForSubject(enrollment.subject).map(t => ({ id: t.id, track: t.track }))
      : [],
  };
};
```

If `getStudent(id)` does not exist in `entities.ts`, add it beside `getStudentByCode` — a one-line `SELECT * FROM students_v2 WHERE id = ?` — rather than looking the student up by code you do not have.

- [ ] **Step 4: Write the form and the queue banner**

Create `src/routes/app/report/[booking]/+page.svelte` following the plan page's house style (Svelte 5 runes, scoped styles, tokens only):

- Header: back link, «דיווח שיעור · {student.name} · {subject}», then the lesson's date and time formatted `he-IL`.
- The suggested skills as rows: a checkbox, the skill title with its branch beneath in muted text, and a status `<select>` that starts on an empty option labelled «בחרו מצב». Then a disclosure «+ חפשו יכולת אחרת בתכנית» revealing a text filter over `rest`.
- An optional note `<textarea>`, maxlength 2000.
- Submit: «שליחת הדיווח», or «תיקון הדיווח» when `data.report` exists. Disabled while any ticked skill has no status, and while saving.
- On submit, `POST /api/reports`; on success `goto('/app/plan/<code>?subject=<subject>&filter=changed')`; on failure show the server's error message and leave the form as it was.
- When `data.planId` is null: no skill list, a line saying there is no plan for this subject yet, and a link to `/app/plan/<code>` to create one. The note and submit still work.

Create `src/lib/components/ReportQueue.svelte`: takes `lessons`, renders nothing when empty, otherwise a banner in the `.cf-banner` shape — «⚠ N שיעורים מחכים לדיווח» and one row per lesson (`name · subject · <he-IL date>`) with a «דיווח» link to `/app/report/<id>`.

- [ ] **Step 5: Wire the dashboard**

In `src/routes/app/dashboard/+page.server.ts`, add the pending lessons to the returned data (the load already returns `roster`):

```ts
  const now = new Date();
  const since = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
  return { roster: roster(), pendingReports: lessonsAwaitingReport(now.toISOString(), since) };
```

In `src/routes/app/dashboard/+page.svelte`, render `<ReportQueue lessons={data.pendingReports} />` directly above the existing calendar-failure banner.

- [ ] **Step 6: Run the tests**

Run: `npm run build && node --test tests/characterization/report-page.test.mjs && npm test && npm run check`
Expected: PASS, 0 errors.

- [ ] **Step 7: Check it in a browser**

Same approach as the plan page: a throwaway script in /tmp that boots the build via `startServer`/`login`, books and ages a lesson, prints the URL and cookie; then python Playwright at 320, 390, 430 and 1280px. Confirm: the queue banner appears and links correctly; the form's suggested skills are the recommended/in-progress ones; submit is blocked until a ticked skill has a status; a filed report returns you to the plan page with the changed filter active; a correction shows the previous note. No horizontal scroll, controls at least 44px. Put the measurements in the report; commit nothing from /tmp.

- [ ] **Step 8: Commit**

```bash
git add src/routes/app/report src/lib/components/ReportQueue.svelte src/routes/app/dashboard tests/characterization/report-page.test.mjs
git commit -m "Add the report form and the dashboard queue

The form offers the skills the plan already flags as recommended or in
progress, because those are what a lesson usually covers; everything
else is behind a search line. Nothing is pre-ticked and a ticked skill
starts with no status, so a hurried submit cannot record a judgement she
did not make. Filing returns her to the plan with the changed-since
filter on, so she sees exactly what her report moved.

The queue is a banner in the shape the calendar-failure one already
uses, and it empties itself: a lesson leaves it the moment it is
reported.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The prompt email

**Files:**
- Modify: `src/lib/server/email.ts` (add `sendReportPromptEmail`)
- Create: `src/routes/api/reports/prompt/+server.ts`
- Test: `tests/characterization/report-prompt.test.mjs`

**Interfaces:**
- Consumes: `promptCandidates`, `markPrompted` from `$server/reports/store.ts`; `planForEnrollment`, `planData`, `lastLessonAt`; `buildTree`; the existing `transport()`, `shell()`, `linkBlock()`, `whenLabel()` helpers inside `email.ts`.
- Produces: `sendReportPromptEmail(lesson, recommended: string[]): Promise<boolean>`; `POST /api/reports/prompt` → `{ considered, emailed, skipped }`.

**Two things to know before writing the test:** the harness blocks `GMAIL_USER`/`GMAIL_APP_PASSWORD`, so `transport()` returns null and the sender returns `false` — a characterization test can prove selection and authorization but never that mail was sent. Idempotence is proven at the store level in Task 2 and again here through `skipped`.

- [ ] **Step 1: Write the failing test**

Create `tests/characterization/report-prompt.test.mjs`:

```js
// The prompt endpoint is the first thing in this codebase that a machine
// calls rather than a person, so what it checks at the door matters more
// than what it sends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login } from './harness.mjs';

const CRON_KEY = 'test-cron-key';

const book = (baseUrl) => fetch(`${baseUrl}/api/book`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'יובל כהן', subject: 'מתמטיקה', level: 'כיתה יא',
    phone: '0501234567', email: 'orit@example.com', durationMin: 90,
    start: '2027-03-15T10:00:00+02:00', end: '2027-03-15T11:30:00+02:00',
  }),
}).then(r => r.json());

/** Ages the booking to two hours ago, relative to the running clock. */
async function ageLesson(dbPath) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath);
  const end = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const start = new Date(Date.now() - 3.5 * 60 * 60 * 1000).toISOString();
  db.prepare(`UPDATE bookings_v2 SET start = ?, "end" = ?`).run(start, end);
  db.close();
}

const prompt = (baseUrl, key) => fetch(`${baseUrl}/api/reports/prompt`, {
  method: 'POST', headers: key ? { 'X-Cron-Key': key } : {},
});

test('the prompt endpoint refuses anyone without the key', async () => {
  const { baseUrl, stop } = await startServer({ env: { CRON_KEY } });
  try {
    assert.equal((await prompt(baseUrl, null)).status, 401);
    assert.equal((await prompt(baseUrl, 'wrong')).status, 401);
    // A tutor session is not a substitute: this endpoint is for the timer.
    const cookie = await login(baseUrl);
    const asTutor = await fetch(`${baseUrl}/api/reports/prompt`, { method: 'POST', headers: { Cookie: cookie } });
    assert.equal(asTutor.status, 401);
  } finally { await stop(); }
});

test('with no key configured the endpoint is closed, not open', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    assert.equal((await prompt(baseUrl, null)).status, 401);
    assert.equal((await prompt(baseUrl, '')).status, 401);
  } finally { await stop(); }
});

test('a finished lesson is considered once and then not again', async () => {
  const { baseUrl, dbPath, stop } = await startServer({ env: { CRON_KEY } });
  try {
    await book(baseUrl);
    await ageLesson(dbPath);

    const first = await (await prompt(baseUrl, CRON_KEY)).json();
    assert.equal(first.considered, 1);
    // No mail credentials in the harness, so nothing is actually sent and
    // the lesson is NOT marked — it must still be considered next time.
    assert.equal(first.emailed, 0);
    assert.equal(first.skipped, 1);

    const second = await (await prompt(baseUrl, CRON_KEY)).json();
    assert.equal(second.considered, 1, 'an unsent prompt is retried, not forgotten');
  } finally { await stop(); }
});

test('a lesson that has not finished is never considered', async () => {
  const { baseUrl, stop } = await startServer({ env: { CRON_KEY } });
  try {
    await book(baseUrl); // 2027, untouched
    assert.equal((await (await prompt(baseUrl, CRON_KEY)).json()).considered, 0);
  } finally { await stop(); }
});

test('a reported lesson is never chased', async () => {
  const { baseUrl, dbPath, stop } = await startServer({ env: { CRON_KEY } });
  try {
    await book(baseUrl);
    await ageLesson(dbPath);
    const cookie = await login(baseUrl);
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    const bookingId = Number(db.prepare(`SELECT id FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get().id);
    db.close();

    await fetch(`${baseUrl}/api/reports`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ bookingId, note: 'דווח', entries: [] }),
    });

    assert.equal((await (await prompt(baseUrl, CRON_KEY)).json()).considered, 0);
  } finally { await stop(); }
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run build && node --test tests/characterization/report-prompt.test.mjs`
Expected: FAIL — the route 404s.

- [ ] **Step 3: Write the sender**

In `src/lib/server/email.ts`, beside the other senders:

```ts
/**
 * The nudge after a lesson: one message, to the tutor's own mailbox, with a
 * link into that lesson's report form.
 *
 * It names the skills the plan recommends, so the message is useful even
 * unopened — she can see where the student is without tapping anything.
 */
export async function sendReportPromptEmail(
  lesson: { bookingId: number; studentName: string; subject: string | null; start: string },
  recommended: string[],
): Promise<boolean> {
  const tx = transport();
  if (!tx) return false;

  const to = process.env.BOOKING_EMAIL_TO || 'mea.beclick@gmail.com';
  const site = process.env.SITE_URL ?? '';
  const href = `${site}/app/report/${lesson.bookingId}`;

  const hint = recommended.length
    ? `<p style="margin:12px 0 0">מומלץ לתרגול עכשיו: ${esc(recommended.slice(0, 2).join(', '))}</p>`
    : '';

  await tx.sendMail({
    from: process.env.GMAIL_USER,
    to,
    subject: `שיעור עם ${lesson.studentName} הסתיים — דיווח קצר?`,
    html: shell(`
      <h2 style="margin:0 0 6px">דיווח שיעור</h2>
      <p style="margin:0">${esc(lesson.studentName)}${lesson.subject ? ` · ${esc(lesson.subject)}` : ''} · ${esc(whenLabel(lesson.start))}</p>
      ${hint}
      ${linkBlock(href, 'לדיווח השיעור')}
      <p style="font-size:12px;color:#64748B">אם כבר דיווחת, אפשר להתעלם מההודעה.</p>
    `),
  });
  return true;
}
```

- [ ] **Step 4: Write the endpoint**

Create `src/routes/api/reports/prompt/+server.ts`:

```ts
/**
 * Emails the tutor about lessons that have finished without a report.
 * Driven by a systemd timer (server/meabeclick-report-prompt.timer), so it
 * authenticates with a shared secret rather than a session: a timer has no
 * cookies, and this route is reachable from the internet.
 *
 * A lesson is marked prompted only after a SUCCESSFUL send, so a mail
 * failure is retried next hour rather than silently swallowed — and a
 * lesson that ages out (see promptCandidates) stops being chased.
 */
import { json } from '@sveltejs/kit';
import { timingSafeEqual } from 'node:crypto';
import { promptCandidates, markPrompted } from '$server/reports/store.ts';
import { planForEnrollment, planData, lastLessonAt } from '$server/plans/store.ts';
import { buildTree } from '$server/plans/view.ts';
import { sendReportPromptEmail } from '$server/email.ts';
import type { RequestHandler } from './$types';

/** Constant-time, and closed when no key is configured: a missing secret
 *  must never mean "no check". */
function authorized(given: string | null): boolean {
  const expected = process.env.CRON_KEY ?? '';
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Up to two skills the plan says to practise now, for the email's one hint. */
function recommendedFor(enrollmentId: number | null, studentId: number): string[] {
  if (!enrollmentId) return [];
  const plan = planForEnrollment(enrollmentId);
  if (!plan) return [];
  const { nodes, prereqs, events } = planData(plan.id);
  return buildTree(nodes, prereqs, events, lastLessonAt(studentId))
    .flatMap(t => t.branches.flatMap(b => b.skills))
    .filter(s => s.recommended && s.visibility !== 'hidden')
    .slice(0, 2)
    .map(s => s.title);
}

export const POST: RequestHandler = async (event) => {
  if (!authorized(event.request.headers.get('x-cron-key'))) {
    return json({ error: 'unauthorized' }, { status: 401 });
  }

  const lessons = promptCandidates();
  let emailed = 0;
  let skipped = 0;

  for (const lesson of lessons) {
    let sent = false;
    try {
      sent = await sendReportPromptEmail(lesson, recommendedFor(lesson.enrollmentId, lesson.studentId));
    } catch (err) {
      console.error('[reports/prompt] send failed:', (err as Error).message);
    }
    if (sent) {
      markPrompted(lesson.bookingId);
      emailed += 1;
    } else {
      skipped += 1;
    }
  }

  return json({ considered: lessons.length, emailed, skipped });
};
```

- [ ] **Step 5: Run the tests**

Run: `npm run build && node --test tests/characterization/report-prompt.test.mjs && npm test && npm run check`
Expected: PASS, 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/email.ts src/routes/api/reports/prompt tests/characterization/report-prompt.test.mjs
git commit -m "Email the tutor about lessons that still need a report

One message per finished lesson, to her own mailbox, naming the two
skills the plan recommends so it is useful even unopened. The endpoint
is for the timer, not a person: it authenticates with a shared secret,
compared in constant time, and is closed when no secret is configured.

A lesson is marked prompted only after a send actually succeeds, so a
mail failure is retried next hour instead of being lost.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Scheduling, and the reminder that has not run since the cron died

**Files:**
- Create: `server/meabeclick-report-prompt.service`, `server/meabeclick-report-prompt.timer`
- Create: `server/meabeclick-remind.service`, `server/meabeclick-remind.timer`
- Modify: `src/routes/api/remind/+server.ts` (require the same key)
- Modify: `.env.example`, `docker-compose.yml`, `server/README.md`
- Test: `tests/unit/scheduling.test.mjs`

**Interfaces:**
- Consumes: the endpoints from Task 6 and the existing `/api/remind`.
- Produces: two timer/service pairs and the `CRON_KEY` variable.

**Precedent to copy exactly:** `server/meabeclick-backup.service` and `server/meabeclick-backup.timer` — same `systemd --user` shape, same install instructions in `server/README.md` §backup.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/scheduling.test.mjs`:

```js
// The units are the only part of this feature that CI cannot exercise, so
// the test reads them as text: a timer that points at the wrong endpoint or
// forgets the key fails silently in production, at 03:00, forever.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(root, p), 'utf8');

test('the report-prompt unit calls the prompt endpoint with the key', () => {
  const unit = read('server/meabeclick-report-prompt.service');
  assert.match(unit, /\/api\/reports\/prompt/);
  assert.match(unit, /X-Cron-Key/);
  assert.match(unit, /\$\{?CRON_KEY\}?/, 'the key comes from the environment, never inline');
  assert.doesNotMatch(unit, /X-Cron-Key:\s*[A-Za-z0-9]{8,}/, 'no literal secret in a checked-in file');
});

test('the report-prompt timer runs hourly and survives a reboot', () => {
  const timer = read('server/meabeclick-report-prompt.timer');
  assert.match(timer, /OnCalendar=hourly|OnUnitActiveSec=1h/);
  assert.match(timer, /Persistent=true/, 'a missed run must fire after a reboot');
  assert.match(timer, /WantedBy=timers\.target/);
});

test('the reminder unit calls /api/remind, which had no caller at all', () => {
  const unit = read('server/meabeclick-remind.service');
  assert.match(unit, /\/api\/remind/);
  assert.match(unit, /X-Cron-Key/);
  const timer = read('server/meabeclick-remind.timer');
  assert.match(timer, /Sat/, 'the booking window opens on Saturday evening');
});

test('CRON_KEY is documented where a deployer will look', () => {
  assert.match(read('.env.example'), /CRON_KEY/);
  assert.match(read('server/README.md'), /CRON_KEY/);
  assert.match(read('server/README.md'), /meabeclick-report-prompt\.timer/);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/unit/scheduling.test.mjs`
Expected: FAIL — `ENOENT` on `server/meabeclick-report-prompt.service`.

- [ ] **Step 3: Write the units**

`server/meabeclick-report-prompt.service`:

```ini
[Unit]
Description=מאה בקליק — email the tutor about lessons awaiting a report
After=network-online.target

[Service]
Type=oneshot
# The app listens on 3000 inside the compose network and is published on
# 127.0.0.1 — see docker-compose.yml. Curling localhost keeps this request
# off the public interface entirely.
EnvironmentFile=%h/mea-beclick/.env
ExecStart=/usr/bin/curl -sS --fail --max-time 60 -X POST \
  -H "X-Cron-Key: ${CRON_KEY}" \
  http://127.0.0.1:3000/api/reports/prompt
```

`server/meabeclick-report-prompt.timer`:

```ini
[Unit]
Description=Run the lesson-report prompt hourly

[Timer]
OnCalendar=hourly
# A laptop-style reboot or a host restart must not swallow the run: the
# endpoint is idempotent, so a late fire is always safe.
Persistent=true
RandomizedDelaySec=120

[Install]
WantedBy=timers.target
```

`server/meabeclick-remind.service` and `.timer`: the same shape, pointing at `/api/remind`, with `OnCalendar=Sat 17:00` (the booking window opens Saturday at 20:00 Israel time; the reminder goes out before it). **That route is a `GET`** — curl it without `-X POST`, and keep it a GET rather than changing its method, since nothing about this task requires that.

- [ ] **Step 4: Close the reminder endpoint**

`/api/remind` is a `GET` that anyone can trigger today. Give it the same door as the prompt endpoint: read `x-cron-key`, compare it in constant time, 401 otherwise. Extract the check from Task 6 into `src/lib/server/cron-auth.ts` (relative imports inside `src/lib/server`) and use it in both routes rather than writing it twice.

- [ ] **Step 5: Document it**

- `.env.example`: `CRON_KEY=` with a line saying it authenticates the timer-driven endpoints and is generated with `openssl rand -hex 32`.
- `docker-compose.yml`: **check before editing.** Secret values reach the app through `env_file` (the file's own comment says `environment:` is for non-secret config and overrides `env_file`), so `CRON_KEY` in `.env` already reaches the container and **no compose change should be needed**. If that turns out to be wrong, add it the way the other secrets are added, not with an inline literal.
- `server/README.md`: a section beside the backup timer with the install commands (`cp server/meabeclick-*.{service,timer} ~/.config/systemd/user/`, `systemctl --user daemon-reload`, `systemctl --user enable --now meabeclick-report-prompt.timer meabeclick-remind.timer`, `systemctl --user list-timers`), and **update the paragraph that says `/api/remind` has no caller** — it does now.

- [ ] **Step 6: Run everything**

Run: `npm run build && npm test && npm run check`
Expected: all green, 0 errors.

- [ ] **Step 7: Commit**

```bash
git add server/meabeclick-report-prompt.service server/meabeclick-report-prompt.timer \
        server/meabeclick-remind.service server/meabeclick-remind.timer \
        src/lib/server/cron-auth.ts src/routes/api/remind .env.example docker-compose.yml \
        server/README.md tests/unit/scheduling.test.mjs
git commit -m "Give the box a scheduler, with two jobs on day one

A systemd --user timer in the shape of the backup one drives the lesson
report prompt hourly, and a second drives the Saturday booking reminder
that has had no caller since the Vercel cron was deleted — which
server/README.md has been carrying as an open question.

Both endpoints now sit behind one shared-secret check, constant-time and
closed when no key is configured. /api/remind was previously open to
anyone who knew the path.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.** §4 schema → Task 1. §5 queue → Tasks 2 and 5. §6 form → Task 5. §7 email → Task 6. §8 scheduling and the `/api/remind` revival → Task 7. §9 API, authorization, errors → Tasks 3 and 6; the login return path → Task 4. §11 testing → every task's test step, plus the browser pass in Task 5 Step 7. §10 (deliberately undecided) needs no task.

**Placeholders.** None: every step carries its code or its exact edit. Task 5's form is described rather than written out, as the plan-page task was, with its test pinning the parts that must exist.

**Type consistency.** `PendingLesson` is defined in Task 2 and consumed by Tasks 5 and 6 under that name. `fileReport`, `reportForBooking`, `bookingForReport`, `lessonsAwaitingReport`, `promptCandidates`, `markPrompted` keep their signatures across Tasks 2, 3, 5 and 6. `sendReportPromptEmail(lesson, recommended)` is defined and called in Task 6 only. The `x-cron-key` header name is identical in Tasks 6 and 7, and the check moves into `cron-auth.ts` in Task 7 rather than being duplicated.

**One thing deliberately left to the implementer.** Task 3's test ages a booking with a direct `UPDATE` through the harness's `dbPath`, because `/api/book` refuses a past slot by design. That is a test-only manoeuvre and must not leak into production code.
