/**
 * Homework results in SQLite. Uses the built-in node:sqlite (Node 22+), so
 * there is nothing to compile on the server.
 *
 * Schema and aggregation match what vps/server.mjs wrote, so an existing
 * results.db carries over unchanged.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { singleton } from './singleton.ts';
import { migrate } from './migrations/index.ts';

export type StudentRow = {
  code: string;
  name: string;
  subject: string | null;
  level: string | null;
  student_pin: string;
  parent_pin: string;
  phone: string | null;
  password: string | null;
  created_at: string;
};

export type ResultRow = {
  id: number;
  student: string;
  at: string;
  data_id: string | null;
  template: string | null;
  score: number | null;
  total: number | null;
  tries: number | null;
  stars: number | null;
  seconds: number | null;
  missed: string | null;
};

export type LessonRow = {
  id: number;
  slug: string;
  student: string;
  subject: string | null;
  level: string | null;
  topic: string | null;
  title: string | null;
  context: string | null;
  at: string;
  lesson_at: string | null;
  status: string;
  problem: string | null;
  slides: string | null;
  homework: string | null;
  games: string | null;
};

export type BookingRow = {
  id: number;
  name: string;
  subject: string | null;
  level: string | null;
  topic: string | null;
  phone: string | null;
  start: string;
  end: string;
  duration: number | null;
  at: string;
  status: string;
};

export type CalendarFailureRow = {
  id: number;
  name: string;
  start: string;
  message: string | null;
  at: string;
  resolved: number;
};

// Honors DB_PATH when set (existing deployment and the test harness both set
// it); otherwise derives the path from DATA_DIR, falling back to './data'.
const DB_PATH = process.env.DB_PATH || join(process.env.DATA_DIR ?? './data', 'results.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

// Wrapped in singleton() so Vite HMR re-evaluating this module in dev cannot
// open a second DatabaseSync handle against the same file.
// Migrations run inside the singleton factory, not in hooks.server.ts,
// because unit tests import this module directly and never execute hooks —
// running them there would leave every test on an unmigrated database.
const db = singleton('db', () => {
  const handle = new DatabaseSync(DB_PATH);
  // SQLite ignores FOREIGN KEY declarations unless this is on, per
  // connection. Without it every constraint in 001_entities.sql is a comment.
  handle.exec(`PRAGMA foreign_keys = ON`);
  migrate(handle);
  return handle;
});

/** The shared connection, for src/lib/server/entities.ts. A function rather
 *  than the binding itself so importers cannot capture a handle from before
 *  migrate() ran. */
export function handle(): DatabaseSync {
  return db;
}

/* Depth counter for inTransaction(), below. Module-level rather than a
   parameter because callers (enrollFromBooking, its tests) have no reason
   to know or pass along whether they're already inside one — the whole
   point of re-entrancy safety is that a caller can wrap its own writes in
   inTransaction() without caring whether it's called directly or from
   inside another inTransaction() call further up the stack. */
let txDepth = 0;

/**
 * Runs `fn` inside a SQLite transaction: BEGIN, then COMMIT on success or
 * ROLLBACK on a throw — the original error is always rethrown, never
 * swallowed or wrapped, so a caller's try/catch sees exactly what `fn`
 * threw. That promise holds even if the ROLLBACK itself throws (reachable:
 * an error that already auto-rolled-back the transaction — SQLITE_FULL,
 * some SQLITE_IOERR — leaves ROLLBACK to throw "cannot rollback - no
 * transaction is active") — that failure is logged, never rethrown in
 * place of the original.
 *
 * Re-entrancy safe: node:sqlite (like SQLite itself) rejects a nested
 * BEGIN, so only the OUTERMOST call actually issues BEGIN/COMMIT/ROLLBACK.
 * A call made while one is already open just runs `fn` and lets the
 * outermost call decide the outcome — if the OUTER call also throws, an
 * inner call's writes are rolled back with everything else even though the
 * inner call itself returned normally.
 *
 * No savepoints: there is no per-nesting-level rollback. If an outer call's
 * body catches and swallows an inner call's throw, the inner write still
 * commits along with the rest of the outer transaction — nesting only
 * changes who issues BEGIN/COMMIT/ROLLBACK, not what can be undone. No
 * caller does this today (enrollFromBooking never nests), so this is latent
 * rather than exercised — verified by probe, not by a caller hitting it.
 *
 * Deliberately synchronous: node:sqlite's API is sync, and callers on the
 * booking path (src/lib/server/enroll.ts) depend on nothing here ever
 * yielding the event loop mid-flow.
 */
