/**
 * A generated lesson's slide deck. Public and link-based — the tutor sends
 * the URL directly to a student/parent, the same way it worked when
 * `lessons/` was served statically. `readContent` still requires an exact
 * `lessons/<slug>/slides.html` match before touching the filesystem.
 */
import { error } from '@sveltejs/kit';
import { readContent } from '$server/content.ts';
import { documentHeaders } from '$server/document-policy.ts';
import { publishableSlides } from '$server/materials.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  /* The published version wins over the file on disk.
  
     materials.ts says "a student may only ever be shown a version with
     published_at set", and that was not true of anything: this route read
     the file generation wrote, so a tutor's correction was invisible here
     and a regeneration overwrote it. Serving the published version is what
     makes her edit the thing a child actually opens.
  
     Falling back to the file is not a safety net, it is the answer for
     every lesson generated before migration 012 — those have slides on disk
     and no rows in the store, and 404ing them would be a regression. */
  const published = publishableSlides(params.slug);
  if (published !== null) {
    return new Response(published, { headers: documentHeaders() });
  }

  try {
    const body = await readContent('lessons', params.slug);
    // A stand-alone document with its own inline script: it gets the
    // document policy, not SvelteKit's page CSP (see document-policy.ts).
    return new Response(new Uint8Array(body), { headers: documentHeaders() });
  } catch {
    error(404, 'לא נמצא');
  }
};
