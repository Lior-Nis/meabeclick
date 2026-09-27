/**
 * What a skill actually has behind it.
 *
 * The read half of the link added in #98. Game plays reach a skill through
 * `game_skills (student_id, data_id)`; written work through
 * `homework.node_id`. plans/suggest.ts is pure and consumes this.
 *
 * ## The rule this module exists to enforce
 *
 * **Evidence belongs to the child who produced it.** Both queries are
 * scoped by `student_id`, and that is not defensive tidiness: a `data_id`
 * identifies a GAME, not a child's copy of one, and the same game is
 * assigned to many children. A join on `data_id` alone would put one
 * child's score under another child's skill — the same hazard
 * homeworkForStudent already guards, and the reason game_skills is keyed on
 * the pair.
 *
 * Ordered oldest-first so a trend reads forwards; suggest.ts sorts again
 * rather than trusting this, because a caller assembling evidence by hand
 * is a caller who can get the order wrong.
 */
import { handle } from '../db.ts';
import type { SkillEvidence, Play, HomeworkEvidence } from './suggest.ts';

export function evidenceForSkill(studentId: number, nodeId: number): SkillEvidence {
  const db = handle();

  const plays = db.prepare(`
    SELECT r.at AS at, r.score AS score, r.total AS total, r.hints AS hints
    FROM results_v2 r
    JOIN game_skills g
      ON g.data_id = r.data_id
     AND g.student_id = r.student_id
    WHERE r.student_id = ? AND g.node_id = ?
    ORDER BY r.at
  `).all(studentId, nodeId) as unknown as Play[];

  /* `submitted` follows the same definition the student's page uses: a row
     is submitted when they said so, or when grading established that the
     work exists. A grade without a submission is the tutor doing it on the
     child's behalf, which setHomeworkSubmitted already models. */
  const homework = db.prepare(`
    SELECT COALESCE(h.graded_at, h.submitted_at, h.assigned_at) AS at,
           h.grade AS grade,
           (h.submitted_at IS NOT NULL OR h.graded_at IS NOT NULL) AS submitted_flag
    FROM homework h
    WHERE h.student_id = ? AND h.node_id = ?
    ORDER BY at
  `).all(studentId, nodeId) as unknown as (Omit<HomeworkEvidence, 'submitted'> & { submitted_flag: number })[];

  return {
    plays,
    homework: homework.map(({ submitted_flag, ...h }) => ({ ...h, submitted: submitted_flag === 1 })),
  };
}
