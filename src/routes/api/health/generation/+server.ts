/**
 * /api/health/generation — the daily generation health check
 * (Todoist 6hmX5pXvghfFvv6H; the checks themselves are in
 * $server/lesson/generation-health.ts).
 *
 *   GET   the report as JSON. Sends nothing — for a person or a script
 *         (the CEO brief) that wants to look.
 *   POST  the report, plus ONE summary per configured channel (Slack and/or
 *         WhatsApp) when anything failed.
 *         Driven by server/meabeclick-generation-health.timer, every
 *         morning Israel time.
 *
 * Authenticated by the shared cron secret, like every timer-driven route: a
 * timer has no cookies and this is reachable from the internet. The report
 * names lesson slugs and failure text, so a tutor session is NOT enough —
 * same door as /api/reports/prompt.
 *
 * ## Silence must be impossible
 *
 * The whole reason this exists is that failures were silent. So:
 *  - no alert channel configured → 503 and a loud console.error, on EVERY
 *    run, healthy or not. A check that cannot speak is itself a failure; the
 *    unit goes red (`curl --fail`) and `systemctl --user --failed` shows it.
 *  - a configured channel could not be reached → 502, same reason, even if
 *    another channel got the message.
 *  - a healthy day → 200 and nothing sent. One message on failure, silent
 *    otherwise, as the task asks: a daily "all good" trains everyone to stop
 *    reading.
 *
 * ## Who gets it
 *
 * Every configured ops channel, once: Slack (OPS_SLACK_WEBHOOK_URL,
 * recommended) and/or Lior's WhatsApp (OPS_CALLMEBOT_PHONE +
 * OPS_CALLMEBOT_API_KEY). With neither, the tutor's existing CallMeBot
 * channel, said so in the response and the log. See alertChannels() in
 * $server/lesson/generation-health.ts. The webhook URL is the credential:
 * it is never logged or returned.
 *
 * GET ?days=N overrides the stale-booking window for a look (the timer uses
 * GENERATION_HEALTH_STALE_DAYS, default 3).
 */
import { json } from '@sveltejs/kit';
import { authorizedCronRequest } from '$server/cron-auth.ts';
import {
  generationHealth, alertChannels, channelLabel, sendSlack, staleDaysFrom, runHealthCheck,
} from '$server/lesson/generation-health.ts';
import { sendWhatsAppChecked } from '$server/lesson/queue.ts';
import type { RequestHandler } from './$types';

const denied = (key: string | null) =>
  authorizedCronRequest(key) ? null : json({ error: 'unauthorized' }, { status: 401 });

export const GET: RequestHandler = ({ request, url }) => {
  const no = denied(request.headers.get('x-cron-key'));
  if (no) return no;
  const n = Number(url.searchParams.get('days'));
  const staleDays = Number.isInteger(n) && n > 0 && n <= 60 ? n : staleDaysFrom();
  const channels = alertChannels();
  return json({
    ...generationHealth(new Date(), { staleDays }),
    alertChannels: channels.ok ? channels.channels.map(channelLabel) : [],
    ...(channels.ok ? {} : { alertChannelProblem: channels.reason }),
  }, { headers: { 'Cache-Control': 'no-store' } });
};

export const POST: RequestHandler = async ({ request }) => {
  const no = denied(request.headers.get('x-cron-key'));
  if (no) return no;
  const { status, body } = await runHealthCheck({
    health: generationHealth(),
    channels: alertChannels(),
    send: (text, c) => (c.kind === 'slack' ? sendSlack(text, c.webhookUrl) : sendWhatsAppChecked(text, c.to)),
  });
  return json(body, { status });
};
