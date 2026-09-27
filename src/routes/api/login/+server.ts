/**
 * Tutor dashboard login. Direct port of server/auth.mjs's `mountAuth`
 * POST /api/login handler.
 *
 * Cookie details are not in $server/auth.ts (see its checkPassword/makeToken
 * exports) — they live here, matching server/auth.mjs's inline `res.cookie`
 * call exactly: httpOnly, sameSite 'lax', secure only over https, 30 days,
 * path '/'. SvelteKit's `cookies.set` requires an explicit path.
 */
import { json } from '@sveltejs/kit';
import { checkPassword, makeToken, COOKIE_NAME } from '$server/auth.ts';
import { readJson } from '$server/http.ts';
import type { RequestHandler } from './$types';

// 30 days. SvelteKit's cookies.set maxAge is in SECONDS, unlike server/
// auth.mjs's millisecond MAX_AGE (which only sizes the token's own payload
// expiry, not the cookie header).
const MAX_AGE_SEC = 30 * 24 * 60 * 60;

export const POST: RequestHandler = async ({ request, cookies, url }) => {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const given = String((body as Record<string, unknown>)?.password ?? '');

  if (!checkPassword(given)) {
    return json({ error: 'סיסמה שגויה' }, { status: 401 });
  }

  // `secure` follows event.url's protocol, which SvelteKit derives from the
  // request URL — NOT from a header adapter-node parses for you. Express's
  // req.secure honors x-forwarded-proto because server/app.mjs sets
  // `app.set('trust proxy', 1)`. The equivalent under adapter-node is the
  // PROTOCOL_HEADER env var — it must be set to `x-forwarded-proto` for this
  // to see the real scheme behind Caddy. Left unset, adapter-node's
  // get_origin() does NOT fall back to inspecting headers; it hardcodes
  // 'https' unconditionally, so this line currently reads as "secure" only
  // because that hardcoded default happens to be correct while Caddy stays
  // HTTPS-only — not because the dependency here is actually wired up.
  // Enforcing PROTOCOL_HEADER is carried into the boot-check and compose
  // tasks; don't assume this is self-verifying without them.
  cookies.set(COOKIE_NAME, makeToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: url.protocol === 'https:',
    maxAge: MAX_AGE_SEC,
    path: '/',
  });
  return json({ ok: true });
};
