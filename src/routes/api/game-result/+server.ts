/**
 * Games post here anonymously — opened from a WhatsApp link with no
 * session. Direct port of server/app.mjs's `POST /api/game-result`, with
 * one sanctioned behavior change: a signature is now required (see
 * $server/urls.ts and the `todoist-6hJh32VVc5VH2jVq` entry in
 * tests/characterization/expected-changes.mjs) so a child's homework score
 * can no longer be forged by an anonymous POST.
 */
import { json } from '@sveltejs/kit';
import { writeResult } from '$server/db.ts';
import { verifyGameSignature } from '$server/urls.ts';
import { readJson } from '$server/http.ts';
import { resolveStudent, writeResult as writeResultV2 } from '$server/results.ts';
import type { RequestHandler } from './$types';

// verifyGameSignature (src/lib/server/urls.ts) is not defensive against
// non-string input: it dereferences `dataId.length` unconditionally, and
// once `t` is truthy it does `Buffer.from(t)`, which throws on anything
// that isn't a string (a number, a boolean, an object — all valid JSON).
// This is an anonymous, internet-facing endpoint, so a malformed-but-truthy
// dataId/t must fail the same clean 403 a bad signature gets, not an
// unhandled 500. `student` doesn't need this: it's already been coerced to
// a string above before reaching here.
const asNonEmptyString = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export const POST: RequestHandler = async ({ request }) => {
  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  const body = parsed as Record<string, unknown>;
  const student = String(body?.student ?? '').trim();
  if (!student) return json({ error: 'no student' }, { status: 400 });

  const dataId = asNonEmptyString(body?.dataId);
  const t = asNonEmptyString(body?.t);
  if (!dataId || !verifyGameSignature({ dataId, student, t })) {
    return json({ error: 'bad signature' }, { status: 403 });
  }

  // Never fail loudly: a storage problem must not make finished homework look broken.
  try {
    /* Resolve to a real student id when we can. An unresolvable reference —
       a name two children share, arriving on a link already sent over
       WhatsApp — falls back to the legacy table rather than dropping the
       play: readResults() unions both, so the tutor still sees it. Refusing
       to guess is deliberate; attributing one child's work to another cannot
       be undone by hand. */
    const studentId = resolveStudent(student);
    if (studentId === null) {
      // writeResult re-trims/re-validates `student` itself
      // (String(...).trim().slice(0, 60)), so passing the already-trimmed
      // local here instead of body.student changes nothing behaviorally —
      // it's only here to satisfy WriteResultInput's required `student`
      // property, which a bare `Record<string, unknown>` (unlike the `any`
      // `await request.json()` used to produce) doesn't structurally
      // guarantee.
      writeResult({ ...body, student });
    } else {
      writeResultV2({ ...body, studentId });
    }
    return json({ ok: true, stored: true });
  } catch (err) {
    console.error('game-result', err);
    return json({ ok: true, stored: false, reason: 'store error' });
  }
};
