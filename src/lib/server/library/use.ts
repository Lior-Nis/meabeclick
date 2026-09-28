/**
 * Using the library at a booking: the master's published plan, copied into
 * the booking's own lesson with no engine run.
 * docs/superpowers/specs/2026-09-28-prepared-library-design.md
 */
import { handle } from '../db.ts';
import { latestPublished } from '../materials.ts';
import type { LessonPlan } from '../lesson/prep.ts';
import { itemFor } from './store.ts';

/** The current master for a skill, when it is ready. */
export function readyMaster(templateId: string, skillKey: string): { slug: string } | null {
  const item = itemFor(templateId, skillKey);
  return item?.status === 'ready' && item.slug ? { slug: item.slug } : null;
}

/** What a booking on this skill gets: the master's PUBLISHED plan — so the
 *  tutor's published edits are in it, and an unpublished draft is not.
 *  Null when there is no ready master, or its plan does not parse. */
export function libraryPlanFor(templateId: string, skillKey: string): { masterSlug: string; plan: LessonPlan } | null {
  const master = readyMaster(templateId, skillKey);
  if (!master) return null;
  const row = latestPublished(master.slug, 'plan');
  if (!row) return null;
  try {
    return { masterSlug: master.slug, plan: JSON.parse(row.content) as LessonPlan };
  } catch {
    return null;
  }
}

export function recordUse(u: { lessonSlug: string; masterSlug: string; templateId: string; skillKey: string }): void {
  handle().prepare(`
    INSERT OR REPLACE INTO library_uses (lesson_slug, master_slug, template_id, skill_key, at)
    VALUES (?, ?, ?, ?, ?)
  `).run(u.lessonSlug, u.masterSlug, u.templateId, u.skillKey, new Date().toISOString());
}

/** The master a lesson was copied from, or null for a generated one. */
export function librarySourceOf(lessonSlug: string): string | null {
  const r = handle().prepare(`SELECT master_slug FROM library_uses WHERE lesson_slug = ?`).get(lessonSlug) as { master_slug: string } | undefined;
  return r?.master_slug ?? null;
}
