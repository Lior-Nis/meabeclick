/**
 * The subjects a family can book, declared once: the booking form renders
 * these, and the lesson queue asks `autopilotCovers` before it prepares
 * anything.
 */
export const SUBJECTS = ['מתמטיקה', 'פיזיקה', 'עברית', 'תכנות', 'אחר'] as const;

/**
 * Whether a lesson in this subject is prepared automatically. Maths only:
 * the learning plans and the generation are maths (PRODUCT.md non-goal).
 * The other subjects are still booked and taught, and the tutor prepares
 * them herself — Lior's decision, 2026-09-28.
 */
export function autopilotCovers(subject: string): boolean {
  return subject.trim() === 'מתמטיקה';
}
