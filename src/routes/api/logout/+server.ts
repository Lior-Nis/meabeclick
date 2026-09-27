/**
 * Direct port of server/auth.mjs's `mountAuth` POST /api/logout handler:
 * clear the session cookie by expiring it immediately.
 */
import { json } from '@sveltejs/kit';
import { COOKIE_NAME } from '$server/auth.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ cookies }) => {
  cookies.delete(COOKIE_NAME, { path: '/' });
  return json({ ok: true });
};
