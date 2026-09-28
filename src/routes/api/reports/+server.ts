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
import { afterReport } from '$server/reports/after.ts';
import { emailFamilyAfterReport } from '$server/notices.ts';
import { sendWhatsApp } from '$server/lesson/queue.ts';
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
  // booking.end keeps the client's original offset (e.g. +03:00), not
  // normalized to UTC — comparing it against toISOString()'s always-Z
  // string with `>` is a lexicographic compare of two different formats,
  // not a comparison of instants. new Date(...).getTime() parses both
  // correctly regardless of which offset each carries.
  if (new Date(booking.end).getTime() > Date.now()) {
    return json({ error: 'אי אפשר לדווח על שיעור שטרם הסתיים' }, { status: 400 });
  }

  const note = body.note == null ? null : String(body.note);
  if (note !== null && note.length > MAX_NOTE) return json({ error: 'ההערה ארוכה מדי' }, { status: 400 });

  const plan = booking.enrollment_id ? planForEnrollment(booking.enrollment_id) : null;

  const raw = Array.isArray(body.entries) ? body.entries : [];
  // Migration 006 leaves enrollment_id NULL for a student with more than one
  // subject; the controller ruling on that is a note-only report still
  // lands (§ below never runs for entries.length === 0), but a skill claim
  // has no plan to check itself against and is a 400, not the 404 a
  // wrong-plan node id gets — this is a different failure than "not found".
  if (raw.length > 0 && !plan) {
    return json({ error: 'לשיעור הזה אין תכנית לימודים — אפשר לדווח רק הערה' }, { status: 400 });
  }

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
    // plan is non-null here (checked above whenever raw is non-empty).
    if (!plan || !nodeInPlan(plan.id, id)) return json(NOT_FOUND, { status: 404 });
    entries.push({ nodeId: id, status: String(status) as SkillStatus });
  }

  // fileReport can still refuse (a non-skill node id, or — for a direct
  // store caller rather than this validated route — a booking/plan
  // mismatch this route already checked above). Its error messages carry
  // booking and plan ids for the log, which must never reach the tutor's
  // browser as a raw 500; map every failure to a 400 with a fixed message.
  try {
    fileReport({ bookingId: booking.id, note, entries });
  } catch (err) {
    console.error('[reports] file failed:', (err as Error).message);
    return json({ error: 'אי אפשר לשמור את הדיווח הזה' }, { status: 400 });
  }

  /* Homework from what was actually taught (spec 2026-09-25). Not awaited:
     it may run an agent for minutes, and the lesson's held homework goes
     out on its own a day after the lesson if this never finishes. */
  afterReport({ bookingId: booking.id, note, nodeIds: entries.map(e => e.nodeId) }, { notify: sendWhatsApp })
    .catch(err => console.error('[reports] after-report failed:', (err as Error).message))
    /* Then the family's "lesson reported" email — after, so the homework it
       lists is the homework they can now see. Once per lesson. */
    .then(() => emailFamilyAfterReport(booking.id))
    .catch(err => console.error('[reports] family email failed:', (err as Error).message));

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
