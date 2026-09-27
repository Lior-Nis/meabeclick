/**
 * `POST /api/students/import-local` — the tutor's explicit, one-time bridge
 * from a browser's local student card (localStorage `tutor_dashboard_v2`)
 * into the server-backed profile fields migration 010 added.
 *
 * This endpoint exists and nothing more happens automatically — see
 * $server/student-import.ts for the three rules it enforces (never create,
 * never let an empty local value blank a real value, always report per
 * entry). The route's only job is turning an untrusted request body into
 * the typed shape that module expects.
 *
 * The caller (the dashboard's local-import UI, a later task) is expected to
 * have already matched each browser card to a real student's `code` — this
 * endpoint does not guess that mapping, and an entry with no `code` field
 * simply cannot match anything, which importLocalStudentProfiles reports as
 * skipped-no-match rather than a crash.
 */
import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { readJson } from '$server/http.ts';
import { importLocalStudentProfiles, type LocalProfileEntry } from '$server/student-import.ts';
import type { RequestHandler } from './$types';

/** Coerces one untrusted body entry into the shape importLocalStudentProfiles
 *  expects — String(x ?? '') / Number(x), never a method call on a value
 *  that might not be a string, the same defensiveness enroll.ts uses. A
 *  field the raw entry never mentions is left out entirely (not coerced to
 *  '' or 0), so the importer's own "was this supplied" check still works. */
function coerceEntry(raw: unknown): LocalProfileEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const code = String(r.code ?? '').trim();
  if (!code) return null;

  const entry: LocalProfileEntry = { code };
  if ('goals' in r) entry.goals = r.goals === null ? null : String(r.goals ?? '');
  if ('style' in r) entry.style = r.style === null ? null : String(r.style ?? '');
  if ('notes' in r) entry.notes = r.notes === null ? null : String(r.notes ?? '');
  if ('progressNote' in r) entry.progressNote = r.progressNote === null ? null : String(r.progressNote ?? '');
  if ('progress' in r) {
    const progress = Number(r.progress);
    if (Number.isFinite(progress)) entry.progress = progress;
  }
  return entry;
}

export const POST: RequestHandler = async (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;

  const parsed = await readJson(event.request);
  if (parsed instanceof Response) return parsed;
  const body = parsed as Record<string, unknown>;

  const rawEntries = Array.isArray(body.entries) ? body.entries : [];
  const entries = rawEntries
    // An entry with no usable code cannot match anything server-side, so it
    // is dropped here rather than reported — reporting it would need a
    // code to report it AS, and 'skipped-no-match' with an empty code is
    // not a useful line for the tutor to review.
    .map(coerceEntry)
    .filter((e): e is LocalProfileEntry => e !== null);

  return json({ results: importLocalStudentProfiles(entries) });
};
