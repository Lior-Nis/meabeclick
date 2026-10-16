// tests/characterization/tutor-setup.test.mjs
//
// A tutor's setup link through the real server
// (docs/superpowers/specs/2026-10-16-tutor-meet-setup-design.md). Nothing
// here reaches Google: the success path is unit-tested with Google
// simulated (tutor-setup-flow.test.mjs), and proven once on production.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, login } from './harness.mjs';

const GOOGLE = { GOOGLE_WEB_CLIENT_ID: 'test-client.example', GOOGLE_WEB_CLIENT_SECRET: 'test-secret' };

async function mint(baseUrl, cookie, id = 1) {
  const r = await fetch(`${baseUrl}/api/teachers/${id}/setup-link`, { method: 'POST', headers: { cookie } });
  assert.equal(r.status, 200, await r.clone().text());
  return (await r.json()).link;
}
const html = async (url, init) => (await fetch(url, init)).text();
const codeOf = (link) => link.split('/').at(-1);

test('only a dashboard session mints a link; opening the link twice uses nothing up', async () => {
  const { baseUrl, stop } = await startServer({ env: GOOGLE });
  try {
    assert.equal((await fetch(`${baseUrl}/api/teachers/1/setup-link`, { method: 'POST' })).status, 401);
    const cookie = await login(baseUrl);
    assert.equal((await fetch(`${baseUrl}/api/teachers/999/setup-link`, { method: 'POST', headers: { cookie } })).status, 404);
    const link = await mint(baseUrl, cookie);
    assert.match(link, new RegExp(`^${baseUrl}/app/tutor-setup/[A-Za-z0-9_-]{43}$`));
    const first = await html(link);
    assert.match(first, /היי ניקול/);
    assert.match(first, new RegExp(`href="/api/tutor-setup/start\\?code=${codeOf(link)}"`));
    assert.match(await html(link), /התחברות עם Google/, 'the second open (after a link preview) still works');
  } finally { await stop(); }
});

test('a replaced, unknown or malformed code shows the expired page', async () => {
  const { baseUrl, stop } = await startServer({ env: GOOGLE });
  try {
    const cookie = await login(baseUrl);
    const older = await mint(baseUrl, cookie);
    const newer = await mint(baseUrl, cookie);
    assert.match(await html(older), /הקישור לא תקף/);
    assert.match(await html(newer), /התחברות עם Google/);
    assert.match(await html(`${baseUrl}/app/tutor-setup/garbage`), /הקישור לא תקף/);
  } finally { await stop(); }
});

test('start sends a live code to Google with the setup cookie, and anything else back', async () => {
  const { baseUrl, stop } = await startServer({ env: GOOGLE });
  try {
    const code = codeOf(await mint(baseUrl, await login(baseUrl)));
    const r = await fetch(`${baseUrl}/api/tutor-setup/start?code=${code}`, { redirect: 'manual' });
    assert.equal(r.status, 303);
    const to = new URL(r.headers.get('location'));
    assert.equal(to.origin + to.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(to.searchParams.get('client_id'), 'test-client.example');
    assert.equal(to.searchParams.get('redirect_uri'), `${baseUrl}/app/tutor-setup/callback`);
    assert.match(to.searchParams.get('scope'), /meetings\.space\.created/);
    assert.equal(to.searchParams.get('access_type'), 'online');
    const set = r.headers.getSetCookie().find((c) => c.startsWith('maab_tutor_setup='));
    assert.ok(set, 'no setup cookie');
    assert.match(set, /Path=\/app\/tutor-setup/);
    assert.match(set, /HttpOnly/i);
    assert.match(set, /SameSite=Lax/i);

    const bad = await fetch(`${baseUrl}/api/tutor-setup/start?code=nope`, { redirect: 'manual' });
    assert.equal(bad.status, 303);
    assert.equal(bad.headers.get('location'), '/app/tutor-setup/nope');
  } finally { await stop(); }
});

test('without the web client the page says so and start stays home', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const link = await mint(baseUrl, await login(baseUrl));
    const page = await html(link);
    assert.match(page, /עוד לא הוגדר/);
    assert.doesNotMatch(page, /התחברות עם Google/);
    const r = await fetch(`${baseUrl}/api/tutor-setup/start?code=${codeOf(link)}`, { redirect: 'manual' });
    assert.equal(r.headers.get('location'), `/app/tutor-setup/${codeOf(link)}`);
  } finally { await stop(); }
});

