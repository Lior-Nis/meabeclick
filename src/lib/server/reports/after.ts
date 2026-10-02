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
 *   generation failed, and a covered skill has a ready library lesson
 *                                 → replace  with that lesson's homework
 *   generation failed otherwise   → release, and tell the tutor
 *
 * Runs after fileReport() has committed, and is NOT awaited by the route:
 * a tutor filing a report must not wait minutes for an agent. Everything it
 * does is recoverable by the 24h fallback, which needs nothing from here.
 */
import { enrollmentsForStudent } from '../entities.ts';
import { heldHomeworkForBooking, lessonsForStudent, releaseHeld, replaceHeld } from '../lessons.ts';
import { nodeInPlan, planForEnrollment } from '../plans/store.ts';
import { generateTaughtHomework, type TaughtSkill, type TaughtTask } from '../lesson/homework.ts';
import { libraryPlanFor } from '../library/use.ts';
import { attachTaughtGames } from '../library/report-games.ts';
import { bookingForReport } from './store.ts';

export type AfterReportOutcome = 'none' | 'released' | 'replaced' | 'replaced-from-library' | 'released-after-failure';

const FAILED = '⚠️ לא הצלחנו להכין שיעורי בית ממה שנלמד — נשלחו שיעורי הבית שהוכנו מראש';
const FROM_LIBRARY = 'ℹ️ מנוע השיעורים לא זמין, ולכן שיעורי הבית ממה שנלמד נלקחו מהספרייה';
/** The same ceiling generateTaughtHomework keeps. */
const MAX_TASKS = 5;

/**
 * Homework for the covered skills from their ready library lessons, taken
 * in turn so each skill gets some before the ceiling — no engine needed.
 * Every master's homework was written for exactly that skill, with its
 * answer key. Found 2026-10-02: production's Codex was out until 12.10, so
 * every report's generation failed and the child got the homework planned
 * before the lesson instead of homework from what was taught.
 */
export function libraryHomework(templateId: string, skills: TaughtSkill[]): TaughtTask[] {
  const lists = skills.map(s => (libraryPlanFor(templateId, s.key)?.plan.homework ?? [])
    .filter(h => typeof h?.task === 'string' && h.task.trim())
    .map(h => ({ task: h.task, nodeId: s.nodeId, answer: typeof h.answer === 'string' && h.answer.trim() ? h.answer : null })));
  const out: TaughtTask[] = [];
  for (let i = 0; out.length < MAX_TASKS && lists.some(l => i < l.length); i++) {
    for (const l of lists) if (i < l.length && out.length < MAX_TASKS) out.push(l[i]);
  }
  return out;
}

/** Library games for the covered skills, into this booking's lesson (see
 *  library/report-games.ts). On every filing, whatever happens to the
 *  homework, and never in its way: a failure here is only logged. */
async function gamesForWhatWasTaught(bookingId: number, nodeIds: number[]): Promise<void> {
  if (!nodeIds.length) return;
  try {
    const booking = bookingForReport(bookingId);
    if (!booking?.enrollment_id) return;
    const plan = planForEnrollment(booking.enrollment_id);
    const lesson = lessonsForStudent(booking.student_id).find(l => l.lesson_at === booking.start);
    if (!plan || !lesson) return;
    const skills = [...new Set(nodeIds)].map(id => nodeInPlan(plan.id, id))
      .filter(n => n?.kind === 'skill').map(n => ({ key: n!.key, nodeId: n!.id }));
    await attachTaughtGames({ lessonSlug: lesson.slug, studentId: booking.student_id, templateId: plan.template_id, skills });
  } catch (err) {
    console.error(`[after-report] games for booking ${bookingId}: ${(err as Error).message}`);
  }
}

export async function afterReport(
  input: { bookingId: number; note: string | null; nodeIds: number[] },
  deps: {
    generate?: typeof generateTaughtHomework;
    notify?: (text: string) => Promise<void> | void;
    now?: string;
  } = {},
): Promise<AfterReportOutcome> {
  const { generate = generateTaughtHomework, notify, now = new Date().toISOString() } = deps;

  await gamesForWhatWasTaught(input.bookingId, input.nodeIds);

  if (!heldHomeworkForBooking(input.bookingId, now).length) return 'none';
  if (!input.nodeIds.length) {
    releaseHeld(input.bookingId);
    return 'released';
  }

  const booking = bookingForReport(input.bookingId);
  /* Kept outside the try: the library fallback below needs them. */
  let templateId: string | null = null;
  const skills: TaughtSkill[] = [];
  try {
    if (!booking?.enrollment_id) throw new Error('booking has no enrollment');
    const enrollment = enrollmentsForStudent(booking.student_id).find(e => e.id === booking.enrollment_id);
    const plan = planForEnrollment(booking.enrollment_id);
    if (!enrollment || !plan) throw new Error('no enrollment plan for this booking');
    templateId = plan.template_id;

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
    const fromLibrary = templateId && booking ? libraryHomework(templateId, skills) : [];
    if (fromLibrary.length && booking) {
      if (!replaceHeld(input.bookingId, booking.student_id, fromLibrary)) return 'none';
      await Promise.resolve(notify?.(FROM_LIBRARY)).catch(() => {});
      return 'replaced-from-library';
    }
    releaseHeld(input.bookingId);
    await Promise.resolve(notify?.(FAILED)).catch(() => {});
    return 'released-after-failure';
  }
}
