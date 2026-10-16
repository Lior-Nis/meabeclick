/**
 * A tutor's setup link, and the cookie that carries them through Google.
 *
 * The link: 32 random bytes the owner sends on WhatsApp. Only their SHA-256
 * is stored, beside the teacher, with a 7-day expiry, so the database never
 * holds a working link. A newer link replaces the older one; finishing
 * clears it. See docs/superpowers/specs/2026-10-16-tutor-meet-setup-design.md.
 *
 * The cookie proves that the browser Google sends back is the one that
 * tapped the button. It is signed like the family tokens (family-auth.ts),
 * under its own prefix, so a signature made for one can never verify as
 * the other.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { handle } from './db.ts';
import type { TeacherRow } from './entities.ts';

// process.env, and a random fallback rather than '', for the reasons
// family-auth.ts gives: an HMAC keyed with '' needs no secret to forge.
const SECRET = process.env.SESSION_SECRET || randomBytes(32).toString('hex');

export const SETUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SETUP_COOKIE = 'maab_tutor_setup';
export const COOKIE_TTL_MS = 15 * 60 * 1000;
/** The done cookie only names the teacher, and a phone may restore the
 *  "מוכן ✓" tab hours later: it must still say success, not "not completed". */
export const DONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_RE = /^[A-Za-z0-9_-]{43}$/;

const hashCode = (code: string): string => createHash('sha256').update(code).digest('hex');

/** A fresh link for this teacher; any earlier one stops working. */
export function mintSetupCode(teacherId: number, now = Date.now()): string {
  const code = randomBytes(32).toString('base64url');
  handle().prepare(`UPDATE teachers SET setup_hash = ?, setup_expires = ? WHERE id = ?`)
    .run(hashCode(code), new Date(now + SETUP_TTL_MS).toISOString(), teacherId);
  return code;
}

/** The active teacher whose live link this is, or null. */
export function teacherForCode(code: unknown, now = Date.now()): TeacherRow | null {
  if (typeof code !== 'string' || !CODE_RE.test(code)) return null;
  const row = handle().prepare(`SELECT * FROM teachers WHERE setup_hash = ? AND active = 1`)
    .get(hashCode(code)) as TeacherRow | undefined;
  if (!row?.setup_expires || Date.parse(row.setup_expires) <= now) return null;
  return row;
}

/** The absolute link for WhatsApp, built like family-auth.ts enterLink. */
export function setupLink(code: string): string {
  const site = (process.env.SITE_URL ?? '').replace(/\/+$/, '');
  return `${site}/app/tutor-setup/${code}`;
}

/** The room is saved and the link used up, in one statement. */
export function completeSetup(teacherId: number, meetUrl: string, account: string | null): void {
  handle().prepare(`UPDATE teachers
    SET meet_url = ?, meet_account = ?, setup_hash = NULL, setup_expires = NULL WHERE id = ?`)
    .run(meetUrl, account, teacherId);
}

/* ── The setup cookie ─────────────────────────────────────────────── */

export type SetupCookie =
  | { kind: 'started'; teacherId: number; code: string; nonce: string }
  | { kind: 'done'; teacherId: number };

const sign = (payload: string): string =>
  createHmac('sha256', SECRET).update(`tutor-setup:${payload}`).digest('base64url');
const seal = (payload: string): string => `${payload}.${sign(payload)}`;

export const newNonce = (): string => randomBytes(16).toString('base64url');

/** Set when the tutor leaves for Google. It carries the code itself, so a
 *  failure can send them back to their own page with the button. */
export function mintStartedCookie(teacherId: number, code: string, nonce: string, now = Date.now()): string {
  return seal(`s.${teacherId}.${code}.${nonce}.${now + COOKIE_TTL_MS}`);
}

/** Replaces the started cookie once the room is saved. A reloaded tab then
 *  shows success instead of replaying Google's one-time code. */
export function mintDoneCookie(teacherId: number, now = Date.now()): string {
  return seal(`d.${teacherId}.-.-.${now + DONE_TTL_MS}`);
}

/** Signature first, expiry second, both before anything is trusted. */
export function readSetupCookie(value: string | null | undefined, now = Date.now()): SetupCookie | null {
  if (typeof value !== 'string') return null;
  const dot = value.lastIndexOf('.');
  if (dot < 1) return null;
  const payload = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const want = Buffer.from(sign(payload));
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  const [kind, rawId, code, nonce, rawExp] = payload.split('.');
  const teacherId = Number(rawId);
  const exp = Number(rawExp);
  if (!Number.isInteger(teacherId) || teacherId <= 0 || !Number.isFinite(exp) || exp <= now) return null;
  if (kind === 'd') return { kind: 'done', teacherId };
  if (kind === 's' && CODE_RE.test(code ?? '') && nonce) return { kind: 'started', teacherId, code, nonce };
  return null;
}

/** `secure` follows the request's scheme, as the login cookie's does
 *  (src/routes/api/login/+server.ts). Lax, because Google's redirect back
 *  is a cross-site top-level navigation and Strict would withhold it.
 *  Max-Age follows the value being set: a done cookie lives as long as it
 *  verifies, a started one for the 15 minutes of the trip to Google. */
export function setupCookieOptions(url: URL, value?: string) {
  return {
    path: '/app/tutor-setup', httpOnly: true as const, sameSite: 'lax' as const,
    secure: url.protocol === 'https:',
    maxAge: (value?.startsWith('d.') ? DONE_TTL_MS : COOKIE_TTL_MS) / 1000,
  };
}
