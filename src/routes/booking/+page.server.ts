/**
 * What booking already knows about the visitor.
 *
 * `hooks.server.ts` resolves a family session into `locals.family` on every
 * request, including this one — and until now the booking page never looked
 * at it. So a parent who books monthly re-typed their child's name, subject,
 * level, email and phone every month while the server already knew all five.
 *
 * A visitor with no session gets `known: false` and the ordinary blank form;
 * nothing about the page changes for a first-time family.
 *
 * Only an ACCOUNT session prefills. A student session belongs to a child on
 * their own device, and booking (and paying for) lessons is the account
 * holder's action — a self-paying adult holds an account session, so they
 * are covered.
 */
import { resolveFamilyAccess } from '$server/family.ts';
import { readPortalSummary } from '$server/portal-file.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
  const access = locals.family ? resolveFamilyAccess(locals.family) : null;

  if (!access || !access.canSeeParentView) {
    return { known: false as const, isSelf: false, email: null, phone: null, students: [] };
  }

  return {
    known: true as const,
    isSelf: access.isSelf,
    email: access.account.email,
    phone: access.account.phone,
    students: access.students.map(s => {
      // Subject and level come from the student's own page, so picking a
      // child carries what they actually learn rather than making a parent
      // re-choose it from a dropdown every time.
      const summary = readPortalSummary(s.code);
      return {
        code: s.code,
        name: s.name,
        emoji: s.emoji ?? '🎓',
        subject: summary?.subject ?? '',
        level: summary?.level ?? '',
      };
    }),
  };
};
