import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login, familySession } from './harness.mjs';

const book = (baseUrl) => fetch(`${baseUrl}/api/book`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'יובל כהן', subject: 'מתמטיקה', level: 'כיתה יא',
    phone: '0501234567', email: 'orit@example.com', durationMin: 90,
    start: '2027-03-15T10:00:00+02:00', end: '2027-03-15T11:30:00+02:00',
  }),
}).then(r => r.json());

test('the plan page needs a tutor session', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const booked = await book(baseUrl);
    const anon = await fetch(`${baseUrl}/app/plan/${booked.portal.code}`, { redirect: 'manual' });
    assert.equal(anon.status, 302);
    assert.match(anon.headers.get('location'), /^\/login\?next=%2Fapp%2Fplan%2F/);

    const family = await familySession(booked.portal.link);
    const asFamily = await fetch(`${baseUrl}/app/plan/${booked.portal.code}`, {
      headers: { Cookie: family }, redirect: 'manual',
    });
    assert.equal(asFamily.status, 302, 'a family session is not a tutor session');
  } finally { await stop(); }
});

test('with no plan yet, the page offers to create one from a matching template', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const booked = await book(baseUrl);
    const cookie = await login(baseUrl);
    const html = await (await fetch(`${baseUrl}/app/plan/${booked.portal.code}`, { headers: { Cookie: cookie } })).text();

    assert.match(html, /יובל כהן/);
    assert.match(html, /מתמטיקה/, 'the subject chip');
    assert.match(html, /5 יח/, 'the five-unit template is offered');
    assert.match(html, /4 יח/, 'so is the four-unit one');
  } finally { await stop(); }
});

test('an existing plan renders its topics and counts', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const booked = await book(baseUrl);
    const cookie = await login(baseUrl);

    await fetch(`${baseUrl}/api/plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        code: booked.portal.code, subject: 'מתמטיקה',
        templateId: 'math-5u', goal: 'בגרות 5 יח״ל',
      }),
    });

    const html = await (await fetch(`${baseUrl}/app/plan/${booked.portal.code}`, { headers: { Cookie: cookie } })).text();
    assert.match(html, /חשבון דיפרנציאלי/, 'a topic from the template');
    assert.match(html, /לא נבדק/, 'the untouched count');
    assert.match(html, /התבנית טרם נסקרה/, 'reviewed is null in the shipped templates');
  } finally { await stop(); }
});

test('?filter=changed lands with that filter active, not the default', async () => {
  // The report form redirects here with exactly this query string (design
  // spec §6) so the tutor sees what her report just moved. The page used to
  // declare filter as $state('all') and reset it unconditionally on every
  // navigation, so the query string was written but never read.
  const { baseUrl, stop } = await startServer();
  try {
    const booked = await book(baseUrl);
    const cookie = await login(baseUrl);
    await fetch(`${baseUrl}/api/plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        code: booked.portal.code, subject: 'מתמטיקה',
        templateId: 'math-5u', goal: 'בגרות 5 יח״ל',
      }),
    });

    const html = await (await fetch(
      `${baseUrl}/app/plan/${booked.portal.code}?filter=changed`, { headers: { Cookie: cookie } },
    )).text();

    const chip = html.match(/<button[^>]*>\s*שונה מאז השיעור\s*<\/button>/);
    assert.ok(chip, 'the "שונה מאז השיעור" filter chip is rendered');
    assert.match(chip[0], /aria-pressed="true"/, 'that chip is the active one on first render');

    // An unrelated chip must not also read as active.
    const allChip = html.match(/<button[^>]*>\s*הכל\s*<\/button>/);
    assert.ok(allChip);
    assert.match(allChip[0], /aria-pressed="false"/, 'the default chip is not also active');
  } finally { await stop(); }
});

test('an unknown filter value falls back to the default rather than erroring', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const booked = await book(baseUrl);
    const cookie = await login(baseUrl);
    await fetch(`${baseUrl}/api/plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        code: booked.portal.code, subject: 'מתמטיקה',
        templateId: 'math-5u', goal: 'בגרות 5 יח״ל',
      }),
    });

    const res = await fetch(
      `${baseUrl}/app/plan/${booked.portal.code}?filter=not-a-real-filter`, { headers: { Cookie: cookie } },
    );
    assert.equal(res.status, 200);
    const html = await res.text();
    const allChip = html.match(/<button[^>]*>\s*הכל\s*<\/button>/);
    assert.ok(allChip);
    assert.match(allChip[0], /aria-pressed="true"/, 'an invalid filter value falls back to all, not left blank');
  } finally { await stop(); }
});

test('an unknown student is a 404, not a blank page', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const res = await fetch(`${baseUrl}/app/plan/nosuchkid`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 404);
  } finally { await stop(); }
});

test('the dashboard links to the plan page for each student', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const booked = await book(baseUrl);
    const cookie = await login(baseUrl);
    const html = await (await fetch(`${baseUrl}/app/dashboard`, { headers: { Cookie: cookie } })).text();
    assert.match(html, /\/app\/plan\//, 'the roster must offer a way in');
    assert.ok(
      html.includes(`/app/plan/${booked.portal.code}`),
      'the link must carry this student’s own code, not just any /app/plan/ text',
    );
  } finally { await stop(); }
});
