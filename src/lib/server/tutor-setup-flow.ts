/**
 * The round trip a tutor makes: start (to Google) and finish (back from it).
 * Pure decisions over the database and an injected fetch, so every branch is
 * tested without a server or Google. The routes only apply the result: set
 * or delete the cookie, then redirect. See
 * docs/superpowers/specs/2026-10-16-tutor-meet-setup-design.md.
 */
import {
  teacherForCode, newNonce, mintStartedCookie, mintDoneCookie, readSetupCookie, completeSetup,
} from './tutor-setup.ts';
import { consentUrl, connectRoom, GoogleStepError, type WebClient } from './google-meet-setup.ts';

export const DONE_PATH = '/app/tutor-setup/done';

/** `cookie`: a value to set, or null for "delete it". */
export interface Step { location: string; cookie: string | null }

const page = (code: string): string => `/app/tutor-setup/${encodeURIComponent(code)}`;

/** A live code goes to Google; anything else back to its page, which says why. */
export function startSetup(code: string | null, client: WebClient | null, now = Date.now()): Step {
  const teacher = teacherForCode(code, now);
  if (!teacher || !client || !code) return { location: page(code ?? ''), cookie: null };
  const nonce = newNonce();
  return { location: consentUrl(client, nonce), cookie: mintStartedCookie(teacher.id, code, nonce, now) };
}

export interface CallbackInput {
  cookie: string | undefined; state: string | null; authCode: string | null; error: string | null;
}

export async function finishSetup(
  input: CallbackInput, client: WebClient | null, fetchImpl: typeof fetch = fetch, now = Date.now(),
): Promise<Step> {
  const c = readSetupCookie(input.cookie, now);
  // Already finished: a reloaded tab. Show success again; Google's code is spent.
  if (c?.kind === 'done') return { location: DONE_PATH, cookie: input.cookie ?? null };
  if (!c || !client || !input.state || input.state !== c.nonce) return { location: DONE_PATH, cookie: null };

  // The owner may have sent a newer link meanwhile; the old page then says expired.
  const teacher = teacherForCode(c.code, now);
  if (!teacher || teacher.id !== c.teacherId) return { location: page(c.code), cookie: null };

  if (input.error || !input.authCode) return { location: `${page(c.code)}?e=denied`, cookie: null };

  try {
    const room = await connectRoom(client, input.authCode, fetchImpl);
    completeSetup(teacher.id, room.meetUrl, room.account);
    return { location: DONE_PATH, cookie: mintDoneCookie(teacher.id, now) };
  } catch (err) {
    console.warn(`[tutor-setup] ${err instanceof GoogleStepError ? err.message : 'google unreachable'}`);
    const why = err instanceof GoogleStepError && err.step === 'scope' ? 'scope' : 'google';
    return { location: `${page(c.code)}?e=${why}`, cookie: null };
  }
}
