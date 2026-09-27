// tests/characterization/dashboard-card.test.mjs
//
// Guards the dashboard-server-card migration: the tutor dashboard's student
// card used to read and write goals/style/notes/progress through
// localStorage (`tutor_dashboard_v2`), so the same student showed different
// information on different devices. The card now renders those fields from
// `pageData.roster` (the real SQLite-backed roster), and edits round-trip
// through PATCH /api/students/:code.
//
// These tests fetch the raw server-rendered HTML with plain `fetch` — there
// is no browser and therefore no localStorage in play at all. If the page
// ever regresses to sourcing the card from `tutor_dashboard_v2` again, the
// student created here would render with blank/default fields (a brand new
// browser's localStorage has nothing for this student's code), and these
// assertions would fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login } from './harness.mjs';

// SvelteKit always serializes the full page-load payload into a trailing
// hydration <script> for the client to pick up — that JSON blob carries
// `pageData.roster` verbatim regardless of whether the component actually
// renders any of it. Matching against the whole document would let these
// tests pass even if the card ignored the roster entirely, since the
// values would still show up in that data island. Stripping it keeps the
// assertions honest: only the genuine server-rendered markup is checked.
function renderedMarkup(html) {
  return html.split(/<script nonce=/)[0];
}

test('the dashboard serves a new student\'s server-side profile values in its HTML', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const headers = { 'Content-Type': 'application/json', Cookie: cookie };

    const created = await fetch(`${baseUrl}/api/students`, {
      method: 'POST', headers,
      body: JSON.stringify({
        code: 'card-guard-1', name: 'תלמיד-שמירה', subject: 'מתמטיקה',
        level: 'כיתה ח', phone: '0501112222', email: 'card-guard-1@example.com',
      }),
    });
    assert.equal(created.status, 200);

    const html = renderedMarkup(await fetch(`${baseUrl}/app/dashboard`, { headers: { Cookie: cookie } })
      .then(r => r.text()));

    // name, subjects and the account's phone/name all come from the
    // roster row seeded by +page.server.ts — never from a browser store
    // that this plain-fetch client has no access to at all.
    assert.match(html, /תלמיד-שמירה/, 'the student name must be server-rendered');
    assert.match(html, /מתמטיקה/, 'the enrolled subject must be server-rendered');
    assert.match(html, /0501112222/, 'the account phone must be server-rendered');
  } finally { await stop(); }
});

test('PATCH round-trip: a profile field edit is served back on the next page load', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const headers = { 'Content-Type': 'application/json', Cookie: cookie };

    const created = await fetch(`${baseUrl}/api/students`, {
      method: 'POST', headers,
      body: JSON.stringify({ code: 'card-guard-2', name: 'תלמידה-שנייה', email: 'card-guard-2@example.com' }),
    });
    assert.equal(created.status, 200);

    // Before the PATCH, none of the new values exist anywhere.
    const before = renderedMarkup(await fetch(`${baseUrl}/app/dashboard`, { headers: { Cookie: cookie } }).then(r => r.text()));
    assert.doesNotMatch(before, /MARKER-GOAL-77/);

    const patch = await fetch(`${baseUrl}/api/students/card-guard-2`, {
      method: 'PATCH', headers,
      body: JSON.stringify({
        goals: 'MARKER-GOAL-77', style: 'שמיעתי', notes: 'MARKER-NOTE-88',
        progress: 42, progressNote: 'MARKER-PROGRESS-99',
      }),
    });
    assert.equal(patch.status, 200);
    const { student } = await patch.json();
    assert.equal(student.goals, 'MARKER-GOAL-77');
    assert.equal(student.progress, 42);

    const after = renderedMarkup(await fetch(`${baseUrl}/app/dashboard`, { headers: { Cookie: cookie } }).then(r => r.text()));
    assert.match(after, /MARKER-GOAL-77/, 'goals must be served back after the PATCH');
    assert.match(after, /MARKER-NOTE-88/, 'notes must be served back after the PATCH');
    assert.match(after, /MARKER-PROGRESS-99/, 'progress note must be served back after the PATCH');
    /* The hand-typed percentage is no longer offered (pre-launch review,
       2026-09-28): families see computed progress, so the number reached
       nobody. The column still round-trips through the API above. */
    assert.doesNotMatch(after, /id="prog-/, 'no progress-percentage input on the card');
  } finally { await stop(); }
});
