/**
 * "Email me my link again" — the whole password-recovery story, replaced.
 *
 * What this replaces: a parent who lost their password had exactly one
 * option, a WhatsApp message to the tutor asking her to read it back to
 * them. That was a manual step in her week for every forgetful family, and
 * the code that opened it (`openForgotPassword`) was honest that no safe
 * self-service reset was possible under a name+password identity model.
 *
 * With the address on the account, recovery is self-service and safe by
 * construction: the link only ever goes to the address already stored, so
 * asking for it proves nothing and reveals nothing.
 *
 * ## Why the answer never changes
 *
 * The response is identical whether the address matched an account, matched
 * nothing, or matched an account whose mail bounced. Anything else turns
 * this endpoint into a membership oracle — type an address, learn whether
 * that family uses the tutor. For a service whose customers are named
 * children, that is not a hypothetical concern.
 *
 * ## The one thing that may be said out loud
 *
 * All of that is about facts that differ PER ADDRESS. The mailer being
 * down is not one: it is true for every address at once, so reporting it
 * tells an attacker nothing they could not learn by typing their own
 * address. It is checked before the lookup and before the throttle, so the
 * answer cannot depend on who exists.
 *
 * Without that, this endpoint answered ok:true through the whole of
 * 2026-09-20's mail outage — while the booking page was telling families
 * whose confirmation had just failed to come here for a new link.
 */
import { json } from '@sveltejs/kit';
import { findAccountByEmail, normalizeEmail } from '$server/entities.ts';
import { accountLink } from '$server/family-auth.ts';
import { sendPortalLinkEmail, mailCredentialsRejected } from '$server/email.ts';
import { readJson } from '$server/http.ts';
import { contactTutor } from '$lib/tutors.ts';
import type { RequestHandler } from './$types';

/**
 * One send per address per minute, in memory.
 *
 * In memory is the right scope, not a limitation to apologise for: this is
 * a single Node process by design (see README), so a shared store would add
 * a dependency to defend against a burst that a restart already clears.
 * What it stops is someone using a stranger's address as a mail bomb.
 */
const lastSent = new Map<string, number>();
const THROTTLE_MS = 60_000;

/** Bounded so a stream of unique addresses cannot grow this without limit.
 *  Evicting the oldest is safe: the worst case is one extra email. */
function throttled(email: string): boolean {
  const now = Date.now();
  const previous = lastSent.get(email);
  if (previous && now - previous < THROTTLE_MS) return true;

  if (lastSent.size > 500) {
    for (const [key, at] of lastSent) {
      if (now - at > THROTTLE_MS) lastSent.delete(key);
    }
    if (lastSent.size > 500) lastSent.clear();
  }
  lastSent.set(email, now);
  return false;
}

export const POST: RequestHandler = async ({ request }) => {
  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;

  const email = normalizeEmail((parsed as Record<string, unknown>)?.email);

  // The one thing worth answering differently, because it is about the
  // request rather than about who exists: a value that is not an address at
  // all can be corrected by the person typing it.
  if (!email || !email.includes('@')) {
    return json({ error: 'צריך כתובת מייל תקינה' }, { status: 400 });
  }

  /* The mailer being down is not a per-address fact. It is true for every
     address at once, so saying it reveals nothing about who is on file —
     which is why this may be answered honestly where a bounce may not.

     Checked BEFORE the lookup and before the throttle, so every address
     gets the identical answer and the oracle stays shut. Reporting this
     only for addresses we hold would let the failure itself answer the
     question ok:true exists to refuse.

     It matters because the booking page, when the confirmation email
     fails, tells the family to request a new link from the entry page —
     this endpoint. Answering ok:true while the mailer is dead promises a
     recovery that cannot happen, in the one case where they need it. */
  if (await mailCredentialsRejected()) {
    return json(
      { error: `שליחת המיילים אינה זמינה כרגע. נסו שוב מאוחר יותר, או פנו ל${contactTutor().name} בוואטסאפ.` },
      { status: 503 },
    );
  }

  const ok = json({ ok: true });

  if (throttled(email)) return ok;

  const account = findAccountByEmail(email);
  if (!account) return ok;

  try {
    await sendPortalLinkEmail(email, account.name, accountLink(account.id));
  } catch (err) {
    // Logged for the tutor, never surfaced: "we could not reach that
    // address" would confirm the address is on file.
    console.error('[request-link] send failed:', (err as Error).message);
  }

  return ok;
};
