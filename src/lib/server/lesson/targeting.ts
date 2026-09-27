/**
 * Which skill a lesson is for, and the links that make its practice into
 * evidence about that skill.
 *
 * From docs/superpowers/specs/2026-09-21-progress-from-evidence-design.md
 * §2 and §6 step 3. The evidence already exists — results_v2 has score,
 * tries, hints and seconds per play; homework has the task and whether it
 * was done — and until now none of it was connected to a skill, so every
 * suggestion rule in §3.2 had nothing to read.
 *
 * ## The model is never asked for an id
 *
 * The generator is told a skill's TITLE, as part of what to teach. The node
 * id stays here and is what the rows are tagged with. Asking a model to
 * echo an id invites one that does not exist, or one belonging to another
 * student's plan, and a wrong link is worse than no link: it becomes
 * evidence about a skill nobody practised. The pipeline already knows which
 * skill it asked about, so this is a fact rather than an output to trust.
 *
 * Same principle as games/registry.json's templates: the model supplies
 * content, never identity.
 */
import { getStudentByCode, enrollmentsForStudent } from '../entities.ts';
import { planForEnrollment, planData, lastLessonAt } from '../plans/store.ts';
import { buildTree, nextTargetSkill } from '../plans/view.ts';
import { handle } from '../db.ts';

export interface TargetSkill { id: number; title: string }

/**
 * The skill this student's next lesson in this subject should target, or
 * null.
 *
 * Null is the ordinary case today and must stay cheap: almost no student
 * has a plan, and generation has to carry on exactly as it did before,
 * producing a lesson with no evidence link rather than refusing.
 *
 * Scoped to the SUBJECT. A student can be enrolled in maths and physics
 * with a plan for each, and tagging a physics lesson with a maths skill
 * would put evidence under a skill the child never practised.
 */
export function targetSkillFor(studentCode: string | null, subject: string): TargetSkill | null {
  if (!studentCode) return null;
  const student = getStudentByCode(studentCode);
  if (!student) return null;

  const enrollment = enrollmentsForStudent(student.id).find(e => e.subject === subject);
  if (!enrollment) return null;

  const plan = planForEnrollment(enrollment.id);
  if (!plan) return null;

  const { nodes, prereqs, events } = planData(plan.id);
  return nextTargetSkill(buildTree(nodes, prereqs, events, lastLessonAt(student.id)));
}

/**
 * Records that this published game practises this skill, for this student.
 *
 * Keyed on (student_id, data_id), not on data_id: a data id identifies a
 * GAME, and the same game is assigned to many children. Keying on it alone
 * would make one child's play into evidence about another child's skill —
 * the same hazard homeworkForStudent already guards by matching
 * `r.student_id = h.student_id`.
 *
 * Upsert rather than insert: republishing a lesson must not accumulate
 * rows, and the newest link is the true one.
 */
export function linkGameToSkill(studentId: number, dataId: string, nodeId: number): void {
  handle().prepare(`
    INSERT INTO game_skills (student_id, data_id, node_id, at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (student_id, data_id) DO UPDATE SET node_id = excluded.node_id, at = excluded.at
  `).run(studentId, dataId, nodeId, new Date().toISOString());
}

/** The skill a game practises for one student, or null when it is not
 *  linked — which means its plays are not evidence about anything. */
export function skillForGame(studentId: number, dataId: string): number | null {
  const row = handle().prepare(
    `SELECT node_id FROM game_skills WHERE student_id = ? AND data_id = ?`
  ).get(studentId, dataId) as { node_id: number } | undefined;
  return row?.node_id ?? null;
}
