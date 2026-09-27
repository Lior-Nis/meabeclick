// tests/characterization/marketing-report.test.mjs
//
// GET /app/marketing — the tutor's "שיווק" report
// (docs/superpowers/specs/2026-09-24-marketing-funnel-design.md, "Surfaces").
// Guarded exactly like /app/dashboard (see auth.test.mjs), and reads
// marketing_events + bookings_v2 straight through src/lib/server/marketing.ts's
// funnel()/heardFromCounts() — nothing here goes through the booking flow,
// so every test seeds those two tables directly via the harness's dbPath,
// the same pattern events-endpoint.test.mjs and report-page.test.mjs use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login } from './harness.mjs';

async function withDb(dbPath, fn) {
  const { DatabaseSync } = await import('node:sqlite');
  // node:sqlite defaults enableForeignKeyConstraints to true (unlike
  // src/lib/server/db.ts's own PRAGMA, which is a per-connection setting
  // this test connection never inherits) — off here so a bookings_v2 row
  // can be seeded directly with a student_id that names no real
  // students_v2 row, without first creating a whole account/student chain
  // through the booking API just to get a valid foreign key.
  const db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: false });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/**
 * Seeds one full funnel: a landing visit, all three CTA clicks, a started
 * booking and a completed, non-cancelled lesson attributed to
 * source=fb/campaign=spring_promo/content=ad1 — plus one untagged
 * landing_visit (no UTM at all) so the "ישיר / לא מתויג" bucket has
 * something in it. Everything is timestamped `at` (default: now), so a
 * caller can place rows inside or outside whatever window a test requests.
 */
async function seedFunnel(dbPath, { at = new Date().toISOString() } = {}) {
  await withDb(dbPath, (db) => {
    // A minimal bookings_v2 row. FK enforcement (PRAGMA foreign_keys = ON)
    // is set per-connection in src/lib/server/db.ts, never persisted to the
    // file — this test's own DatabaseSync connection has it off, so a
    // student_id with no matching students_v2 row is accepted, exactly like
    // report-page.test.mjs's direct bookings_v2 seeding.
    db.prepare(`
      INSERT INTO bookings_v2 (student_id, start, "end", duration, at, status, heard_from)
      VALUES (999, ?, ?, 90, ?, 'confirmed', 'school')
    `).run(at, at, at);
    const bookingId = Number(db.prepare(`SELECT id FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get().id);

    const insertEvent = db.prepare(`
      INSERT INTO marketing_events (at, visitor_id, event, target, utm_source, utm_campaign, utm_content, booking_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const utm = ['fb', 'spring_promo', 'ad1'];
    insertEvent.run(at, 'v-1', 'landing_visit', null, ...utm, null);
    insertEvent.run(at, 'v-2', 'landing_visit', null, ...utm, null);
    insertEvent.run(at, 'v-1', 'cta_click', 'booking', ...utm, null);
    insertEvent.run(at, 'v-1', 'cta_click', 'whatsapp', ...utm, null);
    insertEvent.run(at, 'v-1', 'cta_click', 'phone', ...utm, null);
    insertEvent.run(at, 'v-1', 'booking_started', null, ...utm, null);
    insertEvent.run(at, 'v-1', 'lesson_scheduled', null, ...utm, bookingId);

    // The untagged visit — no utm_* at all.
    insertEvent.run(at, 'v-3', 'landing_visit', null, null, null, null, null);
  });
}

test('an unauthenticated request is redirected to login, like the dashboard', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/app/marketing`, { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.match(r.headers.get('location'), /^\/login\?next=%2Fapp%2Fmarketing/);
  } finally { await stop(); }
});

test('an authenticated request renders the seeded funnel numbers', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    await seedFunnel(dbPath);
    const cookie = await login(baseUrl);
    const html = await (await fetch(`${baseUrl}/app/marketing`, { headers: { Cookie: cookie } })).text();

    assert.equal((await fetch(`${baseUrl}/app/marketing`, { headers: { Cookie: cookie } })).status, 200);

    // The attributed group, one full table row: source, campaign, content,
    // then visitors=2, bookingClicks/whatsappClicks/phoneClicks/
    // bookingsStarted/bookings/lessonsHeld = 1 each, in column order.
    const td = (v) => `<td[^>]*>${v}<\\/td>`;
    const rowRe = new RegExp(
      `<tr[^>]*>\\s*${td('fb')}\\s*${td('spring_promo')}\\s*${td('ad1')}\\s*`
      + `${td(2)}\\s*${td(1)}\\s*${td(1)}\\s*${td(1)}\\s*${td(1)}\\s*${td(1)}\\s*${td(1)}\\s*<\\/tr>`,
    );
    assert.match(html, rowRe, 'the attributed row must render exactly the seeded counts, in column order');

    // The untagged bucket.
    assert.match(html, /ישיר \/ לא מתויג/, 'a NULL source groups under the spec\'d Hebrew label');

    // The heard-from answer, labelled (not the raw "school" value).
    assert.match(html, /בית ספר או מורה/);
    assert.doesNotMatch(html, />school</, 'the raw value must never leak past its label');

    // The one-line retention note.
    assert.match(html, /נתונים מאז 24\.9\.2026/);
    assert.match(html, /אירועים נשמרים 12 חודשים/);
  } finally { await stop(); }
});

test('the funnel table sits in its own overflow-x:auto container', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    await seedFunnel(dbPath);
    const cookie = await login(baseUrl);
    const html = await (await fetch(`${baseUrl}/app/marketing`, { headers: { Cookie: cookie } })).text();
    assert.match(html, /<div class="table-wrap[^"]*">\s*<table/, 'the table must be wrapped in its own scroll container');
  } finally { await stop(); }
});

/** The rendered `<a>` for the `?days=N` chip — whatever its scoped-CSS
 *  class hash happens to be — so a test can check whether that one tag
 *  carries the "active" class, without hardcoding Svelte's generated
 *  class name. */
function chipTag(html, days) {
  const re = new RegExp(`<a class="[^"]*"\\s+href="\\?days=${days}"[^>]*>`);
  const m = html.match(re);
  return m ? m[0] : null;
}

test('the days toggle defaults to 7 and an unknown value falls back to 7, not an error', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    await seedFunnel(dbPath);
    const cookie = await login(baseUrl);

    const defaultRes = await fetch(`${baseUrl}/app/marketing`, { headers: { Cookie: cookie } });
    assert.equal(defaultRes.status, 200);
    const defaultHtml = await defaultRes.text();
    const sevenChip = chipTag(defaultHtml, 7);
    assert.ok(sevenChip, 'the 7-day chip renders');
    assert.match(sevenChip, /\bactive\b/, 'the 7-day chip is active by default');

    const badRes = await fetch(`${baseUrl}/app/marketing?days=999`, { headers: { Cookie: cookie } });
    assert.equal(badRes.status, 200, 'an unrecognized days value must not error');
    const badHtml = await badRes.text();
    const sevenChipOnBad = chipTag(badHtml, 7);
    assert.ok(sevenChipOnBad);
    assert.match(sevenChipOnBad, /\bactive\b/, '?days=999 falls back to 7');

    const thirtyRes = await fetch(`${baseUrl}/app/marketing?days=30`, { headers: { Cookie: cookie } });
    const thirtyHtml = await thirtyRes.text();
    const thirtyChip = chipTag(thirtyHtml, 30);
    assert.ok(thirtyChip);
    assert.match(thirtyChip, /\bactive\b/, '?days=30 is honored');

    const ninetyRes = await fetch(`${baseUrl}/app/marketing?days=90`, { headers: { Cookie: cookie } });
    assert.equal(ninetyRes.status, 200);
    const ninetyHtml = await ninetyRes.text();
    const ninetyChip = chipTag(ninetyHtml, 90);
    assert.ok(ninetyChip, 'the 90-day chip renders');
    assert.match(ninetyChip, /\bactive\b/, '?days=90 is honored');
    // ?days=90 must not also leave the default chip marked active.
    const sevenChipOnNinety = chipTag(ninetyHtml, 7);
    assert.ok(sevenChipOnNinety);
    assert.doesNotMatch(sevenChipOnNinety, /\bactive\b/, 'only one chip is active at a time');
  } finally { await stop(); }
});

