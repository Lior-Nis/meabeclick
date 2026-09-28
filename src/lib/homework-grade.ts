/**
 * How homework is judged — the grades and their words, declared once for
 * the tutor's buttons and the child's badge.
 */
export type HomeworkGrade = 'ok' | 'partial' | 'redo';

export const GRADES: HomeworkGrade[] = ['ok', 'partial', 'redo'];

/** What the child and the parent read. */
export const GRADE_LABEL: Record<HomeworkGrade, string> = {
  ok: 'נבדק — יפה מאוד',
  partial: 'נבדק — חלקית',
  redo: 'נבדק — כדאי לחזור על זה',
};

/** The tutor's grading buttons. */
export const GRADE_BUTTON: Record<HomeworkGrade, string> = {
  ok: '✓ יפה מאוד',
  partial: 'חלקית',
  redo: 'לחזור על זה',
};
