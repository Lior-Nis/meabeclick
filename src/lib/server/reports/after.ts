/**
 * What a filed lesson report does to that lesson's homework.
 *
 * Spec: docs/superpowers/specs/2026-09-25-homework-from-what-was-taught-design.md
 *
 *   held rows gone already       → nothing   (D4: a late report, or a
 *                                             second filing after a replace)
 *   no skills covered            → release   (D3: a note is not enough to
 *                                             write exercises from)
 *   skills covered, generation ok → replace  with homework from those skills
 *   generation failed            → release, and tell the tutor
 *
 * Runs after fileReport() has committed, and is NOT awaited by the route:
 * a tutor filing a report must not wait minutes for an agent. Everything it
 * does is recoverable by the 24h fallback, which needs nothing from here.
 */
import { enrollmentsForStudent } from '../entities.ts';
import { heldHomeworkForBooking, releaseHeld, replaceHeld } from '../lessons.ts';
import { nodeInPlan, planForEnrollment } from '../plans/store.ts';
import { generateTaughtHomework, type TaughtSkill } from '../lesson/homework.ts';
import { bookingForReport } from './store.ts';

export type AfterReportOutcome = 'none' | 'released' | 'replaced' | 'released-after-failure';

const FAILED = '⚠️ לא הצלחנו להכין שיעורי בית ממה שנלמד — נשלחו שיעורי הבית שהוכנו מראש';

export async function afterReport(
  input: { bookingId: number; note: string | null; nodeIds: number[] },
  deps: {
    generate?: typeof generateTaughtHomework;
    notify?: (text: string) => Promise<void> | void;
    now?: string;
  } = {},
): Promise<AfterReportOutcome> {
  const { generate = generateTaughtHomework, notify, now = new Date().toISOString() } = deps;

  if (!heldHomeworkForBooking(input.bookingId, now).length) return 'none';
  if (!input.nodeIds.length) {
    releaseHeld(input.bookingId);
    return 'released';
  }

  const booking = bookingForReport(input.bookingId);
  try {
    if (!booking?.enrollment_id) throw new Error('booking has no enrollment');
    const enrollment = enrollmentsForStudent(booking.student_id).find(e => e.id === booking.enrollment_id);
    const plan = planForEnrollment(booking.enrollment_id);
    if (!enrollment || !plan) throw new Error('no enrollment plan for this booking');

    const skills: TaughtSkill[] = [];
    for (const id of new Set(input.nodeIds)) {
      const node = nodeInPlan(plan.id, id);
      if (node?.kind === 'skill') skills.push({ key: node.key, title: node.title, nodeId: node.id });
    }
    if (!skills.length) throw new Error('no covered skill resolved');

    const tasks = await generate({
      subject: enrollment.subject, level: enrollment.level ?? '', skills, note: input.note,
    });
    /* False when the held rows went out while generating — another filing,
       a release, or the fallback. What the family already has stands. */
    return replaceHeld(input.bookingId, booking.student_id, tasks) ? 'replaced' : 'none';
  } catch (err) {
    console.error(`[after-report] booking ${input.bookingId}: ${(err as Error).message}`);
    releaseHeld(input.bookingId);
    await Promise.resolve(notify?.(FAILED)).catch(() => {});
    return 'released-after-failure';
  }
}
