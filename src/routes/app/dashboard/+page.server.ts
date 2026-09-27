/**
 * Port of pages/app/dashboard.html. Requires a tutor session (spec §6) —
 * this is the page the characterization suite's one previously-failing test
 * targets: an unauthenticated GET here must 302 to /login. requireAuth
 * (src/lib/server/auth.ts) does exactly that for page routes.
 *
 * The old page carried its own client-side lock screen (a PASSWORD constant
 * literally readable in page source, gated further by sessionStorage) as a
 * fallback for opening the file directly with no server. That fallback no
 * longer applies — reaching this route at all now means the request already
 * passed the real server-side session check, so the lock screen is dropped
 * entirely rather than ported as dead code.
 */
import { requireAuth } from '$server/auth.ts';
import { roster, enrollmentsForStudent } from '$server/entities.ts';
import { lessonsAwaitingReport } from '$server/reports/store.ts';
import { planForEnrollment, planData, lastLessonAt } from '$server/plans/store.ts';
import { buildTree } from '$server/plans/view.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  requireAuth(event);
  // The learning-plan link lives on this roster row (task 7), and the design
  // spec calls this panel "already server-backed, unlike the student cards" —
  // it was not, until now: `realStudents` used to start empty and fill in
  // only from onMount's client-side GET /api/students, so a plain GET of
  // this route (no JS run) could never see the row, let alone the link
  // beside it. Seeding it here makes that true without removing the client
  // refresh below, which still keeps the panel live after a link is minted.
  //
  // Pending reports (task 5): a two-week window, same as the fixed inputs
  // the store's own tests use — old enough to catch a lesson she forgot
  // about, not so old the queue fills with lessons nobody will ever report.
  const now = new Date();
  const since = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const rows = roster();
  const learningPlans = Object.fromEntries(rows.map(student => {
    // The dashboard has one learning-plan panel per student. Use the first
    // enrollment with an existing plan as its preview; the dedicated plan
    // page remains the place to switch subjects.
    const plan = enrollmentsForStudent(student.id)
      .map(enrollment => planForEnrollment(enrollment.id))
      .find(Boolean) ?? null;
    if (!plan) return [student.code, null];
    const { nodes, prereqs, events } = planData(plan.id);
    return [student.code, { planId: plan.id, topics: buildTree(nodes, prereqs, events, lastLessonAt(student.id)) }];
  }));
  return { roster: rows, learningPlans, pendingReports: lessonsAwaitingReport(since, now.toISOString()) };
};
