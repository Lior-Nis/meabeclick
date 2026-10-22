/**
 * /api/health/ops — the daily ops health check (Todoist 6hmX5rXVh6J636HH;
 * the checks themselves are in $server/ops-health.ts).
 *
 *   GET   the report as JSON. Sends nothing. Still runs the live probes
 *         (site, Drive listing, SMTP login, calendar robot sign-in), all
 *         read-only.
 *   POST  the report, plus ONE summary per configured ops channel when any
 *         check failed. Driven by server/meabeclick-ops-health.timer, every
 *         morning Israel time.
 *
 * Same door and same channel as /api/health/generation: the shared cron
 * key (a tutor session is not enough), and alertChannels()/deliverAlert()
 * from $server/ops-alert.ts — 503 when no channel is configured, 502 when a
 * configured channel could not be reached, 200 and silence on a healthy day.
 *
 * What this route cannot report is its own absence: if the app is down the
 * timer's curl fails, and the unit's OnFailure= handler
 * (server/health-alert.sh) sends the message from the host instead.
 */
import { json } from '@sveltejs/kit';
import { authorizedCronRequest } from '$server/cron-auth.ts';
import { opsHealth, runOpsHealthCheck } from '$server/ops-health.ts';
import { alertChannels, channelLabel, sendAlert } from '$server/ops-alert.ts';
import type { RequestHandler } from './$types';

const denied = (key: string | null) =>
  authorizedCronRequest(key) ? null : json({ error: 'unauthorized' }, { status: 401 });

export const GET: RequestHandler = async ({ request }) => {
  const no = denied(request.headers.get('x-cron-key'));
  if (no) return no;
  const channels = alertChannels();
  return json({
    ...(await opsHealth()),
    alertChannels: channels.ok ? channels.channels.map(channelLabel) : [],
    ...(channels.ok ? {} : { alertChannelProblem: channels.reason }),
  }, { headers: { 'Cache-Control': 'no-store' } });
};

export const POST: RequestHandler = async ({ request }) => {
  const no = denied(request.headers.get('x-cron-key'));
  if (no) return no;
  const { status, body } = await runOpsHealthCheck({
    health: await opsHealth(),
    channels: alertChannels(),
    send: sendAlert,
  });
  return json(body, { status });
};
