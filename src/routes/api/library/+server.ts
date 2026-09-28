/**
 * The prepared library for one plan template (tutor only):
 * GET /api/library?template=math-8. See library/view.ts.
 */
import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { libraryView } from '$server/library/view.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;
  const view = libraryView(event.url.searchParams.get('template') ?? '');
  if (!view) return json({ error: 'אין תבנית כזו' }, { status: 404 });
  return json(view, { headers: { 'Cache-Control': 'no-store' } });
};
