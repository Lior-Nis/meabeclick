/**
 * The tutor's editor, server side.
 *
 * Tutor-only, every method. Material is what goes out under her name, and
 * a draft is by definition something she has not approved yet — so there is
 * no read here a family session may perform, not even of a published
 * version. The student's published copy reaches them through
 * /api/portal/[code] and the lessons route, which select only what is
 * publishable.
 *
 * One endpoint for four verbs, matching /api/plans/[id]/events: every
 * operation on material is "append a version" or "mark one published", and
 * splitting them across routes would only spread the same guard.
 */
import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { readJson } from '$server/http.ts';
/* db.ts, not lessons.ts: generation writes to the legacy `lessons` table
   and lessons_v2 has never been written to (production 2026-09-21 — 4 rows
   against 0). Reading the empty one here would 404 every real lesson. */
import { readLessons } from '$server/db.ts';
import { editedPlan, masterProblems, publishPlan } from '$server/lesson/editing.ts';
import {
  addMaterial, history, latest, latestPublished, publishVersion, restoreVersion,
  hasUnpublishedEdits, type MaterialKind,
} from '$server/materials.ts';
import type { RequestHandler } from './$types';

const KINDS: MaterialKind[] = ['plan', 'slides'];
const NOT_FOUND = { error: 'לא נמצא' };
/** Big enough for a deck, small enough that one request cannot fill the disk. */
const MAX_CONTENT = 512 * 1024;

/** Whether a lesson with this slug exists at all. */
function lessonExists(slug: string): boolean {
  return readLessons().some(l => l.slug === slug);
}

function kindOf(value: unknown): MaterialKind | null {
  const k = String(value ?? 'plan');
  // .includes, not `in`: `in` walks the prototype chain, so 'constructor'
  // would pass and then trip the CHECK constraint as a 500.
  return (KINDS as string[]).includes(k) ? (k as MaterialKind) : null;
}

export const GET: RequestHandler = (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;

  if (!lessonExists(event.params.slug)) return json(NOT_FOUND, { status: 404 });
  const slug = event.params.slug;

  const kind = kindOf(event.url.searchParams.get('kind'));
  if (!kind) return json({ error: 'סוג חומר לא מוכר' }, { status: 400 });

  return json({
    latest: latest(slug, kind),
    published: latestPublished(slug, kind),
    /* Every version, so the editor can show a history and offer a restore
       without a second round trip. Content is included: these are a few
       kilobytes each and the alternative is a request per row. */
    history: history(slug, kind),
    unpublishedEdits: hasUnpublishedEdits(slug, kind),
  }, { headers: { 'Cache-Control': 'no-store' } });
};

export const POST: RequestHandler = async (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;

  if (!lessonExists(event.params.slug)) return json(NOT_FOUND, { status: 404 });
  const slug = event.params.slug;

  const parsed = await readJson(event.request);
  if (parsed instanceof Response) return parsed;
  const body = parsed as Record<string, unknown>;

  const kind = kindOf(body.kind);
  if (!kind) return json({ error: 'סוג חומר לא מוכר' }, { status: 400 });

  const type = String(body.type ?? 'save');

  if (type === 'save') {
    const content = typeof body.content === 'string' ? body.content : null;
    if (content === null) return json({ error: 'חסר תוכן' }, { status: 400 });
    if (content.length > MAX_CONTENT) return json({ error: 'החומר ארוך מדי' }, { status: 413 });

    const teacherOnly = typeof body.teacherOnly === 'string' ? body.teacherOnly : null;
    if (teacherOnly && teacherOnly.length > MAX_CONTENT) {
      return json({ error: 'ההערות ארוכות מדי' }, { status: 413 });
    }

    /* publish is opt-in, and saving is the default. A tutor who means to
       save and accidentally publishes has shown a child something she had
       not finished; the reverse costs a second click. */
    const row = addMaterial({
      slug, kind, content, teacherOnly,
      origin: 'edited', publish: body.publish === true,
    });
    return json({ saved: row });
  }

  /* The editor's two writing verbs (spec D2). An edit is always a PLAN; a
     deck is only ever rendered from one, here, so the two cannot disagree.
     Preview is not here: it has to be a document with the deck's own CSP —
     see src/routes/app/lessons/[slug]/preview/+server.ts. */
  if (type === 'save-plan' || type === 'publish-plan') {
    const result = editedPlan(slug, body.edit);
    if ('error' in result) return json({ error: result.error }, { status: result.status });
    const { plan, teacherOnly } = result;
    if (type === 'save-plan') {
      return json({ saved: addMaterial({ slug, kind: 'plan', content: JSON.stringify(plan), teacherOnly, origin: 'edited' }) });
    }
    /* A draft may be unfinished; a published master is what the next
       booking copies, and a copy that fails this check is held. */
    const problems = masterProblems(slug, plan);
    if (problems.length) {
      return json({ error: `לא פורסם — שיעור שיוזמן מהגרסה הזו ייעצר: ${problems.join(' · ')}`, problems }, { status: 422 });
    }
    return json({ published: publishPlan(slug, plan, teacherOnly) });
  }

  if (type === 'publish') {
    const version = Number(body.version);
    if (!Number.isInteger(version)) return json({ error: 'מספר גרסה לא תקין' }, { status: 400 });
    const row = publishVersion(slug, kind, version);
    return row ? json({ published: row }) : json(NOT_FOUND, { status: 404 });
  }

  if (type === 'restore') {
    const version = Number(body.version);
    if (!Number.isInteger(version)) return json({ error: 'מספר גרסה לא תקין' }, { status: 400 });
    /* Copied forward as a new version rather than re-publishing the old row
       — latestPublished() takes the highest version, so re-publishing an
       old one would change nothing a student sees. */
    const row = restoreVersion(slug, kind, version, { publish: body.publish === true });
    return row ? json({ restored: row }) : json(NOT_FOUND, { status: 404 });
  }

  return json({ error: 'פעולה לא מוכרת' }, { status: 400 });
};
