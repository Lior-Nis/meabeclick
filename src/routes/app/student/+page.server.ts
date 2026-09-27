/**
 * The student board's guard.
 *
 * Reached three ways, all of which arrive here already holding a session:
 * a child tapping the link their parent forwarded, a child who redeemed a
 * join code, or a parent opening their own child's board from the parent
 * view. There is no gate to render, because there is no secret to ask for.
 *
 * What this replaces: the page read a code from `?s=` or localStorage and a
 * pin from `student_pin_<code>`, then asked for the pin when either was
 * missing — enforcing `צריך 4 ספרות`, a rule left over from the original
 * 4-digit PIN model that the password migration never removed. A family
 * whose password was not four digits was told to enter digits they had
 * never been asked for.
 */
import { redirect } from '@sveltejs/kit';
import { resolveFamilyAccess, studentInScope, defaultStudent } from '$server/family.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
  const access = locals.family ? resolveFamilyAccess(locals.family) : null;
  if (!access) redirect(303, '/portal');

  const requested = url.searchParams.get('s');
  const student = (requested ? studentInScope(access, requested) : null) ?? defaultStudent(access);

  /* Asking for a student this session cannot reach — a sibling, or another
     family's child — is answered the same way as asking for nothing:
     whatever they are entitled to. A denial page would confirm that the
     code they tried names a real student. */
  if (!student) redirect(303, access.canSeeParentView ? '/app/parent' : '/portal');
  if (student.code !== requested) redirect(303, `/app/student?s=${encodeURIComponent(student.code)}`);

  return {
    code: student.code,
    /** Whether to offer a way back to the parent view — a child's session
     *  has nowhere to go back to. */
    canSeeParentView: access.canSeeParentView,
    isSelf: access.isSelf,
  };
};
