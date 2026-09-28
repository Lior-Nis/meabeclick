/**
 * Telling people when something happened — pre-launch review, 2026-09-28.
 * The tutor never heard that a child handed work in, and a family never
 * heard that a lesson was reported. Todoist 6hfCvVRxF6J86Cvq.
 *
 * Channels, chosen with what already works: the tutor on WhatsApp (as for
 * every other tutor alert), the family by email (as for booking and the
 * lesson reminder).
 */
import { accountForStudent } from './entities.ts';
import { handle } from './db.ts';
import { homeworkForStudent } from './lessons.ts';
import { accountLink } from './family-auth.ts';
import { claimReminder, finishReminder } from './reminders.ts';
import { sendLessonReportedEmail } from './email.ts';

/**
 * A child handed work in. Only on the change to "handed in", and only when
 * the child did it: an undo, a repeat tap or the tutor marking it herself
 * is not news to the tutor.
 */
export async function noticeHomeworkSubmitted(
  e: { studentName: string; task: string; wasSubmitted: boolean; nowSubmitted: boolean; by: 'student' | 'teacher' },
  send: (text: string) => Promise<void> | void,
): Promise<void> {
  if (e.by !== 'student' || e.wasSubmitted || !e.nowSubmitted) return;
  await send(`📥 ${e.studentName} הגיש/ה שיעורי בית: ${e.task}\nאפשר לבדוק בלוח הבקרה.`);
}

export type AfterReportEmail = 'sent' | 'already-sent' | 'no-email' | 'not-sent' | 'no-booking';

/**
 * The family's "lesson reported" email: that lesson's homework as the
 * family can already see it, and a link to their page. Once per lesson —
 * claimed in lesson_reminders like the reminder, so re-filing a report
 * does not send it again.
 */
export async function emailFamilyAfterReport(
  bookingId: number,
  deps: { send?: typeof sendLessonReportedEmail } = {},
): Promise<AfterReportEmail> {
  const send = deps.send ?? sendLessonReportedEmail;
  const booking = handle().prepare(`SELECT id, student_id, start FROM bookings_v2 WHERE id = ?`)
    .get(bookingId) as { id: number; student_id: number; start: string } | undefined;
  if (!booking) return 'no-booking';

  const account = accountForStudent(booking.student_id);
  const student = handle().prepare(`SELECT name FROM students_v2 WHERE id = ?`)
    .get(booking.student_id) as { name: string } | undefined;
  if (!claimReminder(bookingId, 'after-report')) return 'already-sent';
  if (!account?.email || !student) {
    finishReminder(bookingId, 'after-report', 'failed', 'no email on the account');
    return 'no-email';
  }

  // homeworkForStudent's default hides held rows: only what the family sees.
  const tasks = homeworkForStudent(booking.student_id)
    .filter(h => h.booking_id === bookingId)
    .map(h => h.task);
  try {
    const ok = await send({ to: account.email, studentName: student.name, lessonStart: booking.start,
      tasks, link: accountLink(account.id) });
    finishReminder(bookingId, 'after-report', ok ? 'sent' : 'failed', ok ? null : 'mail transport unavailable');
    return ok ? 'sent' : 'not-sent';
  } catch (err) {
    finishReminder(bookingId, 'after-report', 'failed', (err as Error).message.slice(0, 200));
    return 'not-sent';
  }
}