export function inTransaction<T>(fn: () => T): T {
  const isOutermost = txDepth === 0;
  if (isOutermost) db.exec('BEGIN');
  txDepth++;
  try {
    const result = fn();
    if (isOutermost) db.exec('COMMIT');
    return result;
  } catch (err) {
    if (isOutermost) {
      try {
        db.exec('ROLLBACK');
      } catch (rollbackErr) {
        console.error('[db] ROLLBACK failed:', rollbackErr);
      }
    }
    throw err;
  } finally {
    txDepth--;
  }
}

db.exec(`
  -- Kept in step with the frozen copy of this DDL in
  -- migrations/008_results_identity.ts. migrate() (called above, at line 97)
  -- runs before this db.exec block, so on a FRESH database migration 008's
  -- CREATE TABLE is the one that actually creates the results table — this
  -- statement then finds the table already there and, being IF NOT EXISTS,
  -- is a permanent no-op for that deployment. A column added here without
  -- also adding it to 008's copy would silently reach upgraded (already
  -- migrated) deployments but never fresh ones.
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
  CREATE INDEX IF NOT EXISTS idx_results_student ON results(student, at DESC);

  -- Generated lessons. Lives here rather than in localStorage so the tutor,
  -- student and parent dashboards can all read the same rows.
  CREATE TABLE IF NOT EXISTS lessons (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    slug      TEXT UNIQUE NOT NULL,
    student   TEXT NOT NULL,
    subject   TEXT,
    level     TEXT,
    topic     TEXT,
    title     TEXT,
    context   TEXT,          -- gradeContext: which grade, what is assumed
    at        TEXT NOT NULL,
    lesson_at TEXT,          -- when the lesson itself happens
    status    TEXT NOT NULL, -- generating | ready | held | failed
    problem   TEXT,          -- why it was held or failed
    slides    TEXT,          -- public URL
    homework  TEXT,          -- JSON array
    games     TEXT           -- JSON array of {title,template,dataId}
  );
  CREATE INDEX IF NOT EXISTS idx_lessons_student ON lessons(student, at DESC);

  -- Lessons parents booked through the site. Without this the booking exists
  -- only in an email, and the same hour stays on offer to the next parent.
  CREATE TABLE IF NOT EXISTS bookings (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL,
    subject  TEXT,
    level    TEXT,
    topic    TEXT,
    phone    TEXT,
    start    TEXT NOT NULL,   -- ISO
    end      TEXT NOT NULL,   -- ISO
    duration INTEGER,
    at       TEXT NOT NULL,   -- when it was booked
    status   TEXT NOT NULL DEFAULT 'confirmed'
  );
  CREATE INDEX IF NOT EXISTS idx_bookings_start ON bookings(start);

  -- A booking whose calendar write failed (broken Service Account) used to
  -- fail completely or fail silently — the booking is still saved and the
  -- tutor emailed either way, but this is what lets the dashboard show her
  -- an unmissable banner instead of relying on her reading every email.
  CREATE TABLE IF NOT EXISTS calendar_failures (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL,
    start    TEXT NOT NULL,
    message  TEXT,
    at       TEXT NOT NULL,
    resolved INTEGER NOT NULL DEFAULT 0
  );

  -- One row per student: the code that appears in their link, plus the two
  -- access codes. Lives on the server so any device can check them — the old
  -- parent PINs sat in one browser's localStorage and worked nowhere else.
  CREATE TABLE IF NOT EXISTS students (
    code        TEXT PRIMARY KEY,   -- the name in English, used in ?s=<code>
    name        TEXT NOT NULL,      -- Hebrew display name
    subject     TEXT,
    level       TEXT,
    student_pin TEXT NOT NULL,
    parent_pin  TEXT NOT NULL,
    phone       TEXT,               -- how a returning booker is recognised
    created_at  TEXT NOT NULL
  );
`);

/* Added after the table shipped, so bring existing databases along. */
try { db.exec(`ALTER TABLE students ADD COLUMN phone TEXT`); } catch { /* already there */ }

/* Lets a returning parent identify themselves by name+password instead of
   phone (a phone can belong to either parent, so it isn't a reliable match
   across bookings). Chosen by the parent, stored as-is like the PINs above —
   same low-security-by-design tradeoff, made explicitly so the tutor can
   read it back to a parent who forgot it. Existing rows predate this column;
   their old student_pin becomes their password so nobody is locked out. */
try { db.exec(`ALTER TABLE students ADD COLUMN password TEXT`); } catch { /* already there */ }
db.exec(`UPDATE students SET password = student_pin WHERE password IS NULL`);

