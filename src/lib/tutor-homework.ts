/**
 * One homework task as the tutor's dashboard gets it from
 * /api/students/[code]/activity — declared once, imported by both.
 *
 * The dashboard used to carry its own `{ done: boolean }` copy after #92
 * had split "done" into two stages, so every task rendered unticked and
 * ticking one sent a field the route refuses. See
 * tests/unit/tutor-homework-shape.test.mjs.
 */
import type { HomeworkGrade } from './server/lessons.ts';

export interface TutorHomework {
  id: string;
  task: string;
  /** Due date if one was set, otherwise the day it was assigned. */
  date: string;
  /** Stage one: the child (or the tutor on their behalf) says it is done. */
  submitted: boolean;
  /** Stage two: someone judged it. */
  graded: boolean;
  grade: HomeworkGrade | null;
  submittedBy: string | null;
  gradedBy: string | null;
  /** Booking-time homework the family cannot see yet (migration 018): goes
   *  out when the lesson report replaces or releases it, or at this time. */
  heldUntil: string | null;
  /** The answer key a generator wrote with the task (migration 022). The
   *  tutor's only: FamilyHomework has no such field. */
  answer: string | null;
}
