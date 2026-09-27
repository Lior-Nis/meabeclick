/**
 * The app's Drive client, against a fake fetch: the requests it makes are
 * the contract with Google, and the probe (spec §1) is what they match.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { driveApi, driveApiFromEnv } = await import('../../src/lib/server/drive/api.ts');

function fake(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body });
    for (const [pattern, reply] of routes) {
      if (pattern.test(String(url))) {
        const r = typeof reply === 'function' ? reply(String(url), init) : reply;
        return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
      }
    }
    return new Response('{}', { status: 500 });
  };
  return { calls, fetchImpl };
}
const TOKEN = [/oauth2\.googleapis\.com\/token/, { body: { access_token: 'tok', expires_in: 3600 } }];
const cfg = { clientId: 'c', clientSecret: 's', refreshToken: 'r' };

test('not configured is null, so the job can say so and touch nothing', () => {
  assert.equal(driveApiFromEnv({}), null);
});

test('a document is created as a Google Doc from HTML, inside its folder', async () => {
  const f = fake([TOKEN, [/upload\/drive\/v3\/files\?uploadType=multipart/, { body: { id: 'D1', modifiedTime: 't1' } }]]);
  const api = driveApi(cfg, f.fetchImpl);
  assert.deepEqual(await api.createDoc('שיעור', '<html dir="rtl"></html>', 'P1'), { id: 'D1', modifiedTime: 't1' });
  const up = f.calls.find(c => c.url.includes('uploadType=multipart'));
  assert.match(String(up.body), /"mimeType":"application\/vnd\.google-apps\.document"/);
  assert.match(String(up.body), /"parents":\["P1"\]/);
  assert.match(String(up.body), /Content-Type: text\/html/);
  assert.equal(up.headers.Authorization, 'Bearer tok');
});

test('the token is fetched once and reused', async () => {
  const f = fake([TOKEN, [/drive\/v3\/files\/X\?/, { body: { modifiedTime: 't', trashed: false } }]]);
  const api = driveApi(cfg, f.fetchImpl);
  await api.meta('X'); await api.meta('X');
  assert.equal(f.calls.filter(c => c.url.includes('oauth2')).length, 1);
});

test('a deleted file is null, not an error', async () => {
  const f = fake([TOKEN, [/drive\/v3\/files\/GONE\?/, { status: 404 }]]);
  assert.equal(await driveApi(cfg, f.fetchImpl).meta('GONE'), null);
});

test('any other failure throws with the status and never Google\'s body', async () => {
  const f = fake([TOKEN, [/drive\/v3\/files\/X\/export/, { status: 403, body: { error: { message: 'secret detail' } } }]]);
  await assert.rejects(driveApi(cfg, f.fetchImpl).exportMarkdown('X'), (e) => /403/.test(e.message) && !/secret/.test(e.message));
});

test('export asks for Markdown; update replaces the content in place', async () => {
  const f = fake([TOKEN,
    [/export\?mimeType=text%2Fmarkdown/, { body: 'x' }],
    [/upload\/drive\/v3\/files\/D1\?uploadType=media/, { body: { id: 'D1', modifiedTime: 't2' } }]]);
  const api = driveApi(cfg, f.fetchImpl);
  await api.exportMarkdown('D1');
  assert.deepEqual(await api.updateDoc('D1', '<html></html>'), { modifiedTime: 't2' });
  const upd = f.calls.find(c => c.url.includes('uploadType=media'));
  assert.equal(upd.method, 'PATCH');
});
