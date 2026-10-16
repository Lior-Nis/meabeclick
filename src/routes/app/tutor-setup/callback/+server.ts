/**
 * Where Google sends the tutor back. It does the work and redirects rather
 * than rendering, so a phone that reloads the tab lands on the done page
 * instead of replaying Google's one-time code. See tutor-setup-flow.ts.
 */
import { redirect } from '@sveltejs/kit';
import { finishSetup } from '$server/tutor-setup-flow.ts';
import { SETUP_COOKIE, setupCookieOptions } from '$server/tutor-setup.ts';
import { webClientFromEnv } from '$server/google-meet-setup.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
  const q = url.searchParams;
  const step = await finishSetup({
    cookie: cookies.get(SETUP_COOKIE), state: q.get('state'), authCode: q.get('code'), error: q.get('error'),
  }, webClientFromEnv());
  const options = setupCookieOptions(url);
  if (step.cookie) cookies.set(SETUP_COOKIE, step.cookie, options);
  else cookies.delete(SETUP_COOKIE, { path: options.path });
  redirect(303, step.location);
};