test('?days=90 sees an event that is outside the 30-day window', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    await seedFunnel(dbPath, { at: fortyDaysAgo });
    const cookie = await login(baseUrl);

    const thirtyHtml = await (await fetch(`${baseUrl}/app/marketing?days=30`, { headers: { Cookie: cookie } })).text();
    assert.doesNotMatch(thirtyHtml, />spring_promo</, 'a 40-day-old event must not appear in a 30-day window');

    const ninetyHtml = await (await fetch(`${baseUrl}/app/marketing?days=90`, { headers: { Cookie: cookie } })).text();
    assert.match(ninetyHtml, />spring_promo</, 'the same event must appear once the window widens to 90 days');
  } finally { await stop(); }
});

test('a booking outside the window is excluded — the 7-day default does not see an 8-day-old event', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    await seedFunnel(dbPath, { at: eightDaysAgo });
    const cookie = await login(baseUrl);
    const html = await (await fetch(`${baseUrl}/app/marketing`, { headers: { Cookie: cookie } })).text();
    assert.doesNotMatch(html, />spring_promo</, 'an 8-day-old event must not appear in the default 7-day window');
  } finally { await stop(); }
});

test('with nothing in the window, the empty state explains when measurement started', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const html = await (await fetch(`${baseUrl}/app/marketing`, { headers: { Cookie: cookie } })).text();
    assert.match(html, /24\.9\.2026/, 'the empty state names when measurement started');
    assert.doesNotMatch(html, /<table/, 'no table when there is nothing to show');
  } finally { await stop(); }
});

test('the dashboard links to the marketing report', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const html = await (await fetch(`${baseUrl}/app/dashboard`, { headers: { Cookie: cookie } })).text();
    assert.match(html, /href="\/app\/marketing"/);
    assert.match(html, />שיווק</);
  } finally { await stop(); }
});
