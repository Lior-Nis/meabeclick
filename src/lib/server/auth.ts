/**
 * Server-side login for the tutor dashboard.
 *
 * Replaces `const PASSWORD = 'nikol2026'` sitting in readable page source.
 * The password never reaches the browser; the browser only ever holds an
 * HMAC-signed, httpOnly session cookie it cannot read or forge.
 *
 * No session store and no extra dependency: the cookie carries its own expiry
 * and signature. Rotating SESSION_SECRET invalidates every session at once.
 */

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { error, json, redirect, type RequestEvent } from '@sveltejs/kit';

export const COOKIE_NAME = 'maab_session';
const MAX_AGE  = 30 * 24 * 60 * 60 * 1000;   // 30 days
const PASSWORD = process.env.ADMIN_PASSWORD;
const SECRET   = process.env.SESSION_SECRET || randomBytes(32).toString('hex');

if (!PASSWORD) {
  console.warn('ADMIN_PASSWORD is not set — the dashboard will refuse every login.');
}
if (!process.env.SESSION_SECRET) {
  console.warn('SESSION_SECRET is not set — using a random one, so sessions drop on restart.');
}

const sign = (v: string): string => createHmac('sha256', SECRET).update(v).digest('base64url');

export function makeToken(): string {
  const payload = String(Date.now() + MAX_AGE);
  return `${payload}.${sign(payload)}`;
}

export function validToken(token: string | null): boolean {
  if (typeof token !== 'string') return false;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  const given   = Buffer.from(token.slice(dot + 1));
  const want    = Buffer.from(sign(payload));
  // Constant-time compare, and only after a length check — timingSafeEqual
  // throws on mismatched lengths.
  if (given.length !== want.length || !timingSafeEqual(given, want)) return false;
  return Number(payload) > Date.now();
}

/**
 * For PAGE routes (anything that renders HTML, e.g. /app/dashboard,
 * /drafts/...): throws a redirect to /login when unauthenticated. Throwing
 * is correct here because a page load has nowhere else to send control —
 * SvelteKit's page-rendering pipeline is what turns the thrown redirect
 * into a response.
 *
 * Do NOT use this for /api/ routes: SvelteKit's default JSON serialization
 * for a thrown `error(401, 'unauthorized')` is `{ message: 'unauthorized' }`,
 * not the `{ error: 'unauthorized' }` shape every API caller expects. Use
 * apiAuthDenied below instead.
 */
export function requireAuth(event: RequestEvent): void {
  if (event.locals.authenticated) return;
  if (event.url.pathname.startsWith('/api/')) error(401, 'unauthorized');
  // Carry where she was going: the report email links straight into a form,
  // and a lapsed session must not swallow that and land her on the dashboard.
  const next = event.url.pathname + event.url.search;
  redirect(302, `/login?next=${encodeURIComponent(next)}`);
}

/**
 * For /api/ routes: an endpoint handler returns a Response, it doesn't throw
 * one, so this returns the Express-shaped 401 directly (`{ error:
 * 'unauthorized' }`, matching server/auth.mjs's requireAuth) instead of null
 * when authenticated. Call at the top of every guarded API handler:
 *
 *   const denied = apiAuthDenied(event);
 *   if (denied) return denied;
 *
 * For PAGE routes use requireAuth above instead — it redirects to /login,
 * which this deliberately does not do.
 */
export function apiAuthDenied(event: RequestEvent): Response | null {
  if (event.locals.authenticated) return null;
  return json({ error: 'unauthorized' }, { status: 401 });
}

/**
 * Checks a submitted password against ADMIN_PASSWORD in constant time
 * against a padded buffer so response timing does not leak the password's
 * length.
 */
export function checkPassword(given: string): boolean {
  const a = Buffer.alloc(64); a.write(given);
  const b = Buffer.alloc(64); b.write(PASSWORD ?? '\0no-password-set');
  return !!PASSWORD && timingSafeEqual(a, b);
}
