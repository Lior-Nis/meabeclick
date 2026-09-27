/**
 * Direct port of server/app.mjs's `POST /api/calendar-failures/:id/resolve`.
 */
import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { resolveCalendarFailure } from '$server/db.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;
  return json({ resolved: resolveCalendarFailure(Number(event.params.id)) });
};
