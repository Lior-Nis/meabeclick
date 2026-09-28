/**
 * Reminding the family before a lesson, once.
 *
 * Todoist id:6hM24r5hGPvwJQmq. A family gets a booking confirmation and
 * then nothing; the only reminder in the system goes to the TUTOR
 * (/api/remind, a nudge to update her calendar), so the people who have to
 * show up are the ones nobody reminds.
 *
 * ## Email, because it is the only channel that reaches a family
 *
 * CallMeBot is tutor-only by construction: its key can only be obtained by
 * messaging from the recipient's own phone, so it cannot address a family.
 * Email already works end to end for booking confirmations through the same
 * transport. Choosing the channel that exists beats designing for one that
 * does not.
 *
 * ## The window, and why it has both ends
 *
 * A reminder goes out when the lesson is between 2 and 24 hours away.
 *
 * The far end: reminding on Monday about Friday is not a reminder, it is
 * noise, and noise is how a family learns to ignore the message that
 * matters.
 *
 * The near end matters more. Inside two hours they already know, and a
 * timer that runs hourly could otherwise deliver a "reminder" after the
 * lesson had started — which reads as a system that does not know what day
 * it is.
 */
import { handle } from './db.ts';

/** 'after-report' is the family's "lesson reported" email (notices.ts). */
export type ReminderKind = 'before-lesson' | 'after-report';
export type ReminderStatus = 'pending' | 'sent' | 'failed';

export type ReminderRow = {
  id: number; booking_id: number; kind: string;
  status: ReminderStatus; detail: string | null; at: string;
};

/** A booking as the selection rule needs to see it. */
export interface RemindableBooking { id: number; start: string; status: string }

const HOUR = 3600e3;
const NEAR = 2 * HOUR;
const FAR = 24 * HOUR;

/**
 * Which of these bookings are inside the reminder window right now.
 *
 * PURE — no database, no clock. This is the decision that goes quietly
 * wrong at a timezone boundary, so it is tested directly rather than read
 * out of a route. Times are compared as instants (ISO strings parse to
 * UTC), which is why no timezone conversion happens here at all: "20 hours
 * from now" means the same thing in every zone, and only the *rendering*
 * of the time in the message is Israel-local.
 */
export function dueForReminder(
  bookings: RemindableBooking[], nowIso: string,
): RemindableBooking[] {
  const now = Date.parse(nowIso);
  return bookings.filter(b => {
    if (b.status !== 'confirmed') return false;   // cancelled, or anything else
    const start = Date.parse(b.start);
    if (!Number.isFinite(start)) return false;
    const away = start - now;
    return away > NEAR && away <= FAR;
  });
}

/**
 * Take ownership of sending this reminder, or report that someone already
 * has.
 *
 * The UNIQUE (booking_id, kind) constraint IS the idempotency guarantee —
 * not a query this caller has to remember to run first. A retry inserts,
 * hits the constraint, and returns false, so it sends nothing.
 *
 * The row is written BEFORE the send. A crash mid-send therefore leaves a
 * 'pending' row that will never retry, and that is the right side to fail
 * on: reminding a family twice about one lesson is worse than not
 * reminding them, because the second message makes the first untrusted.
 */
export function claimReminder(bookingId: number, kind: ReminderKind): boolean {
  try {
    handle().prepare(
      `INSERT INTO lesson_reminders (booking_id, kind, status, at) VALUES (?, ?, 'pending', ?)`
    ).run(bookingId, kind, new Date().toISOString());
    return true;
  } catch {
    /* The only way this insert fails in practice is the UNIQUE constraint,
       which is the answer we want rather than an error: someone already
       claimed it. */
    return false;
  }
}

/** Record what actually happened, so a failure is distinguishable from a
 *  reminder nobody tried to send. */
export function finishReminder(
  bookingId: number, kind: ReminderKind, status: ReminderStatus, detail: string | null,
): void {
  handle().prepare(
    `UPDATE lesson_reminders SET status = ?, detail = ?, at = ? WHERE booking_id = ? AND kind = ?`
  ).run(status, detail, new Date().toISOString(), bookingId, kind);
}

export function reminderFor(bookingId: number, kind: ReminderKind): ReminderRow | null {
  return (handle().prepare(
    `SELECT id, booking_id, kind, status, detail, at FROM lesson_reminders
      WHERE booking_id = ? AND kind = ?`
  ).get(bookingId, kind) as ReminderRow) ?? null;
}

/**
 * Bookings inside the window that no reminder has been claimed for.
 *
 * The `status = 'confirmed'` filter is repeated here rather than left to
 * dueForReminder: a cancelled lesson should not even be fetched, and the
 * two agreeing is cheaper than one of them being the only guard.
 */
export function pendingReminders(nowIso: string): (RemindableBooking & {
  studentName: string; email: string | null; subject: string | null; duration: number | null;
})[] {
  const rows = handle().prepare(`
    SELECT b.id AS id, b.start AS start, b.status AS status, b.duration AS duration,
           s.name AS studentName, a.email AS email, e.subject AS subject
    FROM bookings_v2 b
    JOIN students_v2 s ON s.id = b.student_id
    JOIN accounts a    ON a.id = s.account_id
    LEFT JOIN enrollments e ON e.id = b.enrollment_id
    WHERE b.status = 'confirmed'
      AND NOT EXISTS (
        SELECT 1 FROM lesson_reminders r
         WHERE r.booking_id = b.id AND r.kind = 'before-lesson'
      )
  `).all() as unknown as (RemindableBooking & {
    studentName: string; email: string | null; subject: string | null; duration: number | null;
  })[];

  const due = new Set(dueForReminder(rows, nowIso).map(b => b.id));
  return rows.filter(r => due.has(r.id));
}
