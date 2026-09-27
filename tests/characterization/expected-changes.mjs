// tests/characterization/expected-changes.mjs
/**
 * Deliberate behavior changes introduced by the SvelteKit migration.
 *
 * Through Task 23 the characterization suite was a DIFF DETECTOR, not a
 * parity gate: it could run against either server/app.mjs (Express) or
 * build/index.js (SvelteKit) via a TARGET env var, and a test that failed
 * was either a regression or an entry in this list. Task 24 deleted
 * server/app.mjs and the rest of the pre-migration app once SvelteKit was
 * verified and cut over — see tests/characterization/harness.mjs's header
 * comment — so there is no second system left to diff against, and no
 * TARGET branching left in the test files that used to reference this
 * list (auth.test.mjs, portal.test.mjs, students.test.mjs).
 *
 * This file is kept anyway, as a historical record: it is the definitive
 * account of exactly what behavior changed in the migration and why, for
 * anyone later wondering why e.g. /login.html 404s or an old game link
 * stopped working. The individual test assertions it used to parameterize
 * now just assert the SvelteKit-only behavior directly, with an inline
 * comment pointing back to the relevant entry below.
 *
 * See docs/superpowers/specs/2026-08-27-sveltekit-migration-design.md §9.
 *
 * The entries at the top of the list below post-date the migration: they
 * record the family-access rebuild (magic links replacing the family
 * password, and the onboarding flow moving onto the entity model). Same
 * purpose — the definitive account of what changed on purpose.
 */
