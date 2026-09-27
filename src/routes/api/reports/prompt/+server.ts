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
import { authorizedCronRequest } from '$server/cron-auth.ts';
import { promptCandidates, markPrompted } from '$server/reports/store.ts';
import { planForEnrollment, planData, lastLessonAt } from '$server/plans/store.ts';
import { buildTree } from '$server/plans/view.ts';
import { sendReportPromptEmail, emailConfigured, verifyEmailTransport } from '$server/email.ts';
import type { RequestHandler } from './$types';

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
  if (!authorizedCronRequest(event.request.headers.get('x-cron-key'))) {
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

  const result = { considered: lessons.length, emailed, skipped };

  /* This hourly job is the only thing on the box that both runs often and
     exists to send mail, so it is also the cheapest place to notice that
     mail has stopped working.

     On 2026-09-20 the Gmail app password was being refused with
     `535-5.7.8 … BadCredentials` — revoked, most likely when the account
     holder changed their Google password. It had worked two days earlier.
     Nothing reported it: booking mail and the portal link both swallow
     send failures deliberately (a booking must not be lost because mail
     failed, and /api/request-link must not confirm which addresses are on
     file), so the only symptom was families not receiving things.

     A run that sent something has proved the transport, so only a run that
     sent nothing checks. Unconfigured stays a 200 — that is every dev
     machine and the test suite, and boot-checks already says so. Configured
     and refused answers 503, which fails the systemd unit and puts the
     reason in the journal within the hour. */
  if (emailed === 0 && emailConfigured()) {
    const health = await verifyEmailTransport();
    if (!health.ok) {
      console.error('[reports/prompt] mail transport rejected:', health.reason);
      return json(
        { ...result, mail: 'rejected', reason: health.reason },
        { status: 503 },
      );
    }
  }

  return json(result);
};
