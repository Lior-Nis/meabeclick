/**
 * The parent's sharing controls for one of their children: a link to
 * forward, and a code to read aloud.
 *
 * Both are minted here rather than on the page, because both are access
 * tokens — a page that could construct them would have to be trusted with
 * the signing secret.
 *
 * Only an account session reaches this. A student session must never be
 * able to mint another student's link, or re-share its own to a wider
 * audience, so `canSeeParentView` gates the whole endpoint.
 */
import { json } from '@sveltejs/kit';
import { resolveFamilyAccess, studentInScope } from '$server/family.ts';
import { studentLink } from '$server/family-auth.ts';
import { joinCodeForStudent, formatJoinCode } from '$server/join.ts';
import { readJson } from '$server/http.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.family) return json({ error: 'אין גישה' }, { status: 401 });

  const access = resolveFamilyAccess(locals.family);
  if (!access || !access.canSeeParentView) return json({ error: 'אין גישה' }, { status: 401 });

  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;

  const code = String((parsed as Record<string, unknown>)?.code ?? '');
  const student = studentInScope(access, code);
  if (!student) return json({ error: 'אין גישה' }, { status: 401 });

  const join = joinCodeForStudent(student.id);

  return json({
    name: student.name,
    link: studentLink(student.id),
    joinCode: formatJoinCode(join),
  }, { headers: { 'Cache-Control': 'no-store' } });
};
