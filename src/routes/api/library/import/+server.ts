/**
 * Imports a library lesson generated elsewhere: { template, skill, plan,
 * engine }. The tutor's machine prepares with Claude Code or opencode
 * (scripts/library-local.mjs) while production's Codex is unavailable, and
 * sends the plan here.
 *
 * Checked like any generated lesson (validateLesson) BEFORE anything is
 * written: a plan that would be held is refused with its problems, so an
 * import never leaves a held master behind. A passing one goes through the
 * same prepareSkill a preparation does — master lesson, published deck and
 * games, library item ready — with the engine recorded so the gate does not
 * count it as a Codex run.
 *
 * The tutor's session or the box's cron key, like /api/library/prepare.
 */
import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { authorizedCronRequest } from '$server/cron-auth.ts';
import { readJson } from '$server/http.ts';
import { validateLesson, type LessonPlan } from '$server/lesson/prep.ts';
import { prepareSkill } from '$server/library/prepare.ts';
import { itemFor } from '$server/library/store.ts';
import { skillExists } from '$server/library/view.ts';
import type { RequestHandler } from './$types';

const ENGINES = ['claude', 'opencode'] as const;
/** A lesson plan is tens of kilobytes. */
const MAX_PLAN = 1024 * 1024;

export const POST: RequestHandler = async (event) => {
  if (!authorizedCronRequest(event.request.headers.get('x-cron-key'))) {
    const denied = apiAuthDenied(event);
    if (denied) return denied;
  }
  const parsed = await readJson(event.request);
  if (parsed instanceof Response) return parsed;
  const { template, skill, plan, engine } = (parsed ?? {}) as Record<string, unknown>;

  if (typeof template !== 'string' || typeof skill !== 'string') return json({ error: 'חסרים תבנית ומיומנות' }, { status: 400 });
  if (!(ENGINES as readonly unknown[]).includes(engine)) {
    return json({ error: 'צריך לציין מי יצר את השיעור: claude או opencode' }, { status: 400 });
  }
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return json({ error: 'חסר שיעור' }, { status: 400 });
  if (JSON.stringify(plan).length > MAX_PLAN) return json({ error: 'השיעור גדול מדי' }, { status: 413 });
  if (!skillExists(template, skill)) return json({ error: 'אין מיומנות כזו' }, { status: 404 });
  if (['queued', 'preparing'].includes(itemFor(template, skill)?.status ?? '')) {
    return json({ error: 'המיומנות הזו בהכנה עכשיו' }, { status: 409 });
  }

  let problems: string[];
  try {
    problems = validateLesson(plan as LessonPlan);
  } catch {
    problems = ['השיעור לא במבנה של שיעור'];
  }
  if (problems.length) return json({ error: 'השיעור לא עבר את הבדיקה', problems }, { status: 422 });

  const item = await prepareSkill(template, skill, {
    generate: async () => plan as LessonPlan,
    engine: engine as (typeof ENGINES)[number],
  });
  return json({ item }, { status: item.status === 'ready' ? 200 : 500 });
};
