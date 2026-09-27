/**
 * Direct port of server/app.mjs's `GET /api/calendar-failures`.
 */
import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { listUnresolvedCalendarFailures } from '$server/db.ts';
import { calendarSourceIssues } from '$server/calendar.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;
  // `failures` is calendar *write* failures (a booking saved here that
  // couldn't be pushed to the calendar) — unchanged, existing banner.
  // `sourceIssues` is calendar *read* failures (a feed the availability
  // check couldn't read, so its hours may be offered as free) — new.
  return json({ failures: listUnresolvedCalendarFailures(), sourceIssues: calendarSourceIssues() });
};
