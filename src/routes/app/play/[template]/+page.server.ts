/**
 * Port of games/*.html's `Game.boot()` fetch — but server-side. The old
 * templates fetched `./data/<id>.json` from the client with no auth
 * whatsoever (any dataId in the registry-shaped filesystem was world
 * readable); this route fetches it here, after verifying the URL's
 * signature (src/lib/server/urls.ts), so a game data file is only ever
 * served alongside proof the link was legitimately issued to `student`.
 *
 * Also where the personal-best fix (tracked bug 6hJh337GrfGQj5Hq) lands:
 * `getBest(student, dataId)` reads the real, cross-device score history
 * instead of the localStorage value that a WhatsApp in-app WebView wipes
 * between opens. Computed here for every template, not just speed-drill —
 * GameShell renders it generically (see its header comment) rather than
 * each template re-implementing its own "best" lookup.
 */
import { error } from '@sveltejs/kit';
import { readContent } from '$server/content.ts';
import { verifyGameSignature } from '$server/urls.ts';
// Two `getBest`s, deliberately imported under distinct names: db.ts's is
// keyed on the legacy display name and reads the retired table; results.ts's
// is keyed on student_id and reads results_v2. Conflating them (both share
// the plain name `getBest`) is exactly the mix-up that produced this fix.
import { getBest } from '$server/db.ts';
import { resolveStudent, studentRefById, getBest as getBestById } from '$server/results.ts';
import { isKnownTemplate } from '$server/lesson/registry.ts';
import { practiceGoal } from '$server/lesson/targeting.ts';
import type { GameData } from '$lib/games/engine.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
  if (!isKnownTemplate(params.template)) {
    error(404, 'תבנית משחק לא ידועה');
  }

  const dataId = url.searchParams.get('d');
  const student = url.searchParams.get('s') ?? '';
  const t = url.searchParams.get('t');

  if (!dataId || !verifyGameSignature({ dataId, student, t })) {
    error(403, 'קישור לא תקין');
  }

  let gameData: GameData;
  try {
    const body = await readContent('games-data', dataId);
    gameData = JSON.parse(body.toString('utf8')) as GameData;
  } catch {
    error(404, `לא נמצא קובץ המשחק ${dataId}.json`);
  }

  /* `student` is whatever the signed link carries — a stable code on links
     built since this change, a display name on links already in a family's
     WhatsApp thread. Resolve once: the id keys the personal best, the name
     is what a child should see. Both fall back to the raw value, so an
     unresolvable old link renders exactly as it does today. */
  const studentId = resolveStudent(student);
  const ref = studentId === null ? null : studentRefById(studentId);
  const displayName = ref?.name ?? student;

  return {
    template: params.template,
    dataId,
    student,
    t,
    title: gameData.title || '',
    subject: [gameData.subject, displayName].filter(Boolean).join(' · '),
    best: studentId === null ? getBest(student, dataId) : getBestById(studentId, dataId),
    /* What this game practises, when it was made for a skill of this child's plan. */
    skill: studentId === null ? null : practiceGoal(studentId, dataId),
    gameData,
  };
};
