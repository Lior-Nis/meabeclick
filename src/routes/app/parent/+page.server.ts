/**
 * The parent view's guard and its student list.
 *
 * ## What this replaces
 *
 * The page used to open with a chooser listing EVERY enrolled child, fetched
 * from an unauthenticated `/api/portal-students` — so an anonymous visitor
 * who landed on /app/parent read the names of every student in the
 * database, with the code that addressed each one. Picking a name then
 * asked for the shared password.
 *
 * The list now comes from the visitor's own session and contains only their
 * own children. There is nothing to choose from that they were not already
 * entitled to see, which is why the chooser could be deleted rather than
 * merely guarded.
 *
 * Resolved server-side so an unauthorized visitor never receives the markup
 * at all, rather than being redirected by a script after it renders.
 */
import { redirect } from '@sveltejs/kit';
import { resolveFamilyAccess, studentInScope, defaultStudent } from '$server/family.ts';
import { buildOverview } from '$server/overview.ts';
import { todayInIsrael } from '$server/payments.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
  const access = locals.family ? resolveFamilyAccess(locals.family) : null;
  if (!access) redirect(303, '/portal');

  /* A child holding a student session has no business here even for their
     own record: this view carries the balance and the sharing controls. Send
     them to their own board rather than showing a denial — they are not
     doing anything wrong, they are just in the wrong place. */
  if (!access.canSeeParentView) {
    const own = access.student;
    redirect(303, own ? `/app/student?s=${encodeURIComponent(own.code)}` : '/portal');
  }

  const requested = url.searchParams.get('s');
  const inScope = requested ? studentInScope(access, requested) : null;

  /* With siblings and no child named, show the family rather than guessing.
     This used to fall through to `access.students[0]`, silently opening the
     first child — so a parent of two arrived on one board with no sign the
     other existed beyond a bare <select> in the nav. A parent of one, and a
     self-payer, still land straight on their board: an overview of one card
     is a click that buys nothing. */
  const showOverview = !inScope && access.students.length > 1;
  const selected = inScope ?? defaultStudent(access);

  return {
    accountName: access.account.name,
    isSelf: access.isSelf,
    view: showOverview ? ('overview' as const) : ('board' as const),
    /* Rendered by the load rather than fetched after mount: this is the
       landing view for a parent with siblings, and a spinner in front of
       the first thing they see buys nothing. */
    overview: showOverview ? buildOverview(access, todayInIsrael()) : null,
    selected: showOverview ? null : selected?.code ?? null,
    students: access.students.map(s => ({
      code: s.code,
      name: s.name,
      emoji: s.emoji ?? '🎓',
    })),
  };
};