export const EXPECTED_CHANGES = [
  {
    id: 'no-family-passwords',
    route: 'POST /api/book, GET /api/portal/:code, /portal, /app/parent, /app/student',
    was: 'a family password chosen once during booking, globally unique across all students, never echoed back or emailed to the family, blocked from password managers by autocomplete="off", and required by three later screens; the only recovery was messaging the tutor',
    now: 'no family password exists. A magic link (14 days) establishes a family session cookie (6 months); a fresh link is self-service from /portal',
    why: 'the password was pure cost with no payoff — global uniqueness told returning parents their own password belonged to someone else, and the "have you booked before?" toggle defaulted to "no", silently forking a returning family into a second student record',
  },
  {
    id: 'booking-requires-email',
    route: 'POST /api/book',
    was: 'name, subject, phone, level, start, end — no email collected anywhere',
    now: 'an email is required, and 400 {error} is returned without one',
    why: 'the portal link and password went only to BOOKING_EMAIL_TO (the tutor). The family received nothing, so the portal the landing page sells was unreachable by design. Email is the only channel that can reach a customer — CallMeBot delivers to one pre-registered number, the tutor\'s',
  },
  {
    id: 'booking-returns-handoff',
    route: 'POST /api/book',
    was: '{ok|fallback, emailed}',
    now: 'also { portal: { link, code, studentName, isNewFamily }, familyEmailed }',
    why: 'the success screen hands over the link on the spot, so a family is in even when mail is slow, filtered, or typo\'d',
  },
  {
    id: 'email-identifies-the-family',
    route: 'POST /api/book',
    was: 'identity was (name + password), with an explicit isReturning flag from the form; a same-phone booking once merged into the wrong student',
    now: 'identity is the account email (normalized), matched automatically; a new name under a known email is a sibling on the same account',
    why: 'there is no toggle to get wrong and no secret to collide. Matching an email proves nothing on its own — reaching the account still needs the link sent to that address',
  },
  {
    id: 'family-session-portal',
    route: 'GET /api/portal/:code, POST /api/ask',
    was: 'authenticated by ?pin= in the query string, one shared pin for both the parent and student views',
    now: 'authenticated by the family session cookie, with the parent and student views genuinely separated; denial body is {error: "אין גישה לדף הזה"}',
    why: 'a pin in a URL lands in access logs, history and referrers, and /portal rendered it with type="text". One secret could not express "a child may see their own board but not the balance or a sibling\'s" — the separation the PRD left open',
  },
  {
    id: 'roster-requires-tutor',
    route: 'GET /api/portal-students',
    was: 'unauthenticated, returning {code, name, subject} for EVERY enrolled student — rendered to anonymous visitors by /app/parent as a chooser',
    now: 'requires the tutor session and returns {code, name}',
    why: 'it published every enrolled child\'s name with the code addressing their page. A parent\'s own children now come from their session, so the chooser was deleted rather than guarded',
  },
  {
    id: 'students-on-entity-model',
    route: 'GET|POST /api/students, DELETE /api/students/:code',
    was: 'wrote the legacy name-keyed students table, with student_pin/parent_pin/password columns',
    now: 'creates accounts + students_v2 + enrollments, and POST /api/students/:code/link replaces POST /api/students/:code/regenerate',
    why: 'booking writes the entity model, so a hand-added student on the legacy table would have had a row the portal could never resolve',
  },
  {
    id: 'todoist-6hJh33RvfVc8r84H',
    route: 'startup',
    was: "SITE_URL unset falls back to 'http://76.13.59.4:8080', leaking the server IP into parent emails",
    now: 'the app refuses to boot without SITE_URL',
    why: 'p2 bug — a raw IP in a parent inbox; missing config should fail loudly at boot',
  },
  {
    id: 'todoist-6hJh32VVc5VH2jVq',
    route: 'POST /api/game-result',
    was: 'accepts any anonymous body, so results can be forged',
    now: 'requires a valid &t=<hmac> signature over {dataId, student}; unsigned posts are rejected',
    why: 'p2 bug — cheap to fix once URL construction is centralized in urls.ts',
  },
  {
    id: 'todoist-6hJh337GrfGQj5Hq',
    route: 'games/speed-drill',
    was: "personal best kept in localStorage, wiped by WhatsApp's in-app WebView between opens",
    now: 'personal best read from the results table via getBest(student, dataId)',
    why: 'p3 bug — the data was already server-side; localStorage never survived the delivery channel',
  },
  {
    id: 'page-urls',
    route: 'all pages',
    was: '/booking.html, /login.html, /portal.html',
    now: '/booking, /login, /portal',
    why: 'SvelteKit routing; no live users depend on the old URLs',
  },
  {
    id: 'game-urls',
    route: 'games',
    was: '/games/<template>.html?d=&s=',
    now: '/app/play/<template>?d=&s=&t=',
    why: 'spec §6 — puts the homework loop inside a future PWA scope',
  },
  {
    id: 'json-error-body',
    route: 'all POST /api/*',
    was: "express.json() HTML error page",
    now: "400 {error:'invalid JSON'}",
    why: "an HTML stack-bearing error page from a JSON API leaks filesystem paths; status preserved",
  },
  {
    id: 'nameless-portal-file',
    route: 'GET /api/portal/:code',
    was: 'a portal file missing `name` is served as-is (200) — game/homework entries were always baked at write time, so nothing there could fail',
    now: 'a portal file missing `name` answers 500 {error: "קובץ הדף פגום"}, the same as unparseable JSON',
    why: 'ruling P13 — a portal file with no `name` has nothing to render as the child\'s display name, so the route rejects it outright rather than serving a 200 with a broken or blank display; as of the results-identity plan\'s task 5, game/homework links are signed over `code` rather than `name`, so this is purely the file\'s display/shape contract, not a signing failure',
  },
  {
    id: 'dropped-cors-options',
    route: 'POST /api/ask, POST /api/book, GET /api/availability, GET /api/remind',
    was: 'each Vercel handler set its own Access-Control-Allow-* headers; api/ask.js and api/book.js answered OPTIONS with 200 and a wrong method with {error: "Method not allowed"} (405); api/availability.js answered OPTIONS with 200 but had no 405 branch for a wrong method; api/remind.js had no OPTIONS handling and no method check at all',
    now: 'no CORS headers, and a wrong method gets SvelteKit\'s built-in 405 instead of the {error:...} body',
    why: 'these four were standalone Vercel functions that could be called cross-origin; under SvelteKit they are same-origin routes, so CORS is moot',
  },
];
