/**
 * The setup page's one button: a plain link, not a form, because the
 * CSP's form-action 'self' would block a form's redirect to Google.
 */
import { redirect } from '@sveltejs/kit';
import { startSetup } from '$server/tutor-setup-flow.ts';
import { SETUP_COOKIE, setupCookieOptions } from '$server/tutor-setup.ts';
import { webClientFromEnv } from '$server/google-meet-setup.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url, cookies }) => {
  const step = startSetup(url.searchParams.get('code'), webClientFromEnv());
  if (step.cookie) cookies.set(SETUP_COOKIE, step.cookie, setupCookieOptions(url));
  redirect(303, step.location);
};
