/**
 * The Google calls that make a tutor's Meet room, as the tutor.
 *
 * On a free Google account only a meeting's creator can admit someone who
 * knocks, so the room must belong to the tutor, not to the site. The tutor
 * consents once. The permission is used for one room and then revoked: no
 * refresh token exists to expire, be revoked by a password change, or
 * leak later. See docs/superpowers/specs/2026-10-16-tutor-meet-setup-design.md.
 *
 * Errors carry the step and the HTTP status, never Google's body. It can
 * echo request details, as drive/api.ts notes.
 */
import { meetUrl } from '../lesson-mode.ts';

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const REVOKE = 'https://oauth2.googleapis.com/revoke';
const SPACES = 'https://meet.googleapis.com/v2/spaces';

/** The account's email (to show which account owns the room), and rooms
 *  this app creates — nothing else of the tutor's. */
const MEET_SCOPE = 'https://www.googleapis.com/auth/meetings.space.created';
export const SCOPES = `openid email ${MEET_SCOPE}`;
export const CALLBACK_PATH = '/app/tutor-setup/callback';

export interface WebClient { clientId: string; clientSecret: string; redirectUri: string }

/** Null while the web client is not configured: the feature is off. */
export function webClientFromEnv(env: Record<string, string | undefined> = process.env): WebClient | null {
  const clientId = env.GOOGLE_WEB_CLIENT_ID;
  const clientSecret = env.GOOGLE_WEB_CLIENT_SECRET;
  const site = env.SITE_URL;
  if (!clientId || !clientSecret || !site) return null;
  return { clientId, clientSecret, redirectUri: `${site.replace(/\/+$/, '')}${CALLBACK_PATH}` };
}

/** `online`: no refresh token. `select_account`: the tutor picks the
 *  account on purpose, since that account becomes the room's host. */
export function consentUrl(client: WebClient, state: string): string {
  return `${AUTH}?${new URLSearchParams({
    client_id: client.clientId, redirect_uri: client.redirectUri, response_type: 'code',
    scope: SCOPES, access_type: 'online', prompt: 'select_account consent', state,
  })}`;
}

/* Plain fields, not constructor parameter properties: node --test loads
   this file by stripping types, and strip-only mode refuses those. */
/** 'scope': the tutor left Google's Meet checkbox unticked, so the token
 *  cannot make a room. Its own step, because the tutor's fix differs. */
export type GoogleStep = 'token' | 'scope' | 'room';
export class GoogleStepError extends Error {
  readonly step: GoogleStep;
  readonly status: number;
  constructor(step: GoogleStep, status: number) {
    super(`google ${step} failed: ${status}`);
    this.step = step;
    this.status = status;
  }
}

/** The id_token came straight from Google's token endpoint over TLS, so
 *  its payload is read without checking the signature (Google's guidance
 *  for exactly this case). */
export function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== 'string') return null;
  try {
    const claims = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8'));
    return typeof claims?.email === 'string' && claims.email ? claims.email : null;
  } catch {
    return null;
  }
}

export async function connectRoom(
  client: WebClient, authCode: string, fetchImpl: typeof fetch = fetch,
): Promise<{ meetUrl: string; account: string | null }> {
  const t = await fetchImpl(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: authCode, client_id: client.clientId, client_secret: client.clientSecret,
      redirect_uri: client.redirectUri, grant_type: 'authorization_code',
    }),
  });
  if (!t.ok) throw new GoogleStepError('token', t.status);
  const tok = await t.json() as { access_token?: string; id_token?: string; scope?: string };
  if (!tok.access_token) throw new GoogleStepError('token', t.status);

  try {
    // Google's consent screen may list each permission with its own
    // checkbox; a token without the Meet one would only fail at the room.
    if (typeof tok.scope === 'string' && !tok.scope.split(' ').includes(MEET_SCOPE)) {
      throw new GoogleStepError('scope', t.status);
    }
    const r = await fetchImpl(SPACES, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' },
      // Google's default access, not a chosen one: a personal account may not
      // set accessType (403 "updateAccessType is not available to the user",
      // measured 2026-10-16), and its default came back TRUSTED — everyone
      // not invited knocks, and these rooms invite no one.
      body: '{}',
    });
    if (!r.ok) throw new GoogleStepError('room', r.status);
    const space = await r.json() as { meetingUri?: string; config?: { accessType?: string } };
    const url = meetUrl(space.meetingUri);
    if (!url || new URL(url).hostname !== 'meet.google.com') throw new GoogleStepError('room', r.status);
    // The link never changes, so a family that keeps it must not walk into
    // another child's lesson. A tutor whose Meet default is "open" gets no room.
    if (space.config?.accessType === 'OPEN') throw new GoogleStepError('room', r.status);
    return { meetUrl: url, account: emailFromIdToken(tok.id_token) };
  } finally {
    await revoke(tok.access_token, fetchImpl);
  }
}

/** Best effort: the token dies within the hour anyway. */
async function revoke(token: string, fetchImpl: typeof fetch): Promise<void> {
  try {
    const r = await fetchImpl(REVOKE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
    if (!r.ok) console.warn(`[tutor-setup] revoke failed: ${r.status}`);
  } catch {
    console.warn('[tutor-setup] revoke failed: network');
  }
}
