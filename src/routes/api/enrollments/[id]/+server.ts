/**
 * Moving a student to another tutor, from their card on the dashboard. It
 * changes that enrollment's tutor and nothing else: lessons already booked
 * keep the tutor they were booked with (spec D6), and the next booking
 * follows the new one.
 */
import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { readJson } from '$server/http.ts';
import { getTeacher, setEnrollmentTeacher } from '$server/entities.ts';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;
  const parsed = await readJson(event.request);
  if (parsed instanceof Response) return parsed;

  const teacherId = Number((parsed as { teacherId?: unknown } | null)?.teacherId);
  const teacher = Number.isInteger(teacherId) && teacherId > 0 ? getTeacher(teacherId) : null;
  if (!teacher?.active) return json({ error: 'המורה הזה/הזאת לא נמצא/ת' }, { status: 400 });

  const id = Number(event.params.id);
  const enrollment = Number.isInteger(id) && id > 0 ? setEnrollmentTeacher(id, teacher.id) : null;
  if (!enrollment) return json({ error: 'enrollment not found' }, { status: 404 });
  return json({ enrollment: { id: enrollment.id, subject: enrollment.subject, teacherId: enrollment.teacher_id } });
};
