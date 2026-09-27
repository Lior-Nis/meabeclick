/**
 * Direct port of api/remind.js.
 *
 * GET /api/remind — driven by a systemd timer (server/meabeclick-remind.timer)
 * to send a WhatsApp reminder to Nikol via CallMeBot to update her calendar
 * before slots open at 20:00. Like /api/reports/prompt, it authenticates
 * with a shared secret rather than a session — a timer has no cookies, and
 * this route is reachable from the internet.
 *
 * Required env vars:
 *   CALLMEBOT_PHONE   — WhatsApp number with country code, no + (e.g. 972546969891)
 *   CALLMEBOT_API_KEY — obtained by messaging +34 644 59 78 46 "I allow callmebot to send me messages"
 *
 * With no CALLMEBOT_API_KEY the reminder goes by email instead, through
 * the same transport /api/reports/prompt uses. WhatsApp is still the
 * preference — a Saturday-evening message is read and an email may not be
 * — but a key that only Nicole's phone can obtain is not a reason for the
 * reminder never to arrive.
 */
import { json } from '@sveltejs/kit';
import { authorizedCronRequest } from '$server/cron-auth.ts';
import { sendCalendarReminderEmail } from '$server/email.ts';
import { TUTOR_PHONE } from '$lib/contact.ts';
import type { RequestHandler } from './$types';

const DEFAULT_PHONE = TUTOR_PHONE;
const MESSAGE = '🗓️ תזכורת: עדכני את לוח השנה שלך לשבוע הבא! בשעה 20:00 ייפתחו חלונות ההזמנה לשיעורים.';

export const GET: RequestHandler = async ({ request }) => {
  if (!authorizedCronRequest(request.headers.get('x-cron-key'))) {
    return json({ error: 'unauthorized' }, { status: 401 });
  }

  const phone = process.env.CALLMEBOT_PHONE || DEFAULT_PHONE;
  const apiKey = process.env.CALLMEBOT_API_KEY;

  /* No WhatsApp key: send the same reminder by email rather than not at
     all. The key can only be obtained by messaging CallMeBot from Nicole's
     own phone, and this box already mails her every hour through the same
     transport, so the fallback is the difference between a feature that
     works this Saturday and one that waits for the key.

     #70 made this path answer 503 instead of a 200 that `curl --fail`
     read as success, and the live journal proved it: the unit failed with
     curl (22) / 503 on Sat 2026-09-19, the first Saturday after deploy.
     Loud was right — the run had sent nothing — but loud is not sent. The
     503 now belongs to the case where NEITHER channel can carry it, which
     is the one #70 was actually about. */
  if (!apiKey) {
    console.warn('CALLMEBOT_API_KEY not set — falling back to email for the weekly reminder');
    let emailed = false;
    try {
      emailed = await sendCalendarReminderEmail(MESSAGE);
    } catch (err) {
      console.error('[remind] email fallback failed:', (err as Error).message);
    }
    if (emailed) return json({ ok: true, channel: 'email' });

    /* Neither channel can send — the case #70 was about. 503 so the
       timer's `curl --fail` cannot record success for a run that sent
       nothing, and the reason names both channels so the journal line
       does not read as a CallMeBot-only problem. */
    return json(
      {
        ok: false,
        reason: 'CALLMEBOT_API_KEY not configured and email unavailable (GMAIL_USER / GMAIL_APP_PASSWORD)',
      },
      { status: 503 },
    );
  }

  try {
    const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodeURIComponent(MESSAGE)}&apikey=${apiKey}`;
    const r = await fetch(url);
    const body = await r.text();

    if (!r.ok || body.includes('ERROR')) {
      console.error('CallMeBot error:', body);
      return json({ ok: false, error: body }, { status: 500 });
    }

    console.log('Reminder sent:', body);
    return json({ ok: true, channel: 'whatsapp' });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
};
