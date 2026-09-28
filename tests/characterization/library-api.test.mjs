// tests/characterization/library-api.test.mjs
//
// The prepared library's API and page (docs/superpowers/specs/2026-09-28-prepared-library-design.md).
// The harness has no engine credentials, so a preparation here fails — which
// is itself worth pinning: it must end as a recorded failure, not hang.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login } from './harness.mjs';

const KEY = 'test-cron-key';

async function until(fn, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise(r => setTimeout(r, 200));
  }
}

test('the library is the tutor’s: API, page, and a cron key to prepare from the box', async () => {
  const { baseUrl, stop } = await startServer({ env: { CRON_KEY: KEY } });
  try {
    assert.equal((await fetch(`${baseUrl}/api/library?template=math-8`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/library/prepare`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ template: 'math-8', topic: 'alg' }) })).status, 401);
    const page = await fetch(`${baseUrl}/app/library`, { redirect: 'manual' });
    assert.notEqual(page.status, 200, 'the page is not public');

    const tutor = await login(baseUrl);
    const view = await (await fetch(`${baseUrl}/api/library?template=math-8`, { headers: { Cookie: tutor } })).json();
    assert.equal(view.topics.find(t => t.key === 'alg').skills.length, 6);
    const html = await (await fetch(`${baseUrl}/app/library`, { headers: { Cookie: tutor } })).text();
    assert.match(html, /ספריית חומרים/);
    assert.match(html, /התחום האלגברי/);

    const bad = await fetch(`${baseUrl}/api/library/prepare`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-key': KEY },
      body: JSON.stringify({ template: 'math-8', skill: 'no.such' }),
    });
    assert.equal(bad.status, 404);

    const r = await fetch(`${baseUrl}/api/library/prepare`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-key': KEY },
      body: JSON.stringify({ template: 'math-8', skill: 'alg.eq.word' }),
    });
    assert.equal(r.status, 202);
    assert.deepEqual((await r.json()).queued, ['alg.eq.word']);

    const item = await until(async () => {
      const v = await (await fetch(`${baseUrl}/api/library?template=math-8`, { headers: { Cookie: tutor } })).json();
      const it = v.topics.flatMap(t => t.skills).find(s => s.key === 'alg.eq.word').item;
      return it && !['queued', 'preparing'].includes(it.status) ? it : null;
    });
    assert.equal(item.status, 'failed', 'no engine here: a recorded failure');
    assert.ok(item.problem);

    const lessons = await (await fetch(`${baseUrl}/api/lessons`, { headers: { Cookie: tutor } })).json();
    assert.ok(!lessons.lessons.some(l => l.slug.startsWith('lib-')), 'masters are not in the lessons feed');
  } finally { await stop(); }
});
