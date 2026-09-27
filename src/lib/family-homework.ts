/**
 * Homework as the family pages get it from /api/portal/[code] — declared
 * once, imported by the API and both family pages.
 *
 * The parent page kept its own `{ done: boolean }` copy after #92 split
 * "done" into two stages, so every task said «פתוח» forever, even handed in
 * and graded — the same drift the tutor's checkbox had (#126).
 */
export interface FamilyHomework {
  id?: number;
  task: string;
  assigned?: string | null;
  due?: string | null;
  /** Stage one: the child (or the tutor for them) says it is done. */
  submitted: boolean;
  /** Stage two: someone judged it. */
  graded: boolean;
  grade?: 'ok' | 'partial' | 'redo' | null;
  gradedBy?: string | null;
  template?: string;
  dataId?: string;
  url?: string;
}

export type HomeworkState = 'open' | 'submitted' | 'graded';

/** The one reading of the two stages every page shows. */
export function homeworkState(h: { submitted?: boolean; graded?: boolean }): HomeworkState {
  if (h.graded) return 'graded';
  if (h.submitted) return 'submitted';
  return 'open';
}

export const HOMEWORK_STATE_LABEL: Record<HomeworkState, string> = {
  open: 'פתוח',
  submitted: 'הוגש — ממתין לבדיקה',
  graded: 'נבדק',
};
