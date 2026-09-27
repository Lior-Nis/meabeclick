/**
 * The portal door.
 *
 * A visitor who already has a family session never sees this page — they
 * are redirected to their board before anything renders. That is the whole
 * behavioural change: the old page always rendered a password gate, even
 * for a family that had just been let in, because the only thing it knew
 * how to do was ask for a secret.
 *
 * Resolved on the server rather than in `onMount` so there is no flash of a
 * sign-in form for a family that is already signed in, and no dependence on
 * a `?s=` parameter or a localStorage key that WhatsApp's in-app browser
 * wipes between sessions.
 */
import { redirect } from '@sveltejs/kit';
import { resolveFamilyAccess, defaultStudent } from '$server/family.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
  const access = locals.family ? resolveFamilyAccess(locals.family) : null;

  if (access) {
    // A parent with more than one child picks a board; everyone else has
    // exactly one place to be and is taken there.
    if (access.canSeeParentView && !access.isSelf) redirect(303, '/app/parent');

    const student = defaultStudent(access);
    if (student) redirect(303, `/app/student?s=${encodeURIComponent(student.code)}`);

    // An account with no students at all: nothing to open, but the parent
    // view can still explain that and link to booking.
    redirect(303, '/app/parent');
  }

  return {
    /** Set by /enter when a link was expired, tampered with, or named a
     *  record that no longer exists. All three land here identically. */
    expired: url.searchParams.get('expired') === '1',
  };
};
