/**
 * Creates a learning plan: one enrollment's copy of a reviewed template.
 *
 * Tutor-only. The subject check is the important one — a maths tree attached
 * to a physics enrollment would give the tutor a plan she cannot teach from,
 * and nothing downstream would notice.
 */
import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { readJson } from '$server/http.ts';
import { getStudentByCode, enrollmentsForStudent } from '$server/entities.ts';
import { templateById } from '$server/plans/templates.ts';
import { createPlan, planData, planForEnrollment, lastLessonAt } from '$server/plans/store.ts';
import { buildTree } from '$server/plans/view.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;

  const parsed = await readJson(event.request);
  if (parsed instanceof Response) return parsed;
  const body = parsed as Record<string, unknown>;

  const student = getStudentByCode(String(body.code ?? ''));
  if (!student) return json({ error: 'לא נמצא תלמיד/ה' }, { status: 404 });

  // The subject identifies the enrollment: enrollments is UNIQUE per
  // (student, subject), and the roster the tutor comes from carries subject
  // names rather than enrollment ids.
  const subject = String(body.subject ?? '').trim();
  const enrollment = enrollmentsForStudent(student.id).find(e => e.subject === subject);
  if (!enrollment) return json({ error: 'התלמיד/ה אינו/ה רשום/ה למקצוע הזה' }, { status: 400 });

  const template = templateById(String(body.templateId ?? ''));
  if (!template) return json({ error: 'תבנית לא מוכרת' }, { status: 400 });
  if (template.subject !== enrollment.subject) {
    return json({ error: 'התבנית שייכת למקצוע אחר' }, { status: 400 });
  }

  const goal = String(body.goal ?? '').trim();
  if (!goal || goal.length > 200) return json({ error: 'צריך מטרה (עד 200 תווים)' }, { status: 400 });

  const examDate = body.examDate ? String(body.examDate) : null;
  if (examDate && !/^\d{4}-\d{2}-\d{2}$/.test(examDate)) {
    return json({ error: 'תאריך מבחן לא תקין' }, { status: 400 });
  }
  const focus = body.focus ? String(body.focus).slice(0, 200) : null;

  // Checked directly rather than inferred from createPlan's thrown error:
  // matching /UNIQUE/i against anything createPlan throws would also catch
  // a duplicate *key inside a malformed template* (plan_nodes' UNIQUE
  // (plan_id, key)) and misreport it to the tutor as "a plan already
  // exists" — a template bug, not a real conflict.
  if (planForEnrollment(enrollment.id)) {
    return json({ error: 'כבר קיימת תכנית למקצוע הזה' }, { status: 409 });
  }

  const planId = createPlan({ studentId: student.id, enrollmentId: enrollment.id, template, goal, examDate, focus });

  const { plan, nodes, prereqs, events } = planData(planId);
  // events alongside tree, for the same reason and in the same shape as the
  // events endpoint below — a freshly created plan has none yet, but the
  // page no longer has to special-case that; it just gets an empty array.
  return json({ plan, tree: buildTree(nodes, prereqs, events, lastLessonAt(student.id)), events });
};
