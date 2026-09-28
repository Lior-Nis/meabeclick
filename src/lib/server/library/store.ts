/**
 * library_items (migration 023): which master lesson is the prepared
 * material for a skill of a plan template, and where its preparation stands.
 */
import { handle } from '../db.ts';

export type LibraryStatus = 'queued' | 'preparing' | 'ready' | 'held' | 'failed';

export interface LibraryItem {
  templateId: string;
  skillKey: string;
  slug: string | null;
  status: LibraryStatus;
  problem: string | null;
  updatedAt: string;
}

type Row = { template_id: string; skill_key: string; slug: string | null; status: LibraryStatus; problem: string | null; updated_at: string };
const toItem = (r: Row): LibraryItem => ({
  templateId: r.template_id, skillKey: r.skill_key, slug: r.slug,
  status: r.status, problem: r.problem, updatedAt: r.updated_at,
});

export function setItem(i: { templateId: string; skillKey: string; status: LibraryStatus; slug?: string | null; problem?: string | null }): LibraryItem {
  /* `slug` omitted keeps the one on record: queueing a skill again must not
     forget its current master before a new one exists. */
  handle().prepare(`
    INSERT INTO library_items (template_id, skill_key, slug, status, problem, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (template_id, skill_key) DO UPDATE SET
      slug = COALESCE(excluded.slug, library_items.slug),
      status = excluded.status, problem = excluded.problem, updated_at = excluded.updated_at
  `).run(i.templateId, i.skillKey, i.slug ?? null, i.status, i.problem ?? null, new Date().toISOString());
  return itemFor(i.templateId, i.skillKey)!;
}

export function itemFor(templateId: string, skillKey: string): LibraryItem | null {
  const r = handle().prepare(`SELECT * FROM library_items WHERE template_id = ? AND skill_key = ?`)
    .get(templateId, skillKey) as Row | undefined;
  return r ? toItem(r) : null;
}

export function itemsForTemplate(templateId: string): LibraryItem[] {
  return (handle().prepare(`SELECT * FROM library_items WHERE template_id = ? ORDER BY skill_key`)
    .all(templateId) as Row[]).map(toItem);
}
