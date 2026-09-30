/**
 * The one subject a family books: every lesson is maths (Todoist
 * 6hfrX4XvwJRjccRq, 2026-09-30). The booking form does not ask, and
 * /api/book records a booking that names no subject as this one.
 */
export const SUBJECT = 'מתמטיקה';

/**
 * Whether a lesson in this subject is prepared automatically. Maths only:
 * the learning plans and the generation are maths (PRODUCT.md non-goal).
 * Kept for records made before the site became maths-only (2026-09-28 to
 * 2026-09-30, when other subjects could still be booked): the tutor
 * prepares those herself.
 */
export function autopilotCovers(subject: string): boolean {
  return subject.trim() === 'מתמטיקה';
}
