/**
 * Tutor-only aggregate view of every student's game results. Guarded by a
 * real server-side session, not a string in the page — direct port of
 * server/app.mjs's `GET /api/results`.
 */
import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { readResults } from '$server/db.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;

  try {
    return json(
      { students: readResults(), generatedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('results', err);
    return json({ error: 'store error' }, { status: 500 });
  }
};
