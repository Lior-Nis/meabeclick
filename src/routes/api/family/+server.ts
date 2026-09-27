/**
 * Who the current family session is, and what it may open.
 *
 * Every family-facing page asks this on load instead of reading a code out
 * of the URL and a secret out of localStorage. That inversion is the point:
 * the server decides what this visitor may see, and the page renders the
 * answer. Previously the page decided, by trusting a `?s=` parameter anyone
 * could edit.
 *
 * GET is unauthenticated and always 200 — `{ signedIn: false }` is a real
 * answer, and a 401 here would make every page handle an error for the
 * ordinary case of a first visit.
 *
 * DELETE signs the family out on this device. It exists mainly for a shared
 * or borrowed device, and for a parent who used a child's browser to set
 * that child up.
 */
import { json } from '@sveltejs/kit';
import { resolveFamilyAccess, defaultStudent } from '$server/family.ts';
import { clearFamilySession } from '$server/family-auth.ts';
import type { RequestHandler } from './$types';

const noStore = { headers: { 'Cache-Control': 'no-store' } };

export const GET: RequestHandler = ({ locals }) => {
  if (!locals.family) return json({ signedIn: false }, noStore);

  const access = resolveFamilyAccess(locals.family);
  // The token verified but names a row that is gone. Reported as signed
  // out, because that is what it means to the visitor.
  if (!access) return json({ signedIn: false }, noStore);

  const fallback = defaultStudent(access);

  return json({
    signedIn: true,
    kind: access.identity.kind,
    isSelf: access.isSelf,
    canSeeParentView: access.canSeeParentView,
    accountName: access.account.name,
    defaultStudent: fallback?.code ?? null,
    students: access.students.map(s => ({
      code: s.code,
      name: s.name,
      emoji: s.emoji ?? '🎓',
    })),
  }, noStore);
};

export const DELETE: RequestHandler = ({ cookies }) => {
  clearFamilySession(cookies);
  return json({ ok: true });
};
