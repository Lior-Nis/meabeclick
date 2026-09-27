/**
 * The Drive sync, run every 10 minutes by server/meabeclick-drive-sync.timer.
 * Spec: docs/superpowers/specs/2026-09-25-drive-student-folders-design.md.
 *
 * Cron key only, like the other timer-driven routes. Answers with the
 * pass's counts — or { skipped } when the Drive login is not configured or
 * a pass is already running — so the timer's journal says what happened.
 */
import { json } from '@sveltejs/kit';
import { authorizedCronRequest } from '$server/cron-auth.ts';
import { driveApiFromEnv } from '$server/drive/api.ts';
import { syncDrive } from '$server/drive/sync.ts';
import { sendWhatsApp } from '$server/lesson/queue.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
  if (!authorizedCronRequest(request.headers.get('x-cron-key'))) {
    return json({ error: 'unauthorized' }, { status: 401 });
  }
  return json(await syncDrive({ api: driveApiFromEnv(), notify: sendWhatsApp }));
};
