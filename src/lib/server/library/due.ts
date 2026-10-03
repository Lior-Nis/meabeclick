/**
 * What the library is about to be asked for: the skill each student's next
 * lesson will target (targeting.ts, the same choice a booking makes), and
 * whether its master is ready. A booking on a ready skill is built from the
 * library; on any other it waits for a generation run.
 *
 * Tutor only: it names students.
 */
import { handle } from '../db.ts';
import { targetSkillFor } from '../lesson/targeting.ts';
import { templateById } from '../plans/templates.ts';
import { firstName } from '../../names.ts';
import { itemFor, type LibraryItem } from './store.ts';
import { planData, lastLessonAt } from '../plans/store.ts';
import { buildTree, upcomingSkills } from '../plans/view.ts';

export interface DueSkill {
  templateId: string;
  track: string;
  skillKey: string;
  skillTitle: string;
  /** First names, for a tutor who knows who they are. */
  students: string[];
  item: LibraryItem | null;
}

export function dueNext(): DueSkill[] {
  const plans = handle().prepare(`
    SELECT s.code, s.name, e.subject
      FROM plans p JOIN enrollments e ON e.id = p.enrollment_id JOIN students_v2 s ON s.id = e.student_id
     ORDER BY p.id
  `).all() as { code: string; name: string; subject: string }[];

  const due = new Map<string, DueSkill>();
  for (const p of plans) {
    const target = targetSkillFor(p.code, p.subject);
    if (!target) continue;
    const id = `${target.templateId}/${target.key}`;
    const entry = due.get(id) ?? {
      templateId: target.templateId,
      track: templateById(target.templateId)?.track ?? target.templateId,
      skillKey: target.key,
      skillTitle: target.title,
      students: [],
      item: itemFor(target.templateId, target.key),
    };
    entry.students.push(firstName(p.name));
    due.set(id, entry);
  }
  /* What still needs preparing first; among those, the most students. */
  return [...due.values()].sort((a, b) =>
    Number(a.item?.status === 'ready') - Number(b.item?.status === 'ready') || b.students.length - a.students.length);
}

/**
 * Every skill some student will need within their next `ahead` skills
 * (plans/view.ts upcomingSkills), once, with whether the library has it
 * ready — what the tutor's machine prepares ahead (scripts/library-local.mjs
 * --due). Skills only, never students: the box's cron key reads it.
 */
export function dueAhead(ahead: number): { templateId: string; skillKey: string; ready: boolean }[] {
  const plans = handle().prepare(`SELECT p.id, p.template_id, e.student_id FROM plans p JOIN enrollments e ON e.id = p.enrollment_id ORDER BY p.id`)
    .all() as { id: number; template_id: string; student_id: number }[];
  const seen = new Map<string, { templateId: string; skillKey: string; ready: boolean }>();
  for (const p of plans) {
    const { nodes, prereqs, events } = planData(p.id);
    for (const s of upcomingSkills(buildTree(nodes, prereqs, events, lastLessonAt(p.student_id)), ahead)) {
      const id = `${p.template_id}/${s.key}`;
      if (!seen.has(id)) seen.set(id, { templateId: p.template_id, skillKey: s.key, ready: itemFor(p.template_id, s.key)?.status === 'ready' });
    }
  }
  return [...seen.values()];
}
