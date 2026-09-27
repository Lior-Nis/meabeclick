// The editor endpoint, through the real server.
//
// The unit tests pin the version semantics. These pin who may reach them,
// and that the defaults are the safe ones: material is what goes out under
// the tutor's name, and a draft is by definition something she has not
// approved, so a family session must not open this at all — not even to
// read a published version, which reaches them through the portal instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login, familySession } from './harness.mjs';

const book = (baseUrl, over = {}) => fetch(`${baseUrl}/api/book`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'יובל כהן', subject: 'מתמטיקה', level: 'כיתה ט',
    phone: '0501234567', email: 'mat@example.com', durationMin: 90,
    start: '2027-08-01T10:00:00+03:00', end: '2027-08-01T11:30:00+03:00', ...over,
  }),
}).then(r => r.json());

/** The booking starts generation, which creates the lessons row this
 *  endpoint addresses by slug. */
async function lessonSlug(baseUrl, cookie) {
  const booked = await book(baseUrl);
  const lessons = await (await fetch(`${baseUrl}/api/lessons`, { headers: { Cookie: cookie } })).json();
  const list = Array.isArray(lessons) ? lessons : (lessons.lessons ?? []);
  return { slug: list[0]?.slug ?? null, code: booked.portal.code, link: booked.portal.link };
}

const materials = (baseUrl, slug, cookie, qs = '') =>
  fetch(`${baseUrl}/api/lessons/${slug}/materials${qs}`, { headers: cookie ? { Cookie: cookie } : {}, cache: 'no-store' });

const post = (baseUrl, slug, cookie, body) =>
  fetch(`${baseUrl}/api/lessons/${slug}/materials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });

test('a family session cannot reach the editor at all', async (t) => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const { slug, link } = await lessonSlug(baseUrl, cookie);
    if (!slug) return t.skip('no lesson row was created for this booking');

    const family = await familySession(link);
    assert.equal((await materials(baseUrl, slug, family)).status, 401,
      'a draft is material the tutor has not approved');
    assert.equal((await materials(baseUrl, slug, null)).status, 401);
    assert.equal((await post(baseUrl, slug, family, { type: 'save', content: '{}' })).status, 401);
  } finally { await stop(); }
});

test('saving makes a draft, and a draft is not published', async (t) => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const { slug } = await lessonSlug(baseUrl, cookie);
    if (!slug) return t.skip('no lesson row was created for this booking');

    const res = await post(baseUrl, slug, cookie, {
      type: 'save', kind: 'plan', content: JSON.stringify({ title: 'תיקון של ניקול' }),
    });
    assert.equal(res.status, 200);
    const { saved } = await res.json();
    assert.equal(saved.published_at, null, 'save must not publish');
    assert.equal(saved.origin, 'edited');

    const view = await (await materials(baseUrl, slug, cookie, '?kind=plan')).json();
    assert.equal(view.published, null, 'nothing is published yet');
    assert.equal(view.latest.version, saved.version);
    assert.equal(view.unpublishedEdits, true);
  } finally { await stop(); }
});

test('publishing is a separate act, and history keeps both', async (t) => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const { slug } = await lessonSlug(baseUrl, cookie);
    if (!slug) return t.skip('no lesson row was created for this booking');

    await post(baseUrl, slug, cookie, { type: 'save', kind: 'plan', content: JSON.stringify({ t: 1 }) });
    await post(baseUrl, slug, cookie, { type: 'save', kind: 'plan', content: JSON.stringify({ t: 2 }) });

    const pub = await post(baseUrl, slug, cookie, { type: 'publish', kind: 'plan', version: 1 });
    assert.equal(pub.status, 200);

    const view = await (await materials(baseUrl, slug, cookie, '?kind=plan')).json();
    assert.equal(view.published.version, 1);
    assert.equal(view.latest.version, 2, 'the newer draft is still hers to finish');
    assert.equal(view.history.length, 2);
  } finally { await stop(); }
});

test('restoring copies forward, so the student actually sees the old text', async (t) => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const { slug } = await lessonSlug(baseUrl, cookie);
    if (!slug) return t.skip('no lesson row was created for this booking');

    await post(baseUrl, slug, cookie, { type: 'save', kind: 'plan', content: JSON.stringify({ t: 'good' }), publish: true });
    await post(baseUrl, slug, cookie, { type: 'save', kind: 'plan', content: JSON.stringify({ t: 'bad' }), publish: true });

    const res = await post(baseUrl, slug, cookie, { type: 'restore', kind: 'plan', version: 1, publish: true });
    assert.equal(res.status, 200);

    const view = await (await materials(baseUrl, slug, cookie, '?kind=plan')).json();
    assert.equal(JSON.parse(view.published.content).t, 'good');
    assert.equal(view.published.version, 3, 'a new version, not a revived one');
    assert.equal(view.history.length, 3, 'and the bad one is still readable');
  } finally { await stop(); }
});

test('teacher-only notes never come back in the published read', async (t) => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const { slug } = await lessonSlug(baseUrl, cookie);
    if (!slug) return t.skip('no lesson row was created for this booking');

    await post(baseUrl, slug, cookie, {
      type: 'save', kind: 'plan',
      content: JSON.stringify({ t: 'לתלמיד' }),
      teacherOnly: JSON.stringify({ solutions: ['x = 4'] }),
      publish: true,
    });

    const view = await (await materials(baseUrl, slug, cookie, '?kind=plan')).json();
    assert.doesNotMatch(JSON.stringify(view.published), /x = 4/,
      'the published shape is what a student route would serve');
    assert.match(JSON.stringify(view.latest), /x = 4/, 'the tutor keeps her solutions');
  } finally { await stop(); }
});

test('unknown kinds and actions are refused rather than 500ing', async (t) => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const { slug } = await lessonSlug(baseUrl, cookie);
    if (!slug) return t.skip('no lesson row was created for this booking');

    assert.equal((await materials(baseUrl, slug, cookie, '?kind=constructor')).status, 400);
    assert.equal((await post(baseUrl, slug, cookie, { type: 'save', kind: 'nope', content: '{}' })).status, 400);
    assert.equal((await post(baseUrl, slug, cookie, { type: 'explode', kind: 'plan' })).status, 400);
    assert.equal((await post(baseUrl, slug, cookie, { type: 'save', kind: 'plan' })).status, 400);
    assert.equal((await post(baseUrl, slug, cookie, { type: 'publish', kind: 'plan', version: 'x' })).status, 400);
  } finally { await stop(); }
});

test('an unknown lesson is not found, for every verb', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    assert.equal((await materials(baseUrl, 'nosuchlesson', cookie, '?kind=plan')).status, 404);
    assert.equal((await post(baseUrl, 'nosuchlesson', cookie, { type: 'save', kind: 'plan', content: '{}' })).status, 404);
  } finally { await stop(); }
});
