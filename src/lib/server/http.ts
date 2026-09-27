/**
 * Shared POST-body parsing for /api/ routes.
 *
 * `await request.json()` throws a SyntaxError on a missing or malformed
 * body, and no route here catches it — SvelteKit turns that into its
 * generic, unhandled 500. Express's `express.json()` middleware (server/
 * app.mjs) answers 400 for the identical input, on every POST route, before
 * the handler ever runs. That is a parity break on EVERY ported POST route,
 * not just one, so it is fixed once, here, rather than as N independent
 * try/catches (this migration has already hit the "N copies instead of one
 * definition" failure four separate times). Ruling P17.
 *
 * body-parser (what express.json() wraps) treats a zero-length body as `{}`
 * rather than a parse error — server/app.mjs's POST /api/login with an
 * empty body reaches the "wrong password" 401 branch, not a 400. This
 * mirrors that so the same request takes the same branch under both
 * targets, rather than turning an empty body into a new 400 SvelteKit
 * never used to give.
 *
 * A route handler returns a Response, it does not throw one, so this is not
 * a throwing helper — callers check the return value:
 *
 *   const body = await readJson(request);
 *   if (body instanceof Response) return body;
 *
 * The 400 body shape below is not a literal copy of express.json()'s actual
 * failure response (a bare-Express app with no error-handling middleware —
 * which server/app.mjs does not add — answers with an HTML stack trace,
 * including this repo's absolute filesystem paths; asserting on that
 * byte-for-byte would be both meaningless to test and actively bad to ship
 * from a public-facing route). What matters for parity is the status code
 * (400, not 500) and this app's existing error convention of a JSON
 * `{ error: string }` body, which every other handler in this codebase
 * already uses.
 */
import { json } from '@sveltejs/kit';

export async function readJson(request: Request): Promise<unknown> {
  // express.json() only parses when Content-Type is (essentially)
  // application/json — anything else and the body-parser middleware skips
  // parsing entirely, leaving req.body unset, which every ported handler's
  // `body?.field` reads exactly like `{}` would. A request whose body
  // happens to look like malformed JSON but is declared as some other
  // type (e.g. a stray form POST) must not 400 here, since it never would
  // have under Express either.
  const contentType = request.headers.get('content-type') ?? '';
  if (!/^application\/json\b/i.test(contentType.trim())) return {};

  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return json({ error: 'invalid JSON' }, { status: 400 });
  }
}
