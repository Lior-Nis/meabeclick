/**
 * The shape of a draft opinion about a skill — declared once.
 *
 * In $lib rather than $lib/server because the report form renders it and
 * the engine produces it, and those must not each keep a copy. That is not
 * a hypothetical: the parent portal spent a release rendering
 * `[object Object]%` because two pages and one server hand-copied the
 * `progress` payload shape and one copy went stale (#97). Type-checking a
 * page against its own mistake is not type-checking.
 *
 * The ENGINE stays on the server (src/lib/server/plans/suggest.ts). Only
 * the vocabulary lives here.
 */
import type { SkillStatus } from './plan-status.ts';

/** One play of a game linked to a skill. `score`/`total` are nullable in
 *  results_v2, and a null is a missing measurement — never a zero. */
export interface Play {
  at: string;
  score: number | null;
  total: number | null;
  /** Hints the child asked for. NULL means not measured — a template
   *  that offers none, or a play from before migration 015 — which is
   *  not the same as needing no help. */
  hints?: number | null;
}

export interface HomeworkEvidence {
  at: string;
  /** The tutor's judgement, or null when nobody has looked yet. */
  grade: 'ok' | 'partial' | 'redo' | null;
  submitted: boolean;
}

export interface SkillEvidence { plays: Play[]; homework: HomeworkEvidence[] }

export interface Suggestion {
  status: SkillStatus;
  /** Counts and dates, in Hebrew, for the tutor to check against rows.
   *  Never a confidence score: "3 תרגולים, 85%" can be argued with,
   *  "confidence 0.7" cannot. */
  why: string;
  plays: number;
  /** Percent, 0-100, over plays that actually carry a score. */
  accuracy: number;
  lastAt: string;
}
