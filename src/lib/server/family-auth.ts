/**
 * Family access: magic links in, a signed session cookie afterwards.
 *
 * ## What this replaces
 *
 * A password the parent invented once during booking, which was never
 * echoed back, never sent to them, blocked from password managers by
 * `autocomplete="off"`, and then demanded by three later screens. Its only
 * recovery path was messaging the tutor. It was also globally unique across
 * all families, so a returning parent could be told their own password
 * belonged to someone else.
 *
 * Nothing here is memorized. Identity travels in a link the product sends
 * to an address the family already controls.
 *
 * ## The two token kinds
 *
 * `account` reaches the whole account — every student under it, plus the
 * parent view. It is minted for the address on the account and nowhere
 * else.
 *
 * `student` reaches exactly one student's own board. A parent mints one
 * from their portal and forwards it to their child, whose device then
 * holds it. A child with a student token can never see the parent view or
 * a sibling's board, which is the entire reason the two kinds exist rather
 * than one shared secret — the split the PRD left open as "הפין משותף
 * להורה+תלמיד — זה מכוון או שצריך הפרדה?".
 *
 * ## How long links and sessions last
 *
 * A link expires after a year, and the session cookie it establishes lasts
 * six months — see LINK_TTL_MS below for why a year and not the fortnight
 * this started with. Since booking collects an email, replacing an expired
 * link is self-service (`/portal` mails a fresh one); the old model could
 * not expire anything, because expiry meant messaging the tutor.
 */

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';

// process.env rather than `$env/dynamic/private`, matching auth.ts and
// urls.ts: that import is a Vite virtual module and would make this file
// unimportable by `node --test`, which is how its unit tests load it.
//
// The random fallback follows the same precedent. Signing with '' would
// let anyone mint a token for any account — an HMAC keyed with the empty
// string needs no secret knowledge to forge — so an unset secret becomes a
// random one, and the only cost is that links and sessions stop verifying
// across a restart.
const SECRET = process.env.SESSION_SECRET || randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('SESSION_SECRET is not set — family links and sessions drop on restart.');
}

export const FAMILY_COOKIE = 'maab_family';

/* A year, not a fortnight.
 *
 * The link lives in a WhatsApp thread or an inbox, and a tutoring
 * relationship runs a school year — so a fortnight's expiry went stale while
 * the family was still a customer, and turned a one-time email into a
 * recurring errand. Expiring sooner than the six-month SESSION it creates
 * mostly manufactured the problem it was meant to prevent.
 *
 * What the expiry still buys: a link forwarded to the wrong person, or left
 * on a sold phone, does not work forever. /portal mails a fresh one without
 * anyone's help. */
const LINK_TTL_MS    = 365 * 24 * 60 * 60 * 1000;  // 1 year
const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;  // 6 months

export type FamilyKind = 'account' | 'student';
export interface FamilyIdentity {
  kind: FamilyKind;
  id: number;
}

// One character on the wire, so the payload stays short enough to read in a
// URL without wrapping in an email client.
const KIND_CODE: Record<FamilyKind, string> = { account: 'a', student: 's' };
const KIND_OF: Record<string, FamilyKind> = { a: 'account', s: 'student' };

const sign = (payload: string): string =>
  createHmac('sha256', SECRET).update(payload).digest('base64url');

function mint(kind: FamilyKind, id: number, ttlMs: number): string {
  const payload = `${KIND_CODE[kind]}.${id}.${Date.now() + ttlMs}`;
  return `${payload}.${sign(payload)}`;
}

/**
 * Returns the identity a token carries, or null for anything that is not a
 * currently-valid token this server minted.
 *
 * Signature first, expiry second, and both before the id is trusted: an
 * expiry check on an unverified payload reads an attacker-supplied number.
 */
export function verifyFamilyToken(token: string | null | undefined): FamilyIdentity | null {
  if (typeof token !== 'string') return null;

  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;

  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(sign(payload));
  // Length check first — timingSafeEqual throws on mismatched lengths
  // rather than returning false.
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;

  const [kindCode, rawId, rawExp] = payload.split('.');
  const kind = KIND_OF[kindCode];
  const id = Number(rawId);
  const exp = Number(rawExp);
  if (!kind || !Number.isInteger(id) || id <= 0 || !Number.isFinite(exp)) return null;
  if (exp <= Date.now()) return null;

  return { kind, id };
}

/* ── Booking confirmation ─────────────────────────────────────────────
   A different kind of token on purpose: `p` is not in KIND_OF, so
   verifyFamilyToken refuses it and it can never become a session; and a
   family token lacks the `p`, so it is never a confirmation. See
   pending-bookings.ts. */

export function mintPendingToken(pendingId: number, expiresMs: number): string {
  const payload = `p.${pendingId}.${expiresMs}`;
  return `${payload}.${sign(payload)}`;
}

/** The held booking a confirmation token names, or null. */
export function verifyPendingToken(token: string | null | undefined): number | null {
  if (typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(sign(payload));
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  const [kind, rawId, rawExp] = payload.split('.');
  const id = Number(rawId);
  const exp = Number(rawExp);
  if (kind !== 'p' || !Number.isInteger(id) || id <= 0 || !Number.isFinite(exp)) return null;
  if (exp <= Date.now()) return null;
  return id;
}

export const mintAccountLinkToken = (accountId: number): string =>
  mint('account', accountId, LINK_TTL_MS);

export const mintStudentLinkToken = (studentId: number): string =>
  mint('student', studentId, LINK_TTL_MS);

/**
 * The absolute URL that goes in an email or a forwarded WhatsApp message.
 *
 * SITE_URL is required rather than defaulted: boot-checks.ts refuses to
 * start production without it, and the fallback this replaced once leaked
 * the raw server IP into parents' inboxes (see email.ts). Under `vite dev`
 * the checks are skipped, so warn rather than mint `undefined/enter?...`.
 */
export function enterLink(token: string): string {
  const site = process.env.SITE_URL;
  if (!site) {
    console.warn('[family-auth] SITE_URL not set — family links will be relative only.');
    return `/enter?t=${token}`;
  }
  return `${site.replace(/\/+$/, '')}/enter?t=${token}`;
}

export const accountLink = (accountId: number): string =>
  enterLink(mintAccountLinkToken(accountId));

export const studentLink = (studentId: number): string =>
  enterLink(mintStudentLinkToken(studentId));

/* ── The session cookie ──────────────────────────────────────────────── */

/**
 * `sameSite: 'lax'` is load-bearing rather than a default: the cookie is
 * set during a top-level navigation the user arrives at from their mail
 * client or WhatsApp, and 'strict' would withhold it on exactly that
 * first cross-site hop — the family would land logged out on the very
 * link that was supposed to let them in.
 */
export function setFamilySession(cookies: Cookies, identity: FamilyIdentity): void {
  cookies.set(FAMILY_COOKIE, mint(identity.kind, identity.id, SESSION_TTL_MS), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearFamilySession(cookies: Cookies): void {
  cookies.delete(FAMILY_COOKIE, { path: '/' });
}

export function readFamilySession(cookies: Cookies): FamilyIdentity | null {
  return verifyFamilyToken(cookies.get(FAMILY_COOKIE) ?? null);
}
