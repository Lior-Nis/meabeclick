import type { Handle } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { checkEnv, checkDataDir, checkPortalDir, checkRegistry, checkLessonEngine, checkPlanTemplates } from '$server/boot-checks.ts';

// Boot checks apply in production only. `npm run dev` must stay usable for
// a developer without a full .env — every module these checks cover
// (auth.ts, urls.ts, content.ts) already degrades gracefully on its own
// (a warned, random session secret; DATA_DIR falling back to ./data), which
// is exactly the dev-friendly behavior this guard preserves. This is a
// deliberate, visible choice (not a silent skip): `dev` is SvelteKit's own
// build-time flag — false for both `npm run build`'s output and the
// characterization harness's `TARGET=sveltekit` runs, so the checks still
// fire for anything that matters.
//
// checkEnv() runs here, BEFORE auth.ts is imported below, on purpose.
// auth.ts warns unconditionally at module load ("ADMIN_PASSWORD is not
// set...", "SESSION_SECRET is not set...") the moment it's imported. If
// auth.ts were a static import at the top of this file (as it originally
// was), those two lines — plus a third from urls.ts, pulled in transitively
// by boot-checks.ts's DATA_DIR check — would all print immediately before
// checkEnv() throws over the SAME missing variable: three contradictory
// lines about one problem. ES modules fully evaluate every static import
// (side effects included) before the importing module's own body runs, in
// the order the imports are written, so no amount of reordering import
// STATEMENTS fixes this — only deferring the import itself does. Hence the
// dynamic `await import(...)` below, and boot-checks.ts's own DATA_DIR
// check dynamically importing content.ts for the same reason (see its
// header comment).
if (!dev) checkEnv();

const { validToken, COOKIE_NAME } = await import('$server/auth.ts');

// Imported dynamically for the same reason as auth.ts above: it warns at
// module load when SESSION_SECRET is missing, and that warning must not
// print before checkEnv() has had its chance to throw over the same
// variable.
const { readFamilySession } = await import('$server/family-auth.ts');

if (!dev) {
  await checkDataDir();
  checkPortalDir();
  checkRegistry();
  checkLessonEngine();
  checkPlanTemplates();

  // Force db.ts to initialise at boot, so a failed migration crashes the
  // process here instead of letting it bind the port and 500 every
  // database-backed route for the rest of its life.
  await import('$server/db.ts');
}

const { PERMISSIONS_POLICY } = await import('$server/document-policy.ts');

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.authenticated = validToken(event.cookies.get(COOKIE_NAME) ?? null);
  event.locals.family = readFamilySession(event.cookies);
  const response = await resolve(event);
  // Every response, pages and API alike. The Content-Security-Policy is
  // NOT set here: SvelteKit adds it per page with the hydration script's
  // nonce (svelte.config.js), and the two document endpoints set their own.
  response.headers.set('Permissions-Policy', PERMISSIONS_POLICY);
  return response;
};
