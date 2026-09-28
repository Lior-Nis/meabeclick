/** Server-backed activity for one tutor-dashboard student card. */
import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { getStudentByCode, nextBookingForStudent } from '$server/entities.ts';
import { chargesForStudent, addPayment } from '$server/payments.ts';
import {
  addHomework, deleteHomework, homeworkForStudent, setHomeworkSubmitted, gradeHomework,
  lessonsForStudent, HOMEWORK_GRADES, type HomeworkGrade,
} from '$server/lessons.ts';
import type { TutorHomework } from '$lib/tutor-homework.ts';
import { israelDay, lessonWhen } from '$lib/dates.ts';
import type { RequestHandler } from './$types';

function studentOr404(code: string) {
  return getStudentByCode(code);
}

function view(code: string) {
  const student = studentOr404(code);
  if (!student) return null;
  const booking = nextBookingForStudent(student.id);
  return {
    nextLesson: booking ? {
      /* The Israel date and time. Bookings are stored in UTC, and slicing
         the string printed the UTC hour — 08:00 for an 11:00 lesson. */
      ...lessonWhen(booking.start),
      type: booking.duration === 90 ? 'כפול' : booking.duration === 135 ? 'משולש' : 'יחיד',
    } : { date: '', time: '', type: 'יחיד' },
    sessions: chargesForStudent(student.id).filter(p => p.status !== 'void').map(p => ({
      id: String(p.id), date: p.date, type: p.kind === 'double' ? 'כפול · 90 דק׳' : p.kind === 'triple' ? 'משולש · 135 דק׳' : 'יחיד · 45 דק׳',
      amount: p.amount_agorot / 100, paid: p.status === 'paid', notes: p.note ?? '', void: p.status === 'void',
    })),
    /* includeHeld on every read in this route: the tutor sees booking-time
       homework before it goes out, and PATCH/DELETE check ownership through
       this same read — without it she could not delete a held task. */
    homework: homeworkForStudent(student.id, { includeHeld: true }).map((h): TutorHomework => ({
      id: String(h.id), task: h.task, date: h.due_at ?? israelDay(h.assigned_at),
      submitted: h.submitted, graded: h.graded, grade: h.grade ?? null,
      submittedBy: h.submitted_by ?? null, gradedBy: h.graded_by ?? null,
      /* Set while the family cannot see it yet: goes out when the lesson
         report replaces or releases it, or at this time by itself. */
      heldUntil: h.held_until && h.held_until > new Date().toISOString() ? h.held_until : null,
      answer: h.answer ?? null,
    })),
    /* lessonsForStudent, not the old readLessons: that one read lessons_v2,
       which nothing writes, so this list was empty for every student while
       finished lessons sat in the legacy table. */
    lessons: lessonsForStudent(student.id).map(l => ({ id: l.id, slug: l.slug, title: l.title, topic: l.topic, status: l.status, lessonAt: l.lesson_at })),
  };
}

export const GET: RequestHandler = (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;
  const data = view(event.params.code);
  return data ? json(data, { headers: { 'Cache-Control': 'no-store' } }) : json({ error: 'student not found' }, { status: 404 });
};

export const POST: RequestHandler = async (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;
  const student = studentOr404(event.params.code);
  if (!student) return json({ error: 'student not found' }, { status: 404 });
  const body = await event.request.json().catch(() => ({})) as Record<string, unknown>;
  if (body.kind !== 'homework') return json({ error: 'unsupported activity' }, { status: 400 });
  const task = String(body.task ?? '').trim();
  if (!task) return json({ error: 'task is required' }, { status: 400 });
  addHomework({ studentId: student.id, task, dueAt: String(body.date ?? '').trim() || null });
  return json(view(event.params.code));
};

export const PATCH: RequestHandler = async (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;
  const student = studentOr404(event.params.code);
  if (!student) return json({ error: 'student not found' }, { status: 404 });
  const body = await event.request.json().catch(() => ({})) as Record<string, unknown>;
  const id = Number(body.id);
  if (!Number.isInteger(id) || body.kind !== 'homework') return json({ error: 'invalid activity' }, { status: 400 });
  const owned = homeworkForStudent(student.id, { includeHeld: true }).some(h => h.id === id);
  if (!owned) return json({ error: 'activity not found' }, { status: 404 });
  /* The tutor can do either stage. She submits on the child's behalf when
     they told her in the room, and she grades once she has looked. Both are
     recorded as hers — who made a claim is part of the claim. */
  if ('grade' in body) {
    const raw = body.grade;
    if (raw !== null && !HOMEWORK_GRADES.includes(String(raw) as HomeworkGrade)) {
      return json({ error: 'ציון לא מוכר' }, { status: 400 });
    }
    gradeHomework(id, raw === null ? null : (String(raw) as HomeworkGrade), 'teacher');
  } else if ('submitted' in body) {
    setHomeworkSubmitted(id, body.submitted === true, 'teacher');
  } else {
    return json({ error: 'לא ברור מה לעדכן — צריך submitted או grade' }, { status: 400 });
  }
  return json(view(event.params.code));
};

export const DELETE: RequestHandler = async (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;
  const student = studentOr404(event.params.code);
  if (!student) return json({ error: 'student not found' }, { status: 404 });
  const id = Number(event.url.searchParams.get('id'));
  if (!Number.isInteger(id) || !homeworkForStudent(student.id, { includeHeld: true }).some(h => h.id === id)) return json({ error: 'activity not found' }, { status: 404 });
  deleteHomework(id);
  return json(view(event.params.code));
};
