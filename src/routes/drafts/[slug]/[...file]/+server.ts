/**
 * Unreviewed, freshly generated lessons — visible to the tutor once logged
 * in, never to the public, since material goes out under her name and she
 * approves it first (see server/app.mjs's old `app.use('/drafts',
 * requireAuth, …)`). `readContent` only recognizes the exact two files a
 * draft directory ever holds (slides.html, lesson.json); anything else,
 * including any attempt to reach past the draft directory, 404s.
 */
import { error } from '@sveltejs/kit';
import { readContent } from '$server/content.ts';
import { requireAuth } from '$server/auth.ts';
import { documentHeaders } from '$server/document-policy.ts';
import type { RequestHandler } from './$types';

const CONTENT_TYPE: Record<string, string> = {
  'slides.html': 'text/html; charset=utf-8',
  'lesson.json': 'application/json',
};

export const GET: RequestHandler = async (event) => {
  requireAuth(event);
  const { params } = event;
  try {
    const body = await readContent('drafts', params.slug, params.file);
    // slides.html is a stand-alone document with its own inline script, so
    // it carries the document policy rather than SvelteKit's page CSP; the
    // same header on lesson.json is harmless and keeps one code path.
    return new Response(new Uint8Array(body), {
      headers: {
        ...documentHeaders(CONTENT_TYPE[params.file] ?? 'application/octet-stream'),
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    error(404, 'לא נמצא');
  }
};
