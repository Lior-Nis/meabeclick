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
import { nodeInPlan, planForEnrollment } from '../plans/store.ts';
import type { SkillStatus } from '../../plan-status.ts';

export type ReportRow = {
  id: number; booking_id: number; student_id: number; enrollment_id: number | null;
  note: string | null; created_at: string; updated_at: string;
};

export type BookingRow = {
  id: number; student_id: number; enrollment_id: number | null;
  start: string; end: string; status: string;
};

export type PendingLesson = {
  bookingId: number; studentId: number; studentCode: string; studentName: string;
  /** NULL for exactly the enrollment-less bookings migration 006 leaves
   *  behind (a student with more than one subject) — the LEFT JOIN below
   *  finds no enrollment row to name. */
  subject: string | null; enrollmentId: number | null; start: string; end: string;
};

export type ReportNoteRow = { id: number; report_id: number; note: string | null; at: string };

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

/**
 * bookings_v2."end" keeps the client's original offset (e.g. +03:00), not
 * normalized to UTC, so comparing it directly against a Z-formatted
 * parameter with <=/>= is a lexicographic compare of two different string
 * formats, not a comparison of instants — a lesson that ended hours ago can
 * read as "not ended yet" purely because its offset digits sort differently.
 * SQLite's datetime() renders both sides as UTC, so wrapping every "end"
 * comparison in datetime(...) compares the actual instants instead. This
 * does not touch how bookings are stored — only how they are compared.
 */
/** Finished, unreported lessons — newest first — no older than `sinceIso`.
 *  `sinceIso` comes first because it is the one parameter every real caller
 *  must decide; `nowIso` is what a test overrides and a real caller never
 *  does, so the default on it is the one worth keeping reachable. */
export function lessonsAwaitingReport(sinceIso: string, nowIso: string = now()): PendingLesson[] {
  return handle().prepare(
    `${PENDING_SELECT} AND datetime(b."end") <= datetime(?) AND datetime(b."end") >= datetime(?) ORDER BY datetime(b."end") DESC`
  ).all(nowIso, sinceIso) as PendingLesson[];
}

/** Lessons to email about: settled, not stale, not already emailed. */
export function promptCandidates(nowIso: string = now()): PendingLesson[] {
  return handle().prepare(
    `${PENDING_SELECT}
       AND datetime(b."end") <= datetime(?)
       AND datetime(b."end") >= datetime(?)
       AND NOT EXISTS (SELECT 1 FROM report_prompts p WHERE p.booking_id = b.id)
     ORDER BY datetime(b."end") ASC`
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

/** The note's history, oldest first — one row per filing (see migration 007).
 *  lesson_reports.note only ever holds the latest; this is what a
 *  correction is not allowed to erase. */
export function notesForReport(reportId: number): ReportNoteRow[] {
  return handle().prepare(
    `SELECT id, report_id, note, at FROM lesson_report_notes WHERE report_id = ? ORDER BY id`
  ).all(reportId) as ReportNoteRow[];
}

/**
 * Files a report, or corrects one. Returns the report id.
 *
 * A correction updates the row's note and APPENDS its events — the plan's
 * history is what she thought then and what she thinks now, never a rewrite.
 * Every event carries evidence 'lesson': the tutor watched it happen.
 *
 * A booking with no enrollment (migration 006's ambiguous-subject case) is
 * accepted as long as no entries are given — a note-only report has no
 * skill claim to validate against a plan that may not even exist, and the
 * controller ruling on this is to let the report land rather than hide the
 * lesson from the queue. Entries on such a booking still refuse: there is
 * no plan to check them against.
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

    // If entries are provided, enrollment must exist and have a plan.
    // A note-only report (entries.length === 0) needs neither.
    let plan = null;
    if (input.entries.length > 0) {
      if (!booking.enrollment_id) throw new Error(`booking ${input.bookingId} has no enrollment`);
      plan = planForEnrollment(booking.enrollment_id);
      if (!plan) throw new Error(`enrollment ${booking.enrollment_id} has no plan`);
    }

    const existing = reportForBooking(input.bookingId);
    let reportId: number;

    if (existing) {
      db.prepare(`UPDATE lesson_reports SET note = ?, updated_at = ? WHERE id = ?`)
        .run(input.note, at, existing.id);
      reportId = existing.id;
    } else {
      // lesson_reports.enrollment_id is nullable since migration 007 —
      // booking.enrollment_id may itself be NULL here, and that is fine for
      // a note-only filing (checked above for the entries case).
      db.prepare(
        `INSERT INTO lesson_reports (booking_id, student_id, enrollment_id, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(input.bookingId, booking.student_id, booking.enrollment_id, input.note, at, at);
      reportId = Number((db.prepare(`SELECT last_insert_rowid() AS id`).get() as { id: number }).id);
    }

    // The note's own history — a row per filing, appended never rewritten
    // (spec §4/§3 apply to the note the same way they apply to skill status).
    db.prepare(
      `INSERT INTO lesson_report_notes (report_id, note, at) VALUES (?, ?, ?)`
    ).run(reportId, input.note, at);

    // For each entry, verify it belongs to this lesson's plan before writing.
    // plan is guaranteed non-null here because we only reach this if entries is non-empty
    for (const entry of input.entries) {
      const node = nodeInPlan(plan!.id, entry.nodeId);
      if (!node) throw new Error(`node ${entry.nodeId} not in plan ${plan!.id}`);
      if (node.kind !== 'skill') throw new Error(`node ${entry.nodeId} is not a skill`);

      // The event carries this filing's note too, so the plan's own history
      // explains itself without a reader having to cross-reference report_id
      // back to lesson_reports (or lesson_report_notes) to see what she wrote.
      db.prepare(
        `INSERT INTO plan_events (plan_id, node_id, type, status, note, evidence, source, report_id, at)
         VALUES (?, ?, 'status', ?, ?, 'lesson', 'report', ?, ?)`
      ).run(plan!.id, entry.nodeId, entry.status, input.note, reportId, at);

      /* And the separate fact that it was TAUGHT.
       
         A report entry is the tutor saying she assessed this skill in this
         lesson, which means it was taught or practised — and that is a
         different claim from how it went. Migration 011 added `covered`
         for exactly this, and the plan page already renders
         «נלמד, טרם נבדק» from it, but nothing on this path ever wrote one:
         addCoveredEvent was reachable only from the plan's own events API,
         a separate action a tutor has no reason to take after filing a
         report. So the fact the design rests on was never recorded, and
         "suggest only from material actually taught" was unreachable — a
         plan knows what was PLANNED; only a report knows what happened.
       
         Guarded per (report, node) rather than appended blindly: re-filing
         is a CORRECTION of the same lesson. Its status history appends,
         which is the point of a correction, but the child was not taught it
         twice and a second row would say she was. */
      const alreadyCovered = db.prepare(
        `SELECT 1 FROM plan_events
          WHERE plan_id = ? AND node_id = ? AND type = 'covered' AND report_id = ?
          LIMIT 1`
      ).get(plan!.id, entry.nodeId, reportId);

      if (!alreadyCovered) {
        db.prepare(
          `INSERT INTO plan_events (plan_id, node_id, type, note, source, report_id, at)
           VALUES (?, ?, 'covered', NULL, 'report', ?, ?)`
        ).run(plan!.id, entry.nodeId, reportId, at);
      }
    }

    db.exec('COMMIT');
    return reportId;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
