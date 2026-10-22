/**
 * The ops alert channel: where a daily health check's ONE message goes, and
 * the never-silent rules for sending it.
 *
 * Shared by the daily generation health check
 * (lesson/generation-health.ts, Todoist 6hmX5pXvghfFvv6H) and the daily ops
 * health check (ops-health.ts, Todoist 6hmX5rXVh6J636HH). Both used to be
 * one file; the channel moved here when the second check arrived so there
 * is exactly one place that decides who gets told and what a failed send
 * means.
 */
import type { WhatsAppChannel } from './lesson/queue.ts';
import { sendWhatsAppChecked } from './lesson/queue.ts';

/* ── Where the alert goes ─────────────────────────────────────────────
 *
 * Slack first. OPS_SLACK_WEBHOOK_URL is an Incoming Webhook into a channel
 * Lior reads (#meabeclick). It is official, rate-limit-free at this volume
 * (one message a day), and puts no phone number at risk.
 *
 * WhatsApp is optional: OPS_CALLMEBOT_PHONE + OPS_CALLMEBOT_API_KEY. CallMeBot
 * is an unofficial, free, personal-use bot (see the PR for the ban-risk
 * notes); set it only as a second channel, on a personal (not WhatsApp
 * Business) number.
 *
 * Every configured ops channel gets the one summary. Only when NO ops
 * channel is set does it fall back to the tutor's existing CallMeBot
 * channel (CALLMEBOT_API_KEY), and says so. Nothing configured, or a
 * half-configured channel, is a 503: never guessed, never silent.
 */
export type AlertChannel =
  | { kind: 'slack'; webhookUrl: string }
  | { kind: 'whatsapp-ops'; to: WhatsAppChannel }
  | { kind: 'whatsapp-tutor'; to: null };

export type AlertChannels =
  | { ok: true; channels: AlertChannel[] }
  | { ok: false; reason: string };

/** Slack's own Incoming Webhook host. Anything else is a typo or a paste of
 *  the wrong thing, and posting the report there would leak it. */
const SLACK_WEBHOOK = /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_/-]+$/;

export function alertChannels(env: NodeJS.ProcessEnv = process.env): AlertChannels {
  const channels: AlertChannel[] = [];
  const slack = env.OPS_SLACK_WEBHOOK_URL?.trim();
  if (slack) {
    if (!SLACK_WEBHOOK.test(slack)) {
      return { ok: false, reason: 'OPS_SLACK_WEBHOOK_URL is not a https://hooks.slack.com/services/… URL' };
    }
    channels.push({ kind: 'slack', webhookUrl: slack });
  }
  const phone = env.OPS_CALLMEBOT_PHONE?.trim();
  const apiKey = env.OPS_CALLMEBOT_API_KEY?.trim();
  if (phone || apiKey) {
    if (!(phone && apiKey)) {
      return { ok: false, reason: 'only one of OPS_CALLMEBOT_PHONE / OPS_CALLMEBOT_API_KEY is set; set both or neither' };
    }
    channels.push({ kind: 'whatsapp-ops', to: { phone, apiKey } });
  }
  if (!channels.length && env.CALLMEBOT_API_KEY?.trim()) channels.push({ kind: 'whatsapp-tutor', to: null });
  if (!channels.length) {
    return { ok: false, reason: 'no alert channel: set OPS_SLACK_WEBHOOK_URL (recommended), or OPS_CALLMEBOT_PHONE + OPS_CALLMEBOT_API_KEY' };
  }
  return { ok: true, channels };
}

/** How a channel is named in logs and responses — never the URL or a key. */
export const channelLabel = (c: AlertChannel): string =>
  c.kind === 'slack' ? 'slack (OPS_SLACK_WEBHOOK_URL)'
    : c.kind === 'whatsapp-ops' ? 'whatsapp (OPS_CALLMEBOT_PHONE)'
    : 'whatsapp (tutor CALLMEBOT_PHONE fallback)';

export type SendResult = { ok: true } | { ok: false; error: string };

/** Posts to a Slack Incoming Webhook. Never throws, and never puts the URL
 *  (which IS the credential) into what it returns: Slack's answer is a short
 *  code like `invalid_token` or `channel_not_found`, kept; anything that
 *  might echo the URL is replaced. */
export async function sendSlack(text: string, webhookUrl: string, fetchImpl: typeof fetch = fetch): Promise<SendResult> {
  const scrub = (m: string) => m.split(webhookUrl).join('<webhook>').replace(/https:\/\/hooks\.slack\.com\/\S*/g, '<webhook>');
  try {
    const r = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      /* Slack reads <…> as links/mentions and & as an entity: escaped, so a
         problem text can never ping a channel or turn into a link. */
      body: JSON.stringify({ text: text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await r.text()).trim();
    if (!r.ok || body !== 'ok') return { ok: false, error: scrub(`Slack answered ${r.status} ${body.slice(0, 60)}`) };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: scrub(`Slack request failed: ${(err as Error)?.message ?? 'unknown'}`) };
  }
}


/** The real sender: Slack by webhook, WhatsApp by CallMeBot. */
export const sendAlert = (text: string, c: AlertChannel): Promise<SendResult> =>
  c.kind === 'slack' ? sendSlack(text, c.webhookUrl) : sendWhatsAppChecked(text, c.to);

/**
 * One check's daily run, minus HTTP: what its POST answers. `message` is
 * the ONE summary (null on a healthy day); `report` is spread into the body.
 *
 *  503  no channel (or a half/mis-configured one), every run, healthy or not
 *  200  healthy, nothing sent
 *  200  failures found, every configured channel got the one summary
 *  502  any configured channel could not be reached, even if another was
 */
export async function deliverAlert({ tag, ok, message, report, channels, send, log = console }: {
  /** Log prefix, e.g. `generation-health`. */
  tag: string;
  ok: boolean;
  message: string | null;
  report: object;
  channels: AlertChannels;
  send: (text: string, c: AlertChannel) => Promise<SendResult>;
  log?: Pick<Console, 'error' | 'warn'>;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!channels.ok) {
    log.error(`[${tag}] ALERT CHANNEL NOT CONFIGURED — ${channels.reason}. `
      + `Status is ${ok ? 'healthy' : 'FAILING'} and nobody can be told.`
      + (message ? ` Would have sent: ${message.replace(/\n/g, ' | ')}` : ''));
    return { status: 503, body: { error: 'alert channel not configured', reason: channels.reason, sent: [], ...report } };
  }
  const labels = channels.channels.map(channelLabel);
  if (channels.channels[0].kind === 'whatsapp-tutor') {
    log.warn(`[${tag}] no OPS_ channel set; alerts go to the tutor channel (CALLMEBOT_PHONE).`);
  }
  if (!message) return { status: 200, body: { sent: [], alertChannels: labels, ...report } };

  log.error(`[${tag}] ${message.replace(/\n/g, ' | ')}`);
  const sent: string[] = [];
  const sendFailures: { channel: string; error: string }[] = [];
  for (const c of channels.channels) {
    const r = await send(message, c);
    if (r.ok) sent.push(channelLabel(c));
    else sendFailures.push({ channel: channelLabel(c), error: r.error });
  }
  /* A dead channel found today is one that cannot fail silently on the day
     it is the only one left: any failure fails the run. */
  if (sendFailures.length) {
    for (const f of sendFailures) log.error(`[${tag}] COULD NOT SEND the alert via ${f.channel}: ${f.error}`);
    return { status: 502, body: { error: 'alert not sent', sendFailures, sent, alertChannels: labels, ...report } };
  }
  return { status: 200, body: { sent, alertChannels: labels, ...report } };
}
