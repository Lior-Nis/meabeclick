/**
 * Game results, keyed on student_id.
 *
 * The retired version keyed on the Hebrew display name taken from the ?s=
 * query parameter, which meant two children sharing a first name shared a
 * results history, and renaming a child orphaned theirs.
 */
import { handle } from './db.ts';

export type ResultRow = {
  id: number; student_id: number; at: string; data_id: string | null;
  template: string | null; score: number | null; total: number | null;
  tries: number | null; stars: number | null; seconds: number | null;
  missed: string | null; hints: number | null;
};

const int = (v: unknown): number | null => (Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown, max: number): string | null =>
  v == null ? null : String(v).slice(0, max);

export function writeResult(r: {
  studentId: number; dataId?: unknown; template?: unknown; score?: unknown;
  total?: unknown; tries?: unknown; stars?: unknown; durationSec?: unknown; missed?: unknown;
  /** How many hints the child asked for. Undefined when the template
   *  offers none — stored as NULL, which means "not measured", not
   *  "needed no help". See migration 015. */
  hints?: unknown;
}): void {
  handle().prepare(`
    INSERT INTO results_v2 (student_id, at, data_id, template, score, total, tries, stars, seconds, missed, hints)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    r.studentId, new Date().toISOString(),
    str(r.dataId, 120), str(r.template, 40),
    int(r.score), int(r.total), int(r.tries), int(r.stars), int(r.durationSec),
    JSON.stringify((Array.isArray(r.missed) ? r.missed : []).slice(0, 40).map(m => String(m).slice(0, 200))),
    int(r.hints),
  );
}

export function getBest(studentId: number, dataId: string): number | null {
  const row = handle().prepare(
    `SELECT MAX(score) AS best FROM results_v2 WHERE student_id = ? AND data_id = ?`
  ).get(studentId, dataId) as { best: number | null } | undefined;
  return row?.best ?? null;
}

export function resultsForStudent(studentId: number): ResultRow[] {
  return handle().prepare(
    `SELECT * FROM results_v2 WHERE student_id = ? ORDER BY at DESC`
  ).all(studentId) as ResultRow[];
}

type StudentIdRow = { id: number };
type StudentRefRow = { code: string; name: string };

/**
 * Which student is this reference? Code first, then a display name that is
 * unique across students. Ambiguous or unknown returns null — never a guess.
 *
 * A guess here files one child's work under another child's name, which is
 * the defect this module's header describes and cannot be undone by hand.
 * Shared by the live write path and migration 008's backfill so there is one
 * attribution rule rather than two that drift.
 */
export function resolveStudent(ref: string): number | null {
  const db = handle();

  const byCode = db.prepare(
    `SELECT id FROM students_v2 WHERE code = ?`
  ).get(ref) as StudentIdRow | undefined;
  if (byCode) return byCode.id;

  const byName = db.prepare(
    `SELECT id FROM students_v2 WHERE name = ?
       AND (SELECT COUNT(*) FROM students_v2 s2 WHERE s2.name = ?) = 1`
  ).get(ref, ref) as StudentIdRow | undefined;
  return byName?.id ?? null;
}

/** What do we call this student? The URL-facing code and the display name. */
export function studentRefById(id: number): { code: string; name: string } | null {
  const row = handle().prepare(
    `SELECT code, name FROM students_v2 WHERE id = ?`
  ).get(id) as StudentRefRow | undefined;
  return row ? { code: row.code, name: row.name } : null;
}
