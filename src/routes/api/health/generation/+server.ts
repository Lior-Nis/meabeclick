/**
 * /api/health/generation — the daily generation health check
 * (Todoist 6hmX5pXvghfFvv6H; the checks themselves are in
 * $server/lesson/generation-health.ts).
 *
 *   GET   the report as JSON. Sends nothing — for a person or a script
 *         (the CEO brief) that wants to look.
 *   POST  the report, plus ONE WhatsApp summary when anything failed.
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
 *  - the WhatsApp could not be sent → 502, same reason.
 *  - a healthy day → 200 and nothing sent. One message on failure, silent
 *    otherwise, as the task asks: a daily "all good" trains everyone to stop
 *    reading.
 *
 * ## Who gets it
 *
 * OPS_CALLMEBOT_PHONE + OPS_CALLMEBOT_API_KEY: Lior's own CallMeBot channel
 * (CallMeBot issues a key per recipient phone, so both are needed). Unset,
 * it falls back to the existing tutor channel sendWhatsApp already uses
 * (CALLMEBOT_PHONE / CALLMEBOT_API_KEY) and says so in the response and the
 * log. Exactly one of the two OPS_ variables set is a misconfiguration and
 * answers 503 rather than guessing.
 */
import { json } from '@sveltejs/kit';
import { authorizedCronRequest } from '$server/cron-auth.ts';
import { generationHealth, formatAlert, alertChannel, type AlertChannel } from '$server/lesson/generation-health.ts';
import { sendWhatsAppChecked } from '$server/lesson/queue.ts';
import type { RequestHandler } from './$types';

const recipient = (c: AlertChannel): string =>
  c.kind === 'ops' ? 'ops (OPS_CALLMEBOT_PHONE)' : c.kind === 'tutor' ? 'tutor (CALLMEBOT_PHONE fallback)' : 'none';

const denied = (key: string | null) =>
  authorizedCronRequest(key) ? null : json({ error: 'unauthorized' }, { status: 401 });

export const GET: RequestHandler = ({ request }) => {
  const no = denied(request.headers.get('x-cron-key'));
  if (no) return no;
  const channel = alertChannel();
  return json({ ...generationHealth(), alertChannel: recipient(channel) },
    { headers: { 'Cache-Control': 'no-store' } });
};

export const POST: RequestHandler = async ({ request }) => {
  const no = denied(request.headers.get('x-cron-key'));
  if (no) return no;

  const health = generationHealth();
  const channel = alertChannel();
  const message = formatAlert(health);

  if (channel.kind === 'missing') {
    console.error(`[generation-health] ALERT CHANNEL NOT CONFIGURED — ${channel.reason}. `
      + `Generation is ${health.ok ? 'healthy' : 'FAILING'} and nobody can be told.`
      + (message ? ` Would have sent: ${message.replace(/\n/g, ' | ')}` : ''));
    return json({ error: 'alert channel not configured', reason: channel.reason, sent: false, ...health }, { status: 503 });
  }
  if (channel.kind === 'tutor') {
    console.warn('[generation-health] OPS_CALLMEBOT_* unset; alerts go to the tutor channel (CALLMEBOT_PHONE).');
  }

  if (!message) return json({ sent: false, alertChannel: recipient(channel), ...health });

  console.error(`[generation-health] ${message.replace(/\n/g, ' | ')}`);
  const result = await sendWhatsAppChecked(message, channel.to);
  if (!result.ok) {
    console.error(`[generation-health] COULD NOT SEND the alert: ${result.error}`);
    return json({ error: 'alert not sent', reason: result.error, sent: false, alertChannel: recipient(channel), ...health },
      { status: 502 });
  }
  return json({ sent: true, alertChannel: recipient(channel), ...health });
};
