/**
 * Prepares library masters: { template, topic } for a topic's skills that
 * are not ready yet, or { template, skill } for one skill, again.
 *
 * Answers 202 at once: each skill is minutes of engine time, run one at a
 * time in the background (library/prepare.ts). The tutor's page polls
 * GET /api/library for progress.
 *
 * The tutor's session, or the box's cron key — the same two ways in as the
 * Drive sync, so a topic can be prepared from the box without a password.
 */
import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { authorizedCronRequest } from '$server/cron-auth.ts';
import { readJson } from '$server/http.ts';
import { enqueue } from '$server/library/prepare.ts';
import { itemFor } from '$server/library/store.ts';
import { skillExists, topicSkillKeys } from '$server/library/view.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  if (!authorizedCronRequest(event.request.headers.get('x-cron-key'))) {
    const denied = apiAuthDenied(event);
    if (denied) return denied;
  }
  const parsed = await readJson(event.request);
  if (parsed instanceof Response) return parsed;
  const { template, topic, skill } = (parsed ?? {}) as Record<string, unknown>;
  if (typeof template !== 'string') return json({ error: 'חסרה תבנית' }, { status: 400 });

  let keys: string[];
  if (typeof skill === 'string') {
    if (!skillExists(template, skill)) return json({ error: 'אין מיומנות כזו' }, { status: 404 });
    keys = [skill];
  } else if (typeof topic === 'string') {
    const all = topicSkillKeys(template, topic);
    if (!all) return json({ error: 'אין נושא כזה' }, { status: 404 });
    keys = all.filter(k => itemFor(template, k)?.status !== 'ready');
  } else {
    return json({ error: 'חסר נושא או מיומנות' }, { status: 400 });
  }

  /* Not while it is already on its way: a second click must not queue the
     same skill twice. */
  keys = keys.filter(k => !['queued', 'preparing'].includes(itemFor(template, k)?.status ?? ''));
  if (keys.length) {
    enqueue(template, keys).catch(err => console.error('[library] queue failed:', (err as Error)?.message ?? err));
  }
  return json({ queued: keys }, { status: 202 });
};
