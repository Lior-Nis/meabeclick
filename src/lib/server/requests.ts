/**
 * Lesson requests — a note toward a lesson, kept apart by who it came from.
 *
 * A parent's booking-time note, a student's own note, and a tutor's
 * observation are three different kinds of claim and must never be merged
 * into one signal — that is what migration 009_lesson_requests.ts's
 * `source` CHECK enforces. This module never writes into plan_events,
 * plans, or any other progress/mastery surface: a request is what someone
 * asked for, not evidence of what a student has mastered.
 */
import { handle } from './db.ts';

export type LessonRequestSource = 'parent' | 'student' | 'teacher';

export type LessonRequestRow = {
  id: number;
  booking_id: number | null;
  student_id: number;
  source: LessonRequestSource;
  text: string;
  at: string;
};

export function addLessonRequest(r: {
  bookingId?: number | null;
  studentId: number;
  source: LessonRequestSource;
  text: string;
}): void {
  handle().prepare(`
    INSERT INTO lesson_requests (booking_id, student_id, source, text, at)
    VALUES (?, ?, ?, ?, ?)
  `).run(r.bookingId ?? null, r.studentId, r.source, r.text, new Date().toISOString());
}

export function requestsForStudent(studentId: number): LessonRequestRow[] {
  return handle().prepare(
    `SELECT * FROM lesson_requests WHERE student_id = ? ORDER BY id DESC`
  ).all(studentId) as LessonRequestRow[];
}
