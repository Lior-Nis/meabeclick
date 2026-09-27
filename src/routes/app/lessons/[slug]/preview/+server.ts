/**
 * The editor's preview: an UNSAVED edit rendered exactly as the student's
 * deck would be, as its own document.
 *
 * Its own document, not JSON for an <iframe srcdoc>: a srcdoc frame
 * inherits the editor page's Content-Security-Policy, whose nonce blocks
 * the deck's inline style and script — the preview came out unstyled with
 * every slide stacked. Served like /lessons/[slug], with documentHeaders(),
 * it is the same deck the student gets. The page POSTs a form targeting a
 * sandboxed iframe, so nothing is saved to preview.
 *
 * Tutor only.
 */
import { error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth.ts';
import { documentHeaders } from '$server/document-policy.ts';
import { editedPlan, lessonMeta } from '$server/lesson/editing.ts';
import { renderSlides } from '$server/lesson/prep.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  requireAuth(event);
  const meta = lessonMeta(event.params.slug);
  if (!meta) error(404, 'לא נמצא');

  const form = await event.request.formData();
  let raw: unknown;
  try { raw = JSON.parse(String(form.get('edit') ?? '')); } catch { error(400, 'עריכה לא תקינה'); }

  const result = editedPlan(event.params.slug, raw);
  if ('error' in result) error(result.status, result.error);
  return new Response(renderSlides(result.plan, meta), { headers: documentHeaders() });
};
