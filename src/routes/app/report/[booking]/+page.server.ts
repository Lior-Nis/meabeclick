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
import { evidenceForSkill } from '$server/plans/evidence.ts';
import { suggestStatus } from '$server/plans/suggest.ts';
import { buildTree, type TopicView } from '$server/plans/view.ts';
import { templatesForSubject } from '$server/plans/templates.ts';
import { getStudentById, enrollmentsForStudent } from '$server/entities.ts';
import type { SkillStatus } from '$lib/plan-status.ts';
import type { PageServerLoad } from './$types';

const IN_PROGRESS = ['needs_review', 'guided', 'with_help', 'started'];

export const load: PageServerLoad = async (event) => {
  requireAuth(event);

  const booking = bookingForReport(Number(event.params.booking));
  if (!booking) error(404, 'לא נמצא');

  const student = getStudentById(booking.student_id);
  if (!student) error(404, 'לא נמצא');

  const enrollment = enrollmentsForStudent(student.id).find(e => e.id === booking.enrollment_id) ?? null;

  // /api/reports already refuses a cancelled or not-yet-ended booking (400
  // in both cases) — the loader only checked that the booking exists, so a
  // lesson cancelled after the prompt email went out (or, rarer, a stale
  // link opened before the lesson ends) still rendered a full, fillable
  // form that was always going to be refused on submit. Checking here means
  // she is told BEFORE typing anything, not after.
  // booking.end keeps the client's original offset, not normalized to UTC —
  // same reasoning as /api/reports's own check, and new Date(...).getTime()
  // parses either offset correctly, unlike a string compare.
  if (booking.status !== 'confirmed') {
    return {
      reportable: false as const,
      reason: 'השיעור הזה בוטל, ואי אפשר לדווח עליו.',
      booking: { id: booking.id, start: booking.start, end: booking.end },
      student: { code: student.code, name: student.name },
      subject: enrollment?.subject ?? null,
    };
  }
  if (new Date(booking.end).getTime() > Date.now()) {
    return {
      reportable: false as const,
      reason: 'השיעור הזה עוד לא הסתיים — אפשר לדווח עליו אחרי שהוא נגמר.',
      booking: { id: booking.id, start: booking.start, end: booking.end },
      student: { code: student.code, name: student.name },
      subject: enrollment?.subject ?? null,
    };
  }

  const plan = booking.enrollment_id ? planForEnrollment(booking.enrollment_id) : null;
  const report = reportForBooking(booking.id);

  let tree: TopicView[] = [];
  // What THIS report actually recorded, for the correction view — resolved
  // to titles here (server-side, where the node list already lives) rather
  // than left to the page to cross-reference ids against the tree. Fix
  // round 1, item 2: the events carrying this report's id are the source
  // of truth for "what was filed", not something re-derived from the
  // current tree, which may have moved on since.
  let filedEntries: { title: string; status: SkillStatus }[] = [];
  if (plan) {
    const { nodes, prereqs, events } = planData(plan.id);
    tree = buildTree(nodes, prereqs, events, lastLessonAt(student.id));
    if (report) {
      const titleById = new Map(nodes.map(n => [n.id, n.title]));
      filedEntries = events
        .filter(e => e.type === 'status' && e.report_id === report.id && e.node_id !== null)
        .map(e => ({ title: titleById.get(e.node_id!) ?? '', status: e.status as SkillStatus }));
    }
  }

  /* A DRAFT beside each skill, computed from the practice the system
     already recorded (spec §6 step 5). It is offered, never applied: the
     page must not preselect it, because a tutor confirming the system's
     opinion instead of recording her own is the inference this whole task
     exists to remove.

     Null for almost every skill today — the engine is silent below its
     thresholds and most skills have no linked practice at all — and the
     page renders nothing in that case rather than an empty chip. */
  const skills = tree.flatMap(t => t.branches.flatMap(b =>
    b.skills.map(s => ({
      ...s, topic: t.title, branch: b.title,
      draft: suggestStatus(evidenceForSkill(student.id, s.id)),
    }))))
    .filter(s => s.visibility !== 'hidden');

  return {
    reportable: true as const,
    booking: { id: booking.id, start: booking.start, end: booking.end },
    student: { code: student.code, name: student.name },
    subject: enrollment?.subject ?? null,
    planId: plan?.id ?? null,
    report,
    filedEntries,
    // Offered first, then everything else behind the search line.
    suggested: skills.filter(s => s.recommended || IN_PROGRESS.includes(s.status)),
    rest: skills.filter(s => !(s.recommended || IN_PROGRESS.includes(s.status))),
    templates: !plan && enrollment
      ? templatesForSubject(enrollment.subject).map(t => ({ id: t.id, track: t.track }))
      : [],
  };
};
