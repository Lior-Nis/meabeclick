/**
 * The student's own "I finished it".
 *
 * This did not exist. The student page rendered a done flag and offered no
 * way to change it, and the PATCH that could change it was tutor-only — so a
 * child who did the exercises had no way to say so, and the homework list
 * only ever grew.
 *
 * Lives under the portal route on purpose. The authorization question here
 * is exactly the one /api/portal/[code] already answers — may this session
 * act for this student? — and answering it twice in two places is how the
 * two answers drift apart.
 *
 * Submission only. A child may say they finished their own work; they may
 * not grade it. Grading is the tutor's, through
 * /api/students/[code]/activity, and keeping the two on separate routes with
 * separate guards is what stops a family session ever reaching a judgement.
 */
import { json } from '@sveltejs/kit';
import { readJson } from '$server/http.ts';
import { resolveFamilyAccess, studentInScope } from '$server/family.ts';
import { getStudentByCode } from '$server/entities.ts';
import { homeworkForStudent, setHomeworkSubmitted } from '$server/lessons.ts';
import { progressFor } from '$server/progress.ts';
import { noticeHomeworkSubmitted } from '$server/notices.ts';
import { sendWhatsApp } from '$server/lesson/queue.ts';
import type { RequestHandler } from './$types';

const CODE_FORMAT = /^[a-z0-9-]+$/;

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  const { code } = params;
  const deny = () =>
    json({ error: 'אין גישה לדף הזה' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });

  if (!CODE_FORMAT.test(code)) return deny();

  /* Same shape as the portal read: the tutor's session is checked first and
     separately, because it is a different cookie with a different audience
     and folding the two into one predicate is how a family session ends up
     satisfying a tutor-only guard. */
  let by: 'student' | 'teacher' = 'teacher';
  if (!locals.authenticated) {
    if (!locals.family) return deny();
    const access = resolveFamilyAccess(locals.family);
    if (!access) return deny();
    if (!studentInScope(access, code)) return deny();
    by = 'student';
  }

  const student = getStudentByCode(code);
  if (!student) return deny();

  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  const body = parsed as Record<string, unknown>;

  const id = Number(body.id);
  if (!Number.isInteger(id)) return json({ error: 'מזהה לא תקין' }, { status: 400 });

  /* The id is an integer in the body, so which student owns this row has to
     be checked rather than inferred from the path — otherwise one child's
     path submits another child's homework. */
  const rows = homeworkForStudent(student.id);
  const row = rows.find(h => h.id === id);
  if (!row) {
    return json({ error: 'לא נמצא' }, { status: 404 });
  }

  /* Reversible: a child who taps it by accident must be able to take it
     back. A submission is a claim, not a judgement, so undoing one loses
     nothing. */
  const nowSubmitted = body.submitted !== false;
  setHomeworkSubmitted(id, nowSubmitted, by);

  /* The tutor hears it — once, on the change, and not awaited: a WhatsApp
     that is slow or down must not hold the child's tap. */
  noticeHomeworkSubmitted(
    { studentName: student.name, task: row.task, wasSubmitted: row.submitted, nowSubmitted, by },
    sendWhatsApp,
  ).catch(err => console.error('[homework] tutor notice failed:', (err as Error).message));

  /* Progress comes back too, because it is derived from exactly what just
     changed. Without it the page shows two numbers about the same child
     that disagree — the open-homework count drops while the progress tile
     stays where it was — until something forces a reload. */
  return json(
    {
      homework: homeworkForStudent(student.id).map(h => ({ id: h.id, submitted: h.submitted, graded: h.graded })),
      progress: progressFor(code),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
};
