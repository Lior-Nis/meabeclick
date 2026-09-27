/**
 * `DELETE /api/students/:code` — remove a student from the entity model.
 *
 * Deletes the legacy row too, so the two stores cannot disagree about who
 * exists while the legacy tables are still being retired.
 *
 * A student with real history (lessons, results, bookings, payments) is
 * refused by the foreign keys rather than cascaded away — see
 * deleteStudentCascade. The tutor gets a 409 she can act on instead of a
 * silent hole in the ledger.
 *
 * `PATCH /api/students/:code` — a partial edit to the three profile fields
 * migration 010 gave a server home (goals/style/notes) plus progress and
 * progress_note. "Partial" is load-bearing: a field the request does not
 * mention must survive untouched, which is why presence is checked with
 * `in` rather than `body.field ?? somethingElse` — the latter cannot tell
 * "not sent" from "sent as null/empty", and either misreading would let one
 * field edit blank the others. See updateStudentProfile() for the same
 * property enforced at the entities layer.
 */
import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { deleteStudentCascade, getStudentByCode, updateStudentProfile, type StudentProfileFields } from '$server/entities.ts';
import { deleteStudent as deleteLegacyStudent } from '$server/db.ts';
import { readJson } from '$server/http.ts';
import type { RequestHandler } from './$types';

const NOT_FOUND = { error: 'student not found' };

const TEXT_FIELDS = ['goals', 'style', 'notes', 'progressNote'] as const;

export const PATCH: RequestHandler = async (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;

  const student = getStudentByCode(event.params.code);
  if (!student) return json(NOT_FOUND, { status: 404 });

  const parsed = await readJson(event.request);
  if (parsed instanceof Response) return parsed;
  const body = parsed as Record<string, unknown>;

  const fields: StudentProfileFields = {};

  // Untrusted at runtime regardless of what the type above claims — a
  // caller can send anything. `null` is kept as an explicit "clear this
  // field"; anything else is coerced with String() the way enroll.ts does,
  // rather than trusting it to already be a string.
  for (const key of TEXT_FIELDS) {
    if (!(key in body)) continue;
    const raw = body[key];
    fields[key] = raw === null ? null : String(raw ?? '');
  }

  if ('progress' in body) {
    // Number(null) is 0 — a bug distinct from Number('abc') being NaN. Both
    // must be rejected explicitly rather than one of them silently resetting
    // a real student's progress to 0, which is what `{ progress: null }`
    // used to do before this check.
    const raw = body.progress;
    const progress = raw === null ? NaN : Number(raw);
    if (!Number.isFinite(progress)) {
      return json({ error: 'progress must be a number' }, { status: 400 });
    }
    fields.progress = progress;
  }

  const updated = updateStudentProfile(student.id, fields);
  return json({ student: updated });
};

export const DELETE: RequestHandler = async (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;

  let deleted: boolean;
  try {
    deleted = deleteStudentCascade(event.params.code);
  } catch (err) {
    return json({
      error: 'לא ניתן למחוק — יש שיעורים, תשלומים, תכנית למידה או דיווח שמקושרים לתלמיד/ה הזה/ו',
      detail: (err as Error).message,
    }, { status: 409 });
  }

  // Best-effort: a legacy row may not exist for a student created after the
  // migration, and its absence is not a failure.
  try { deleteLegacyStudent(event.params.code); } catch { /* nothing to remove */ }

  return json({ deleted });
};
