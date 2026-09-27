// The editor's plan verbs, through the real server: save-plan (draft),
// preview (stores nothing) and publish-plan (plan + rendered deck,
// together). Spec: docs/superpowers/specs/2026-09-25-lesson-editor-design.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login, familySession } from './harness.mjs';

const BASE_PLAN = {
  title: 'מקור', gradeContext: 'כיתה ט',
  slides: [{ heading: 'שקף מקורי', bullets: ['נקודה'] }],
  examples: [{ problem: '1+1', steps: ['חיבור'], answer: '2' }],
  homework: [{ task: 't', why: 'w' }],
  games: { quiz: { title: 'q', subject: 'מתמטיקה', questions: [] } },
};
const EDIT = {
  title: 'ערוך', slides: [{ heading: 'שקף ערוך <script>x</script>', bullets: ['חדש', ''] }],
  examples: [], teacherOnly: 'רק לי',
};

async function setup() {
  const s = await startServer();
  const cookie = await login(s.baseUrl);
  const booked = await fetch(`${s.baseUrl}/api/book`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'יובל כהן', subject: 'מתמטיקה', level: 'כיתה ט', phone: '0501234567',
      email: 'ed@example.com', durationMin: 90, start: '2027-08-01T10:00:00+03:00', end: '2027-08-01T11:30:00+03:00' }),
  }).then(r => r.json());
  const lessons = await (await fetch(`${s.baseUrl}/api/lessons`, { headers: { Cookie: cookie } })).json();
  const slug = (Array.isArray(lessons) ? lessons : lessons.lessons)[0].slug;
  const post = (body, c = cookie) => fetch(`${s.baseUrl}/api/lessons/${slug}/materials`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(c ? { Cookie: c } : {}) }, body: JSON.stringify(body),
  });
  // What generation would have stored: the structured plan, published.
  assert.equal((await post({ type: 'save', kind: 'plan', content: JSON.stringify(BASE_PLAN), publish: true })).status, 200);
  assert.equal((await post({ type: 'save', kind: 'slides', content: '<h2>שקף מקורי</h2>', publish: true })).status, 200);
  const served = () => fetch(`${s.baseUrl}/lessons/${slug}`).then(r => r.text());
  const plans = async () => (await (await fetch(`${s.baseUrl}/api/lessons/${slug}/materials?kind=plan`, { headers: { Cookie: cookie } })).json());
  return { ...s, cookie, slug, post, served, plans, link: booked.portal.link };
}

test('publishing an edit serves the edited deck, escaped, and keeps the games', async () => {
  const t = await setup();
  try {
    const r = await t.post({ type: 'publish-plan', edit: EDIT });
    assert.equal(r.status, 200, await r.clone().text());
    const html = await t.served();
    assert.match(html, /שקף ערוך/);
    assert.doesNotMatch(html, /<script>x<\/script>/, 'a heading is text, never markup');
    assert.doesNotMatch(html, /רק לי/, 'internal notes never reach the deck');
    const { latest } = await t.plans();
    const plan = JSON.parse(latest.content);
    assert.equal(plan.title, 'ערוך');
    assert.deepEqual(plan.games, BASE_PLAN.games);
    assert.equal(latest.teacher_only, 'רק לי');
    assert.ok(latest.published_at);
  } finally { await t.stop(); }
});

test('a draft is saved but the student still sees the published lesson', async () => {
  const t = await setup();
  try {
    await t.post({ type: 'publish-plan', edit: { ...EDIT, slides: [{ heading: 'גרסה 1', bullets: ['א'] }] } });
    const r = await t.post({ type: 'save-plan', edit: { ...EDIT, slides: [{ heading: 'טיוטה', bullets: ['ב'] }] } });
    assert.equal(r.status, 200);
    const html = await t.served();
    assert.match(html, /גרסה 1/);
    assert.doesNotMatch(html, /טיוטה/);
    const { latest, unpublishedEdits } = await t.plans();
    assert.equal(JSON.parse(latest.content).slides[0].heading, 'טיוטה');
    assert.equal(unpublishedEdits, true);
  } finally { await t.stop(); }
});

const previewPost = (t, cookie) => fetch(`${t.baseUrl}/app/lessons/${t.slug}/preview`, {
  method: 'POST', redirect: 'manual',
  headers: { Origin: t.baseUrl, ...(cookie ? { Cookie: cookie } : {}) },
  body: new URLSearchParams({ edit: JSON.stringify(EDIT) }),
});

test('preview is the edited deck as its own document, and stores nothing', async () => {
  const t = await setup();
  try {
    const before = (await t.plans()).history.length;
    const r = await previewPost(t, t.cookie);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') ?? '', /text\/html/);
    assert.ok(r.headers.get('content-security-policy'), 'the deck\'s own CSP, not the editor page\'s');
    assert.match(await r.text(), /שקף ערוך/);
    assert.equal((await t.plans()).history.length, before);
  } finally { await t.stop(); }
});

test('preview is the tutor\'s alone', async () => {
  const t = await setup();
  try {
    const family = await familySession(t.link);
    assert.notEqual((await previewPost(t, family)).status, 200);
    assert.notEqual((await previewPost(t, null)).status, 200);
  } finally { await t.stop(); }
});

test('an invalid edit is refused with a reason, and nothing is written', async () => {
  const t = await setup();
  try {
    const r = await t.post({ type: 'publish-plan', edit: { ...EDIT, slides: [] } });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /שקף/);
    assert.match(await t.served(), /שקף מקורי/);
  } finally { await t.stop(); }
});

test('only the tutor may use any of it', async () => {
  const t = await setup();
  try {
    const family = await familySession(t.link);
    for (const type of ['publish-plan', 'save-plan']) {
      assert.equal((await t.post({ type, edit: EDIT }, family)).status, 401, type);
      assert.equal((await t.post({ type, edit: EDIT }, null)).status, 401, type);
    }
  } finally { await t.stop(); }
});

test('a cross-site form cannot post an edit into the preview', async () => {
  // Pinned rather than left to SvelteKit's default: the preview renders
  // whatever edit it is given, under the tutor's session.
  const t = await setup();
  try {
    const r = await fetch(`${t.baseUrl}/app/lessons/${t.slug}/preview`, {
      method: 'POST', redirect: 'manual',
      headers: { Origin: 'https://evil.example', Cookie: t.cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ edit: JSON.stringify(EDIT) }),
    });
    assert.equal(r.status, 403);
  } finally { await t.stop(); }
});
