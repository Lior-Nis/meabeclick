/**
 * Pure candidate-matching and payload-building logic for the tutor
 * dashboard's one-time browser→server profile import (the panel in
 * app/dashboard/+page.svelte). Extracted out of the component so the two
 * defects it must never regress on have unit coverage that does not need a
 * browser:
 *
 *   - Critical 2: `progress` / `progressNote` are browser-only exactly like
 *     goals/style/notes, and must be detected and carried into the payload
 *     the same way — a real student's progress text has no other copy.
 *   - Important 3: two roster rows can share a name (siblings in different
 *     families is ordinary on a tutoring roster). Resolving that to either
 *     row silently would write one child's notes onto the other's record,
 *     so it is marked `ambiguous` and carries no `code` — nothing can ever
 *     be sent for it.
 */

export interface LocalStudentProfile {
  name: string;
  goals?: string | null;
  style?: string | null;
  notes?: string | null;
  progress?: number | null;
  progressNote?: string | null;
}

export interface RosterEntry {
  code: string;
  name: string;
}

export type MatchStatus = 'matched' | 'no-match' | 'ambiguous';

export interface ImportCandidate {
  localName: string;
  goals: string;
  style: string;
  notes: string;
  progress: number;
  progressNote: string;
  code: string | null;
  matchName: string | null;
  status: MatchStatus;
}

export interface ImportPayloadEntry {
  code: string;
  goals: string;
  style: string;
  notes: string;
  progress: number;
  progressNote: string;
}

function isNonEmptyText(v: unknown): boolean {
  return typeof v === 'string' && v.trim() !== '';
}

/** Anything worth showing the tutor at all — a local card with nothing in
 *  any of the five server-backed fields has nothing to import. */
function hasImportableData(s: LocalStudentProfile): boolean {
  return (
    isNonEmptyText(s.goals) ||
    isNonEmptyText(s.style) ||
    isNonEmptyText(s.notes) ||
    isNonEmptyText(s.progressNote) ||
    (typeof s.progress === 'number' && s.progress > 0)
  );
}

/**
 * Matched by name against the real roster — the only field a local card and
 * a real student share (the local card never had a `code`). Best-effort and
 * shown to the tutor before anything is sent; she is the check the task
 * requires, not this heuristic.
 */
export function computeImportCandidates(
  students: LocalStudentProfile[],
  roster: RosterEntry[],
): ImportCandidate[] {
  return students.filter(hasImportableData).map((s) => {
    const matches = roster.filter((rs) => rs.name.trim() === s.name.trim());
    const status: MatchStatus =
      matches.length === 0 ? 'no-match' : matches.length === 1 ? 'matched' : 'ambiguous';
    const match = status === 'matched' ? matches[0] : null;
    return {
      localName: s.name,
      goals: s.goals || '',
      style: s.style || '',
      notes: s.notes || '',
      progress: typeof s.progress === 'number' ? s.progress : 0,
      progressNote: s.progressNote || '',
      code: match ? match.code : null,
      matchName: match ? match.name : null,
      status,
    };
  });
}

/** What actually goes to POST /api/students/import-local — every field the
 *  server accepts, restricted to unambiguous matches only. */
export function buildImportPayload(candidates: ImportCandidate[]): ImportPayloadEntry[] {
  return candidates
    .filter((c): c is ImportCandidate & { code: string } => c.status === 'matched' && !!c.code)
    .map((c) => ({
      code: c.code,
      goals: c.goals,
      style: c.style,
      notes: c.notes,
      progress: c.progress,
      progressNote: c.progressNote,
    }));
}
