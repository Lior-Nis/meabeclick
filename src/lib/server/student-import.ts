/**
 * The tutor's one-time bridge from the browser's local student card
 * (localStorage `tutor_dashboard_v2`) into the server-backed profile
 * fields introduced by migration 010.
 *
 * This never runs automatically. The PATCH route
 * (src/routes/api/students/[code]/+server.ts) is for a normal, one-field
 * edit; this is for the explicit "import from this browser" action the
 * tutor triggers by hand, reviewing the report it returns before trusting
 * it. That is not a UI nicety — it is the point: the browser copy is the
 * ONLY thing that has ever held goals/style/notes, and it can be stale,
 * half-filled, or filed under a code that no longer matches any real
 * student. Copying it over unconditionally would risk silently blanking a
 * real value with old browser junk, which is exactly the failure mode the
 * task calls out ("אין להעתיק נתוני דפדפן אוטומטית בלי בדיקה").
 *
 * Three rules, enforced here rather than trusted to the caller:
 *   1. Never create anything — accounts, students or enrollments. An entry
 *      whose code matches no student is reported, not turned into one.
 *   2. Never let an empty local value overwrite a non-empty (or any)
 *      server value: a field is only ever written when the local copy has
 *      something in it. An empty local value simply is not written, which
 *      trivially satisfies "never blank a real value with an empty one."
 *   3. Always report, per entry, what happened — updated (naming the
 *      fields), skipped-no-match, or skipped-empty — so the tutor can
 *      review the list before believing it did the right thing.
 *
 * Only the three orphan fields plus progress/progressNote are ever
 * touched, and only on `students_v2` — never accounts, never enrollments.
 */
import { getStudentByCode, updateStudentProfile, type StudentProfileFields } from './entities.ts';

/** One browser-local card, reduced to the fields this import can use.
 *  Callers (the API route) are responsible for coercing an untrusted
 *  request body into this shape before it reaches here. */
export type LocalProfileEntry = {
  code: string;
  goals?: string | null;
  style?: string | null;
  notes?: string | null;
  progress?: number;
  progressNote?: string | null;
};

const TEXT_FIELDS = ['goals', 'style', 'notes', 'progressNote'] as const;

export type ImportOutcome =
  | { code: string; result: 'updated'; fields: string[] }
  | { code: string; result: 'skipped-no-match' }
  | { code: string; result: 'skipped-empty' };

/** Blank covers absence, null, and whitespace-only — a browser field left
 *  untouched since the day the card was created reads as any of the three
 *  depending on how old the localStorage blob is. */
function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === '';
}

function importOne(entry: LocalProfileEntry): ImportOutcome {
  const student = getStudentByCode(entry.code);
  if (!student) return { code: entry.code, result: 'skipped-no-match' };

  const fields: StudentProfileFields = {};
  const touched: string[] = [];

  for (const key of TEXT_FIELDS) {
    const value = entry[key];
    if (!isBlank(value)) {
      fields[key] = String(value);
      touched.push(key);
    }
  }

  if (typeof entry.progress === 'number' && Number.isFinite(entry.progress)) {
    fields.progress = entry.progress;
    touched.push('progress');
  }

  if (!touched.length) return { code: entry.code, result: 'skipped-empty' };

  updateStudentProfile(student.id, fields);
  return { code: entry.code, result: 'updated', fields: touched };
}

/** Applies a batch of browser-local cards and reports, per entry, exactly
 *  what happened — see the file header for the three rules this enforces. */
export function importLocalStudentProfiles(entries: LocalProfileEntry[]): ImportOutcome[] {
  return entries.map(importOne);
}
