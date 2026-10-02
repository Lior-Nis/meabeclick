/**
 * After a lesson report: games for what was actually taught.
 *
 * A lesson's games come from the skill it was planned for. When the report
 * says other skills were covered and they have ready library lessons, up to
 * two games of each are copied into this lesson — written under new ids,
 * because a published game file is never rewritten (queue.ts, 'wx') — and
 * linked to the skill they practise, so the child's page offers practice
 * for what the lesson was really about. No engine runs.
 *
 * Deterministic ids make a second filing a no-op. The master this lesson
 * was itself copied from is skipped: its games are already here.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { portalDir } from '../paths.ts';
import { handle, readLessons } from '../db.ts';
import { contentPath } from '../content.ts';
import { TEMPLATE_FILES, toTemplateShape } from '../lesson/prep.ts';
import { linkGameToSkill } from '../lesson/targeting.ts';
import { libraryPlanFor, librarySourceOf } from './use.ts';

const PER_SKILL = 2;
const MAX_SKILLS = 3;
const segment = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export async function attachTaughtGames(input: {
  lessonSlug: string; studentId: number; templateId: string; skills: { key: string; nodeId: number }[];
}): Promise<number> {
  const lesson = readLessons().find(l => l.slug === input.lessonSlug);
  if (!lesson) return 0;
  const games = [...lesson.games] as { title: string; template: string; dataId: string }[];
  const have = new Set(games.map(g => g?.dataId));
  const source = librarySourceOf(input.lessonSlug);
  let added = 0;

  for (const skill of input.skills.slice(0, MAX_SKILLS)) {
    const master = libraryPlanFor(input.templateId, skill.key);
    if (!master || master.masterSlug === source) continue;
    const entries = Object.entries(master.plan.games ?? {}).filter(([k, d]) => TEMPLATE_FILES[k] && d).slice(0, PER_SKILL);
    for (const [key, data] of entries) {
      const template = TEMPLATE_FILES[key];
      const dataId = `${input.lessonSlug}-lib-${segment(skill.key)}-${template}`;
      if (have.has(dataId)) continue;
      const path = contentPath('games-data', dataId);
      await mkdir(dirname(path), { recursive: true });
      try {
        await writeFile(path, JSON.stringify(toTemplateShape(key, data), null, 2), { encoding: 'utf8', flag: 'wx' });
      } catch (err) {
        /* Written by an earlier filing that did not get as far as the list:
           the file is that same copy, so it is used, never overwritten. */
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      }
      games.push({ title: (data as { title?: string }).title ?? template, template, dataId });
      have.add(dataId);
      linkGameToSkill(input.studentId, dataId, skill.nodeId);
      added += 1;
    }
  }
  if (!added) return 0;
  handle().prepare(`UPDATE lessons SET games = ? WHERE slug = ?`).run(JSON.stringify(games), input.lessonSlug);
  await addToPortal(input.studentId, games.slice(-added));
  return added;
}

/** The child's page reads its games from the portal file — newest first,
 *  twenty at most, as queue.ts appendToPortal keeps it. A child without
 *  a portal file has no page to show them on. */
async function addToPortal(studentId: number, added: { title: string; template: string; dataId: string }[]): Promise<void> {
  const row = handle().prepare(`SELECT code FROM students_v2 WHERE id = ?`).get(studentId) as { code: string } | undefined;
  if (!row) return;
  const path = join(portalDir(), `${row.code}.json`);
  let data: { games?: unknown[] };
  try { data = JSON.parse(await readFile(path, 'utf8')); } catch { return; }
  data.games = [...added, ...(data.games ?? [])].slice(0, 20);
  await writeFile(path, JSON.stringify(data, null, 2));
}
