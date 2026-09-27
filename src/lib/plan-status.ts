/**
 * The vocabulary of a learning plan, shared by the server and the page.
 *
 * Lives in $lib (not $lib/server) because the plan page renders these labels;
 * the values themselves are also the CHECK constraints in migration 004, so
 * changing one means changing both.
 */
export type SkillStatus =
  | 'not_checked' | 'started' | 'guided' | 'with_help' | 'independent' | 'needs_review';

/** Display order: how far along the skill is, ending with the flag that pulls
 *  a skill back into the next lesson. */
export const STATUSES: SkillStatus[] = [
  'not_checked', 'started', 'guided', 'with_help', 'independent', 'needs_review',
];

export const STATUS_LABEL: Record<SkillStatus, string> = {
  not_checked: 'לא נבדק',
  started: 'התחלה',
  guided: 'בתרגול מודרך',
  with_help: 'בוצע עם עזרה',
  independent: 'בוצע עצמאית',
  needs_review: 'דורש חזרה',
};

/** A prerequisite counts as met at these statuses and no others — "done with
 *  help" is enough to move on, "needs review" is not. */
export const SATISFIED: SkillStatus[] = ['with_help', 'independent'];

export type Evidence = 'lesson' | 'homework' | 'game' | 'test' | 'other';

export const EVIDENCE_LABEL: Record<Evidence, string> = {
  lesson: 'תצפית בשיעור',
  homework: 'שיעורי בית',
  game: 'משחק תרגול',
  test: 'מבחן',
  other: 'אחר',
};

/** For validating an unknown string against the vocabulary with `.includes`
 *  — unlike `evidence in EVIDENCE_LABEL`, this can't be tricked by a
 *  prototype-chain key ('constructor', 'toString', '__proto__', …). */
export const EVIDENCES: Evidence[] = ['lesson', 'homework', 'game', 'test', 'other'];

export type Visibility = 'active' | 'paused' | 'hidden';

export const VISIBILITY_LABEL: Record<Visibility, string> = {
  active: 'פעיל',
  paused: 'מושהה',
  hidden: 'מוסתר',
};

/** Same reasoning as EVIDENCES above. */
export const VISIBILITIES: Visibility[] = ['active', 'paused', 'hidden'];

/**
 * The plan page's "הצג" filter chips. Shared between the server load (which
 * validates the ?filter= a report-filing redirect or any other link may
 * carry — see src/routes/app/plan/[code]/+page.server.ts) and the page
 * itself (which renders the chips and applies the filter to the tree), so
 * the set of valid values can't drift between the two.
 */
export type FilterKind = 'all' | 'recommended' | 'needs_review' | 'blocked' | 'changed';
export const FILTER_VALUES: FilterKind[] = ['all', 'recommended', 'needs_review', 'blocked', 'changed'];