/* Statements are prepared per call rather than held at module scope:
   node:sqlite finalizes a long-lived StatementSync out from under you, which
   surfaces later as "statement has been finalized" on a previously fine
   handle. At this volume the prepare cost is irrelevant. */

export interface WriteResultInput {
  student: unknown;
  dataId?: unknown;
  template?: unknown;
  score?: unknown;
  total?: unknown;
  tries?: unknown;
  stars?: unknown;
  durationSec?: unknown;
  missed?: unknown;
}

export function writeResult(b: WriteResultInput): void {
  db.prepare(`
    INSERT INTO results (student, at, data_id, template, score, total, tries, stars, seconds, missed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(b.student).trim().slice(0, 60),
    new Date().toISOString(),
    str(b.dataId, 120), str(b.template, 40),
    int(b.score), int(b.total), int(b.tries), int(b.stars), int(b.durationSec),
    JSON.stringify((Array.isArray(b.missed) ? b.missed : []).slice(0, 40).map(m => String(m).slice(0, 200))),
  );
}

export interface StudentResultsSummary {
  plays: number;
  lastPlayed: string | null;
  score: number;
  total: number;
  wrong: number;
  accuracy: number | null;
  tries: number | null;
  minutes: number;
  topMissed: { item: string; times: number }[];
  games: unknown[];
}

export function readResults(): Record<string, StudentResultsSummary> {
  /* Both tables, because migration 008 splits history by whether it could be
     attributed: results_v2 holds plays with a real student_id, `results` holds
     the ones whose display name was ambiguous or unknown. They are disjoint —
     008 MOVES rows rather than copying them — so UNION ALL cannot double-count,
     and nothing a child played is invisible to the tutor. Keyed by display name
     either way, so this function's contract (and /api/results, and the
     dashboard) is unchanged. */
  const rows = db.prepare(`
    SELECT id, student, at, data_id, template, score, total, tries, stars, seconds, missed
    FROM results
    UNION ALL
    SELECT r.id, s.name AS student, r.at, r.data_id, r.template, r.score, r.total,
           r.tries, r.stars, r.seconds, r.missed
    FROM results_v2 r
    JOIN students_v2 s ON s.id = r.student_id
    ORDER BY at DESC
  `).all() as ResultRow[];

  const byStudent: Record<string, ResultRow[]> = {};
  for (const r of rows) {
    (byStudent[r.student] ||= []).push(r);
  }

  const out: Record<string, StudentResultsSummary> = {};
  for (const [name, plays] of Object.entries(byStudent)) {
    let score = 0, total = 0, tries = 0, seconds = 0;
    const missCount: Record<string, number> = {};
    for (const p of plays) {
      score += p.score || 0; total += p.total || 0;
      tries += p.tries || 0; seconds += p.seconds || 0;
      for (const m of safeArr(p.missed)) missCount[m as string] = (missCount[m as string] || 0) + 1;
    }
    out[name] = {
      plays: plays.length,
      lastPlayed: plays[0]?.at || null,
      score, total,
      wrong: Math.max(0, total - score),
      accuracy: total ? Math.round((score / total) * 100) : null,
      tries: tries || null,
      minutes: seconds ? Math.round(seconds / 60) : 0,
      topMissed: Object.entries(missCount).sort((a, b) => b[1] - a[1]).slice(0, 5)
                   .map(([item, times]) => ({ item, times })),
      games: [],
    };
  }
  return out;
}

/* ── Lessons ──────────────────────────────────────────────────── */

export interface CreateLessonInput {
  slug: string;
  student: string;
  subject?: string | null;
  level?: string | null;
  topic?: string | null;
  lessonAt?: string | null;
}

export function createLesson({ slug, student, subject, level, topic, lessonAt }: CreateLessonInput): void {
  db.prepare(`
    INSERT INTO lessons (slug, student, subject, level, topic, at, lesson_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'generating')
    ON CONFLICT(slug) DO UPDATE SET status='generating', problem=NULL
  `).run(slug, student, subject ?? null, level ?? null, topic ?? null,
         new Date().toISOString(), lessonAt ?? null);
}

export interface FinishLessonInput {
  status: string;
  title?: string | null;
  context?: string | null;
  slides?: string | null;
  homework?: unknown[] | null;
  games?: unknown[] | null;
  problem?: string | null;
}

export function finishLesson(slug: string, { status, title, context, slides, homework, games, problem }: FinishLessonInput): void {
  db.prepare(`
    UPDATE lessons SET status=?, title=?, context=?, slides=?, homework=?, games=?, problem=?
    WHERE slug=?
  `).run(status, title ?? null, context ?? null, slides ?? null,
         homework ? JSON.stringify(homework) : null,
         games ? JSON.stringify(games) : null,
         problem ?? null, slug);
}

export interface LessonSummary {
  slug: string;
  student: string;
  subject: string | null;
  level: string | null;
  topic: string | null;
  title: string | null;
  context: string | null;
  at: string;
  lessonAt: string | null;
  status: string;
  problem: string | null;
  slides: string | null;
  homework: unknown[];
  games: unknown[];
}

/** `student` omitted → every lesson, for the tutor dashboard. */
export function readLessons(student?: string): LessonSummary[] {
  const rows = student
    ? db.prepare(`SELECT * FROM lessons WHERE student=? ORDER BY at DESC LIMIT 50`).all(student) as LessonRow[]
    : db.prepare(`SELECT * FROM lessons ORDER BY at DESC LIMIT 200`).all() as LessonRow[];

  return rows.map(r => ({
    slug: r.slug, student: r.student, subject: r.subject, level: r.level,
    topic: r.topic, title: r.title, context: r.context,
    at: r.at, lessonAt: r.lesson_at, status: r.status, problem: r.problem,
    slides: r.slides,
    homework: safeArr(r.homework),
    games: safeArr(r.games),
  }));
}

const str = (v: unknown, n: number): string | null => (v == null ? null : String(v).slice(0, n));
const int = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : null; };
function safeArr(s: unknown): unknown[] { try { const a = JSON.parse(s as string); return Array.isArray(a) ? a : []; } catch { return []; } }


/** Records that a booking's calendar write failed, for the dashboard to
 *  surface — see the calendar_failures table comment for why this exists. */
export function flagCalendarFailure(booking: { name: string; start: string }, message: unknown): void {
  db.prepare(`
    INSERT INTO calendar_failures (name, start, message, at)
    VALUES (?, ?, ?, ?)
  `).run(booking.name, booking.start, String(message ?? '').slice(0, 300), new Date().toISOString());
}

export function listUnresolvedCalendarFailures(): CalendarFailureRow[] {
  return db.prepare(`
    SELECT id, name, start, message, at FROM calendar_failures
    WHERE resolved = 0 ORDER BY at DESC
  `).all() as CalendarFailureRow[];
}

export function resolveCalendarFailure(id: number | bigint): boolean {
  return db.prepare(`UPDATE calendar_failures SET resolved = 1 WHERE id = ?`).run(id).changes > 0;
}


/* ── Students and their access codes ──────────────────────────────
   The tutor has to be able to read a code out loud to a parent, so these are
   stored as-is rather than hashed. They guard homework and progress notes,
   not money — and the whole list sits behind the tutor's own login. */

const newPin = (): string => String(Math.floor(1000 + Math.random() * 9000));

export interface CreateStudentInput {
  code: string;
  name: string;
  subject?: string | null;
  level?: string | null;
  phone?: string | null;
  password?: string | null;
}

export function createStudent({ code, name, subject, level, phone, password }: CreateStudentInput): StudentRow {
  const row: StudentRow = {
    code, name,
    subject: subject ?? null,
    level: level ?? null,
    student_pin: newPin(),
    parent_pin: newPin(),
    phone: phone ?? null,
    password: password || null,
    created_at: new Date().toISOString(),
  };
  db.prepare(`
    INSERT INTO students (code, name, subject, level, student_pin, parent_pin, phone, password, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.code, row.name, row.subject, row.level,
         row.student_pin, row.parent_pin, row.phone, row.password, row.created_at);
  return row;
}

const normalizeName = (name: unknown): string => String(name ?? '').trim().replace(/\s+/g, ' ');




export function listStudents(): StudentRow[] {
  return db.prepare(`SELECT * FROM students ORDER BY created_at`).all() as StudentRow[];
}

export function getStudent(code: string): StudentRow | null {
  return (db.prepare(`SELECT * FROM students WHERE code = ?`).get(code) as StudentRow | undefined) ?? null;
}



export function deleteStudent(code: string): boolean {
  return db.prepare(`DELETE FROM students WHERE code = ?`).run(code).changes > 0;
}

/** Highest score for this student on this game, or null if they have never
 *  played it. Replaces a broken localStorage personal-best that couldn't see
 *  results recorded from another device. */
export function getBest(student: string, dataId: string): number | null {
  const row = db.prepare(
    `SELECT MAX(score) AS best FROM results WHERE student = ? AND data_id = ?`
  ).get(student, dataId) as { best: number | null } | undefined;
  return row?.best ?? null;
}
