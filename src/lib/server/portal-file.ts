/**
 * A one-glance summary of a student's portal file.
 *
 * The multi-child overview shows a card per child, and each card needs the
 * few facts a parent scans for — next lesson, how much homework is open —
 * without shipping the whole file for every sibling. `/api/portal/:code`
 * still serves the full record for the child actually being read.
 *
 * Every failure returns null rather than throwing. The overview renders
 * every sibling at once, so one student whose file is missing or corrupt
 * must degrade to a card with less on it, not blank the page for the rest
 * of the family.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { portalDir } from './paths.ts';

const CODE_FORMAT = /^[a-z0-9-]+$/;

export interface PortalSummary {
  subject: string;
  level: string;
  /** null when no lesson is scheduled — enroll.ts writes blank strings on a
   *  first booking rather than omitting the field. */
  nextLesson: { date: string; time: string } | null;
  openHomework: number;
  lessonCount: number;
}

export function readPortalSummary(code: string): PortalSummary | null {
  // This builds a filesystem path. The code always arrives from a
  // session-scoped student row today, but the guard is one line and it
  // stops that from being load-bearing.
  if (!code || !CODE_FORMAT.test(code)) return null;

  const file = join(portalDir(), `${code}.json`);
  if (!existsSync(file)) return null;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }

  const homework = Array.isArray(data.homework) ? data.homework : [];
  const lessons = Array.isArray(data.lessons) ? data.lessons : [];
  const next = (data.nextLesson ?? null) as { date?: string; time?: string } | null;

  return {
    subject: String(data.subject ?? ''),
    level: String(data.level ?? ''),
    nextLesson: next?.date
      ? { date: String(next.date), time: String(next.time ?? '') }
      : null,
    openHomework: homework.filter((h) => h && typeof h === 'object' && !(h as { done?: unknown }).done).length,
    lessonCount: lessons.length,
  };
}
