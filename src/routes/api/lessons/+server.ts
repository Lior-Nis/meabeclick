/**
 * The tutor's feed of auto-generated lessons — behind her session.
 *
 * It used to be unauthenticated, carried over from server/app.mjs on the
 * reasoning that "the name is not a secret — it is already on the page
 * whoever is reading it". That reasoning does not survive the route it was
 * written for: with no `?student=`, this returns the LAST 200 LESSONS FOR
 * EVERY FAMILY — names, subjects, levels, topics and lesson times — to any
 * anonymous caller, which is not a page anyone was already reading. It also
 * returns `problem`, the failure text this pipeline writes on every failed
 * generation. Confirmed against production before changing it: an
 * unauthenticated GET returned a real student's record.
 *
 * The only consumer is the tutor dashboard, which already sends its session
 * (`credentials: 'same-origin'`). The `?student=` filter is kept, now as a
 * tutor-side filter rather than the family's way in; a family reads its own
 * records through /api/portal/[code], which scopes by session rather than by
 * a guessable name.
 *
 * Ruling P13 (task 18): the `lessons` table's `games` column has the exact
 * same permanently-mixed-shape problem as portal/<code>.json — old rows
 * baked {title,url}, rows written by src/lib/server/lesson/queue.ts store
 * {title,template,dataId} facts only. /api/portal/[code] already normalizes
 * this for parent/student; this route did not, which is exactly the bug
 * named in the ruling (the old pages/app/dashboard.html:725 rendered
 * `href="/${g.url}"` unguarded against a new-shape entry, producing
 * `href="/undefined"`). Normalized here the same way, except a malformed
 * entry is kept and flagged `broken: true` rather than dropped — this feed
 * is the tutor's own admin view, so a bad link should be visible and
 * actionable, not silently missing the way a family's read of their own
 * portal is allowed to quietly omit it.
 *
 * `slides` is likewise a baked path (`lessons/<slug>/slides.html`) that no
 * longer matches the actual route (`/lessons/[slug]`, see
 * src/routes/lessons/[slug]/+server.ts). `slidesUrl` derives the real link
 * from lessonUrl(slug) instead of trusting the stored string.
 */
import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { readLessons } from '$server/db.ts';
import { isLibrarySlug } from '$server/library/slug.ts';
import { resolveStudent, studentRefById } from '$server/results.ts';
import { gameUrl, lessonUrl } from '$server/urls.ts';
import type { RequestHandler } from './$types';

function normalizeLessonGame(entry: unknown, student: string): { title: string; url: string | null; broken: boolean } {
  const e = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
  const title = typeof e.title === 'string' && e.title ? e.title : '(ללא שם)';

  if (typeof e.url === 'string') return { title, url: e.url, broken: false }; // old shape: already has a url
  if (typeof e.template === 'string' && typeof e.dataId === 'string') {
    try {
      return { title, url: gameUrl({ template: e.template, dataId: e.dataId, student }), broken: false };
    } catch {
      return { title, url: null, broken: true }; // invalid template — visible, not vanished
    }
  }
  return { title, url: null, broken: true }; // neither shape
}

export const GET: RequestHandler = async (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;

  const { url } = event;
  try {
    const raw = url.searchParams.get('student');
    /* Library masters are nobody's lesson: they live on /app/library. */
    const lessons = readLessons(raw ? raw : undefined).filter(l => !isLibrarySlug(l.slug)).map(l => {
      /* Prefer the stable code: the legacy lessons table stores a display
         name, which is ambiguous between two children sharing one and
         changes when a child is renamed. An unresolvable name passes through
         unchanged, producing exactly the link it produces today. */
      const id = resolveStudent(l.student);
      const ref = id === null ? l.student : (studentRefById(id)?.code ?? l.student);
      return {
        ...l,
        games: l.games.map(g => normalizeLessonGame(g, ref)),
        slidesUrl: l.slides ? lessonUrl(l.slug) : null,
      };
    });
    return json({ lessons }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('lessons', err);
    return json({ error: 'store error' }, { status: 500 });
  }
};
