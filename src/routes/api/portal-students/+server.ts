/**
 * The full student roster — for the tutor's dashboard only.
 *
 * ## Why this is now guarded
 *
 * It used to be unauthenticated, and it returned `{ code, name, subject }`
 * for every student in the database. `/app/parent`, reached without a `?s=`
 * parameter, rendered that list under "בחרו את שם התלמיד/ה" — so any
 * anonymous visitor could read the names of every enrolled child, together
 * with the `code` that addressed their page. The header comment claimed
 * "Names only, no codes and no pins" while the body selected `s.code`.
 *
 * Two things changed. The chooser is gone: a parent's own children come
 * from their session (`/api/family`), never from a global list. And the
 * roster itself is a tutor-only view, so it is behind the tutor session
 * like every other dashboard feed.
 */
import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { listStudents } from '$server/entities.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;

  return json({
    students: listStudents().map(s => ({ code: s.code, name: s.name })),
  }, { headers: { 'Cache-Control': 'no-store' } });
};
