/**
 * The magic link's landing point: verify the token, establish the family
 * session, and send the visitor to the board they asked for.
 *
 * A GET endpoint rather than a page, because nothing here is ever rendered —
 * every path is a redirect, and a page would flash empty markup first.
 *
 * ## Why the token is not single-use
 *
 * Mail clients, link scanners, and WhatsApp's own preview fetcher all GET a
 * link before a human ever taps it. A single-use token would be spent by
 * whichever of them got there first, and the family would meet an "already
 * used" screen on their very first tap. The tokens here are stateless and
 * time-bounded instead: a prefetch sets a cookie in a scanner nobody is
 * looking at, and costs the family nothing.
 *
 * The exchange still matters. The link expires in two weeks; the session it
 * establishes lasts six months. So a forwarded or archived link stops
 * working long before the device that legitimately used it does.
 */
import { redirect } from '@sveltejs/kit';
import { verifyFamilyToken, setFamilySession } from '$server/family-auth.ts';
import { resolveFamilyAccess } from '$server/family.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url, cookies }) => {
  const identity = verifyFamilyToken(url.searchParams.get('t'));

  // One destination for every failure — expired, tampered, or naming a
  // student the tutor has since deleted. /portal reads `?expired` and offers
  // to mail a fresh link, which is the only useful thing any of these can do
  // next, and saying which one it was would tell a guesser whether they had
  // found a real id.
  if (!identity) redirect(303, '/portal?expired=1');

  const access = resolveFamilyAccess(identity);
  if (!access) redirect(303, '/portal?expired=1');

  setFamilySession(cookies, identity);

  // A student token, and a self-paying adult, both have exactly one board to
  // land on. Only a parent account with children gets the parent view, and
  // /app/parent is also where the sharing controls live.
  if (access.canSeeParentView && !access.isSelf) redirect(303, '/app/parent');

  const student = access.student ?? access.students[0];
  redirect(303, student ? `/app/student?s=${encodeURIComponent(student.code)}` : '/app/parent');
};
