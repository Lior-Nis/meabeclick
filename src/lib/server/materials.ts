/**
 * Teaching material as a series of versions.
 *
 * Every write appends. Nothing here updates a row's content, which is what
 * makes "restore" a real operation rather than a hope — the version being
 * restored is still on disk exactly as it was written.
 *
 * Two rules the rest of the app depends on:
 *
 *   A student may only ever be shown a version with `published_at` set.
 *   Generation may never remove or overwrite a version the tutor edited.
 *
 * Both are enforced here rather than in a route, because a route is one
 * caller among several and this table is the thing both rules are about.
 */
import { handle } from './db.ts';

export type MaterialKind = 'plan' | 'slides';
export type MaterialOrigin = 'generated' | 'edited' | 'restored';

export type MaterialRow = {
  id: number;
  lesson_slug: string;
  kind: MaterialKind;
  version: number;
  content: string;
  teacher_only: string | null;
  origin: MaterialOrigin;
  published_at: string | null;
  created_at: string;
};

const now = (): string => new Date().toISOString();

function nextVersion(slug: string, kind: MaterialKind): number {
  const r = handle().prepare(
    `SELECT max(version) AS v FROM lesson_materials WHERE lesson_slug = ? AND kind = ?`
  ).get(slug, kind) as { v: number | null };
  return (r.v ?? 0) + 1;
}

/**
 * Appends a version.
 *
 * `publish` is false by default, and deliberately so: the safe outcome of
 * forgetting the flag is that a student does not see something, never that
 * they see something unreviewed.
 */
export function addMaterial(input: {
  slug: string;
  kind: MaterialKind;
  content: string;
  teacherOnly?: string | null;
  origin: MaterialOrigin;
  publish?: boolean;
}): MaterialRow {
  const db = handle();
  const version = nextVersion(input.slug, input.kind);
  const at = now();
  db.prepare(`
    INSERT INTO lesson_materials
      (lesson_slug, kind, version, content, teacher_only, origin, published_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.slug, input.kind, version, input.content,
    input.teacherOnly ?? null, input.origin,
    input.publish ? at : null, at,
  );
  return byVersion(input.slug, input.kind, version)!;
}

export function byVersion(slug: string, kind: MaterialKind, version: number): MaterialRow | null {
  return (handle().prepare(
    `SELECT * FROM lesson_materials WHERE lesson_slug = ? AND kind = ? AND version = ?`
  ).get(slug, kind, version) as MaterialRow) ?? null;
}

/** What the tutor is working on: the newest version, published or not. */
export function latest(slug: string, kind: MaterialKind): MaterialRow | null {
  return (handle().prepare(
    `SELECT * FROM lesson_materials WHERE lesson_slug = ? AND kind = ?
     ORDER BY version DESC LIMIT 1`
  ).get(slug, kind) as MaterialRow) ?? null;
}

/**
 * What a student may see, and nothing else.
 *
 * `teacher_only` is not selected. A caller cannot leak it by forgetting to
 * strip it, because it never arrives.
 */
export function latestPublished(
  slug: string, kind: MaterialKind,
): Omit<MaterialRow, 'teacher_only'> | null {
  return (handle().prepare(
    `SELECT id, lesson_slug, kind, version, content, origin, published_at, created_at
     FROM lesson_materials
     WHERE lesson_slug = ? AND kind = ? AND published_at IS NOT NULL
     ORDER BY version DESC LIMIT 1`
  ).get(slug, kind) as Omit<MaterialRow, 'teacher_only'>) ?? null;
}

/** Every version, newest first — the history the tutor reads. */
export function history(slug: string, kind: MaterialKind): MaterialRow[] {
  return handle().prepare(
    `SELECT * FROM lesson_materials WHERE lesson_slug = ? AND kind = ?
     ORDER BY version DESC`
  ).all(slug, kind) as MaterialRow[];
}

/**
 * Publishes one version.
 *
 * This is the single place `published_at` is ever set after insert, and it
 * refuses to move one that is already set: a published version is a thing
 * that went out to a student at a particular moment, and rewriting that
 * timestamp would make the history lie about when.
 *
 * Publishing an OLDER version than the newest published one is allowed —
 * that is what rolling back a bad publish looks like, and latestPublished()
 * orders by version, so see restoreVersion() for how a rollback is made to
 * take effect.
 */
export function publishVersion(slug: string, kind: MaterialKind, version: number): MaterialRow | null {
  const row = byVersion(slug, kind, version);
  if (!row) return null;
  if (row.published_at) return row;
  handle().prepare(`UPDATE lesson_materials SET published_at = ? WHERE id = ?`).run(now(), row.id);
  return byVersion(slug, kind, version);
}

/**
 * Brings an old version back as a NEW version.
 *
 * Not "publish the old row": latestPublished() takes the highest version
 * number, so re-publishing version 2 while version 5 is published would
 * change nothing a student sees. Copying it forward is also the honest
 * record — the history then says "on Tuesday she went back to what version
 * 2 said", which is what happened, instead of silently making version 2
 * look like it had been current all along.
 */
export function restoreVersion(
  slug: string, kind: MaterialKind, version: number, opts: { publish?: boolean } = {},
): MaterialRow | null {
  const source = byVersion(slug, kind, version);
  if (!source) return null;
  return addMaterial({
    slug, kind,
    content: source.content,
    teacherOnly: source.teacher_only,
    origin: 'restored',
    publish: opts.publish ?? false,
  });
}

/**
 * Whether regeneration would land on top of work the tutor did.
 *
 * Generation never overwrites — it appends like everything else — so this
 * is not a safety check. It is what lets the caller SAY so: "there is an
 * edit of yours newer than the last generated version" is worth telling her
 * before she regenerates, and worth telling her afterwards so she can find
 * her way back to it.
 */
export function hasUnpublishedEdits(slug: string, kind: MaterialKind): boolean {
  const row = latest(slug, kind);
  return !!row && row.origin !== 'generated' && row.published_at === null;
}

/**
 * Records what generation produced, without ever displacing a tutor's work.
 *
 * This function is why the module's two opening rules are now true rather
 * than merely stated. Until it existed, `lesson_materials` had exactly one
 * consumer — the tutor's own API route — while generation wrote
 * `lessons/<slug>/slides.html` straight to disk and the student read that
 * same file. So a regeneration silently overwrote her correction, and the
 * published/draft distinction decided nothing about what a child saw.
 *
 * The new version is always kept: throwing away a regeneration would lose
 * work too, and she may well want to compare. What it does not do is become
 * publishable when she has edited. `publish` is therefore conditional on
 * there being no edit in the history at all — not merely no unpublished
 * draft, since an edit she already published is the strongest statement
 * that she wants it.
 */
export function recordGenerated(
  slug: string,
  content: { slides?: string; plan?: string },
): void {
  for (const [kind, text] of [['slides', content.slides], ['plan', content.plan]] as const) {
    if (typeof text !== 'string') continue;
    const edited = history(slug, kind as MaterialKind).some(v => v.origin !== 'generated');
    addMaterial({
      slug, kind: kind as MaterialKind, content: text, origin: 'generated',
      publish: !edited,
    });
  }
}

/**
 * What a student may be shown, or null when this lesson predates the
 * versioned store.
 *
 * Null is not an error and must not 404 a real lesson: every lesson
 * generated before migration 012 has slides on disk and no rows here. The
 * caller falls back to the file, which is exactly what it served before.
 */
export function publishableSlides(slug: string): string | null {
  return latestPublished(slug, 'slides')?.content ?? null;
}