test('callback: denied keeps the link; a bad state or no cookie ends as not completed', async () => {
  const { baseUrl, dbPath, stop } = await startServer({ env: GOOGLE });
  try {
    const code = codeOf(await mint(baseUrl, await login(baseUrl)));
    const s = await fetch(`${baseUrl}/api/tutor-setup/start?code=${code}`, { redirect: 'manual' });
    const state = new URL(s.headers.get('location')).searchParams.get('state');
    const setup = s.headers.getSetCookie().find((c) => c.startsWith('maab_tutor_setup=')).split(';')[0];

    const denied = await fetch(`${baseUrl}/app/tutor-setup/callback?error=access_denied&state=${state}`,
      { redirect: 'manual', headers: { cookie: setup } });
    assert.equal(denied.status, 303);
    assert.equal(denied.headers.get('location'), `/app/tutor-setup/${code}?e=denied`);
    const back = await html(`${baseUrl}/app/tutor-setup/${code}?e=denied`);
    assert.match(back, /לא אישרתם/);
    assert.match(back, /התחברות עם Google/);
    assert.match(await html(`${baseUrl}/app/tutor-setup/${code}?e=scope`), /סמנו את התיבה של Google Meet/);

    const wrong = await fetch(`${baseUrl}/app/tutor-setup/callback?code=x&state=other`,
      { redirect: 'manual', headers: { cookie: setup } });
    assert.equal(wrong.headers.get('location'), '/app/tutor-setup/done');
    const none = await fetch(`${baseUrl}/app/tutor-setup/callback?code=x&state=${state}`, { redirect: 'manual' });
    assert.equal(none.headers.get('location'), '/app/tutor-setup/done');
    assert.match(await html(`${baseUrl}/app/tutor-setup/done`), /החיבור לא הושלם/);

    const db = new DatabaseSync(dbPath, { readOnly: true });
    assert.equal(db.prepare(`SELECT meet_url FROM teachers WHERE id = 1`).get().meet_url, null);
  } finally { await stop(); }
});

// Only the server-rendered markup counts, not the hydration data island
// (see dashboard-card.test.mjs).
const markup = (h) => h.split(/<script nonce=/)[0];

test('the dashboard lists the tutors with their room status and the link button', async () => {
  const { baseUrl, dbPath, stop } = await startServer({ env: GOOGLE });
  try {
    const cookie = await login(baseUrl);
    const db = new DatabaseSync(dbPath);
    db.prepare(`UPDATE teachers SET meet_url = 'https://meet.google.com/aaa-bbbb-ccc', meet_account = 'tutor@example.com' WHERE id = 1`).run();
    db.close();
    const page = markup(await html(`${baseUrl}/app/dashboard`, { headers: { cookie } }));
    assert.match(page, />מורים</);
    assert.match(page, /✓ חדר Meet/);
    assert.match(page, /tutor@example\.com/);
    assert.match(page, /✗ אין חדר Meet/, 'the second seeded tutor has no room');
    assert.match(page, /שליחת קישור הגדרה/);
  } finally { await stop(); }
});

test('without the web client the dashboard says so and offers no link', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const page = markup(await html(`${baseUrl}/app/dashboard`, { headers: { cookie: await login(baseUrl) } }));
    assert.match(page, /עוד לא הוגדר בשרת/);
    assert.doesNotMatch(page, /שליחת קישור הגדרה/);
  } finally { await stop(); }
});
