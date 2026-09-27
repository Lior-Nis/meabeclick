/**
 * GET /api/remind-family — the reminder the FAMILY gets before a lesson.
 *
 * Todoist id:6hM24r5hGPvwJQmq. /api/remind already exists and reminds the
 * TUTOR to update her calendar; this is the one for the people who have to
 * show up. Separate route rather than a branch inside that one: they have
 * different schedules (that one is weekly, this one runs hourly), different
 * recipients, and different failure meanings.
 *
 * Authenticated by the same shared cron secret — a timer has no cookies and
 * this route is reachable from the internet.
 *
 * ## Answering honestly
 *
 * Returns 200 with counts even when there is nothing to send, because "no
 * lesson is due a reminder this hour" is the normal case and a timer that
 * records failure for it would train everyone to ignore the unit.
 *
 * A send that FAILED is different: the row is marked failed, the tutor is
 * told, and the response says so. It still answers 200 — the run did what
 * it could and the failure is recorded where it can be acted on, which is
 * the distinction #70 drew for the weekly reminder.
 */
import { json } from '@sveltejs/kit';
import { authorizedCronRequest } from '$server/cron-auth.ts';
import { sendLessonReminderEmail, sendCalendarReminderEmail } from '$server/email.ts';
import { pendingReminders, claimReminder, finishReminder } from '$server/reminders.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
  if (!authorizedCronRequest(request.headers.get('x-cron-key'))) {
    return json({ error: 'unauthorized' }, { status: 401 });
  }

  const due = pendingReminders(new Date().toISOString());
  let sent = 0;
  const failed: string[] = [];

  for (const b of due) {
    /* No address, nothing to send to. Claimed anyway so the hourly timer
       does not reconsider the same booking every hour for a day — and
       recorded as failed rather than skipped, because "we could not reach
       this family" is something the tutor should be able to see. */
    if (!b.email) {
      if (claimReminder(b.id, 'before-lesson')) {
        finishReminder(b.id, 'before-lesson', 'failed', 'no email on the account');
        failed.push(`${b.studentName}: אין כתובת מייל`);
      }
      continue;
    }

    /* Claim BEFORE sending. The claim is a UNIQUE insert, so two overlapping
       timer runs cannot both get true for the same booking. */
    if (!claimReminder(b.id, 'before-lesson')) continue;

    try {
      const ok = await sendLessonReminderEmail({
        to: b.email, studentName: b.studentName, start: b.start,
        subject: b.subject, durationMin: b.duration,
      });
      if (ok) {
        finishReminder(b.id, 'before-lesson', 'sent', null);
        sent++;
      } else {
        finishReminder(b.id, 'before-lesson', 'failed', 'mail transport unavailable');
        failed.push(`${b.studentName}: אין תעבורת דואר`);
      }
    } catch (err) {
      const reason = (err as Error).message.slice(0, 200);
      finishReminder(b.id, 'before-lesson', 'failed', reason);
      failed.push(`${b.studentName}: ${reason}`);
    }
  }

  /* «להתריע למורה על כשל». A family that was not reminded is something she
     can still fix by hand, but only if she is told — a failed row nobody
     reads is the same as no reminder at all. Best-effort: a failure to
     report a failure must not fail the run. */
  if (failed.length) {
    try {
      await sendCalendarReminderEmail(
        `⚠️ תזכורות שלא נשלחו למשפחות (${failed.length}):\n${failed.join('\n')}`,
      );
    } catch (err) {
      console.error('[remind-family] could not report failures:', (err as Error).message);
    }
  }

  return json({ ok: true, due: due.length, sent, failed: failed.length });
};
