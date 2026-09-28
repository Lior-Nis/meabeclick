/**
 * The prepared library — see docs/superpowers/specs/2026-09-28-prepared-library-design.md.
 * Tutor only; the template comes from ?template=, maths grade 8 by default
 * (the trial's).
 */
import { error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth.ts';
import { libraryView } from '$server/library/view.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
  requireAuth(event);
  const view = libraryView(event.url.searchParams.get('template') ?? 'math-8');
  if (!view) error(404, 'אין תבנית כזו');
  return view;
};
