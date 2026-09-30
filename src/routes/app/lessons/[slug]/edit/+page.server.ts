/**
 * The tutor's lesson editor — spec
 * docs/superpowers/specs/2026-09-25-lesson-editor-design.md. Tutor only.
 */
import { error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth.ts';
import { readLessons } from '$server/db.ts';
import { history, hasUnpublishedEdits } from '$server/materials.ts';
import { editBase, formPlan } from '$server/lesson/editing.ts';
import { isLibrarySlug } from '$server/library/slug.ts';
import type { PageServerLoad } from './$types';

/** Versions sent to the page. Each carries its whole plan, so an unbounded
 *  list would grow the page with every save; older ones stay in the store. */
const HISTORY_LIMIT = 30;

export const load: PageServerLoad = async (event) => {
  requireAuth(event);
  const slug = event.params.slug;
  const lesson = readLessons().find(l => l.slug === slug);
  if (!lesson) error(404, 'לא נמצא');

  /* history() is newest first. A version whose content does not parse is
     listed but cannot be loaded, rather than taking the page down. */
  const all = history(slug, 'plan');
  /* The one the student sees: the newest published version. */
  const liveVersion = all.find(v => v.published_at)?.version ?? null;
  const versions = all.slice(0, HISTORY_LIMIT).map(v => {
    let plan: ReturnType<typeof formPlan> | null = null;
    try { plan = formPlan(JSON.parse(v.content)); } catch { /* listed, not loadable */ }
    return {
      version: v.version, origin: v.origin, createdAt: v.created_at,
      publishedAt: v.published_at, teacherOnly: v.teacher_only, plan,
    };
  });

  /* What the form starts from — the same rule every save applies to. */
  const base = editBase(slug);

  return {
    slug,
    /* A master's check questions and homework are editable too: no child
       has played it, and the next booking copies what is published. */
    isMaster: isLibrarySlug(slug),
    seedVersion: base?.version ?? null,
    pendingRegeneration: base?.pendingRegeneration ?? null,
    lesson: { title: lesson.title, topic: lesson.topic, student: lesson.student, subject: lesson.subject, level: lesson.level },
    versions,
    liveVersion,
    olderVersions: Math.max(0, all.length - HISTORY_LIMIT),
    unpublishedEdits: hasUnpublishedEdits(slug, 'plan'),
  };
};
