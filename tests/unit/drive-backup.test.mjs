// The off-box backup client.
//
// Only the parts that can be tested without a Google account, which is
// exactly where the risk is: retention decides what gets DELETED, and the
// config reader decides whether a nightly job silently does nothing.
//
// The upload path itself is covered by a fake fetch rather than a live call,
// because a test that needs a refresh token is a test nobody runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expiredBackups, readConfig, accessToken, ensureFolder, uploadFile, downloadFile } from '../../server/drive/client.mjs';

const at = (name, createdTime = '2026-09-01T00:00:00Z') => ({ id: `id-${name}`, name, createdTime });
const TODAY = new Date('2026-09-08T12:00:00Z');

/* ─────────────────── retention ─────────────────── */

test('keeps everything inside the window', () => {
  const files = ['results-2026-09-08.db', 'results-2026-09-02.db', 'files-2026-09-02.tar.gz'].map(n => at(n));
  assert.deepEqual(expiredBackups(files, 14, TODAY), []);
});

test('drops only what is older than the window', () => {
  const files = [
    at('results-2026-08-01.db'),   // 38 days old
    at('files-2026-08-01.tar.gz'),
    at('results-2026-09-08.db'),   // today
  ];
  const gone = expiredBackups(files, 14, TODAY).map(f => f.name);
  assert.deepEqual(gone.sort(), ['files-2026-08-01.tar.gz', 'results-2026-08-01.db']);
});

test("a day's two artefacts count as one day, not two", () => {
  // Retention is by the date in the NAME, not by file count. Counting files
  // would treat one day's database + tarball as two days and evict real days
  // at twice the rate — losing backups silently, on the day it mattered.
  //
  // The boundary is "strictly older than keepDays", so keepDays=14 leaves 15
  // distinct dates. That is deliberate: it matches `find -mtime +14` in
  // backup-db.sh, so the local and off-box copies expire together instead of
  // drifting a day apart.
  const files = [];
  for (let d = 1; d <= 20; d++) {
    const day = `2026-09-${String(d).padStart(2, '0')}`;
    files.push(at(`results-${day}.db`), at(`files-${day}.tar.gz`));
  }
  const gone = expiredBackups(files, 14, new Date('2026-09-20T00:00:00Z'));
  const kept = files.filter(f => !gone.includes(f));
  const keptDays = new Set(kept.map(f => f.name.match(/(\d{4}-\d{2}-\d{2})/)[1]));

  assert.equal(keptDays.size, 15, 'strictly-older-than-14-days leaves 15 dates');
  assert.equal(kept.length, keptDays.size * 2, 'both artefacts of a kept day survive together');
  assert.ok(keptDays.size >= 14, 'well above the 7 days a file-count rule would have left');
});

/* ─────────────────── configuration ─────────────────── */

test('missing credentials are reported, not guessed at', () => {
  const { missing } = readConfig({});
  assert.deepEqual(missing.sort(), ['clientId', 'clientSecret', 'refreshToken']);
});

test('a complete config reports nothing missing, and defaults the folder', () => {
  const { cfg, missing } = readConfig({
    GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_CLIENT_SECRET: 'secret',
    GOOGLE_OAUTH_REFRESH_TOKEN: 'refresh',
  });
  assert.deepEqual(missing, []);
  assert.equal(cfg.folderName, 'mea-beclick-backups');
  assert.equal(cfg.folderId, null);
});

/* ─────────────────── failure messages ─────────────────── */

test('an auth failure never echoes the credential back', () => {
  // The token endpoint's error body can contain the client_id. A nightly
  // job's stderr ends up in journald and in a paste to a colleague.
  const fake = async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant', client_id: 'SECRET-ID' }) });
  return assert.rejects(
    () => accessToken({ clientId: 'SECRET-ID', clientSecret: 'SECRET', refreshToken: 'SECRET' }, fake),
    (err) => {
      assert.doesNotMatch(err.message, /SECRET/, 'credentials must not reach an error message');
      assert.match(err.message, /revoked/, 'and it should say what to check');
      return true;
    },
  );
});

test('a 403 on upload explains the service-account trap', () => {
  // The single most likely misconfiguration: pointing this at the Calendar
  // service account. It fails with storageQuotaExceeded, which reads as "the
  // account is full" and is nothing of the sort.
  const fake = async () => ({ ok: false, status: 403 });
  return assert.rejects(
    () => uploadFile('tok', { name: 'results-2026-09-08.db', folderId: 'f', body: Buffer.from('x'), mimeType: 'application/x-sqlite3' }, fake),
    /service account cannot own Drive files/,
  );
});

/* ─────────────────── folder handling ─────────────────── */

test('an existing folder is reused rather than duplicated', async () => {
  // A nightly job that created a folder per run would scatter backups across
  // dozens of identically-named folders — and under drive.file nobody could
  // tidy them from the browser without breaking the app's access.
  let created = 0;
  const fake = async (url, init) => {
    if (init?.method === 'POST') { created++; return { ok: true, json: async () => ({ id: 'new' }) }; }
    return { ok: true, json: async () => ({ files: [{ id: 'existing', name: 'mea-beclick-backups' }] }) };
  };
  assert.equal(await ensureFolder('tok', 'mea-beclick-backups', fake), 'existing');
  assert.equal(created, 0, 'must not create a folder when one already exists');
});

test('the folder is created when there is none', async () => {
  const fake = async (url, init) =>
    init?.method === 'POST'
      ? { ok: true, json: async () => ({ id: 'fresh' }) }
      : { ok: true, json: async () => ({ files: [] }) };
  assert.equal(await ensureFolder('tok', 'mea-beclick-backups', fake), 'fresh');
});

/* The off-box copy was write-only until downloadFile existed: the uploader
   could put a backup on Drive and nothing in the tree could take one back,
   while server/README.md called that copy the reason this VPS is
   disposable. These pin the fetch half. */
test('a download asks for the bytes, not the metadata', async () => {
  let asked = null;
  const fake = async (url, opts) => {
    asked = { url, auth: opts?.headers?.Authorization };
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode('sqlite-bytes').buffer };
  };

  const bytes = await downloadFile('tok', 'file-123', fake);

  assert.match(asked.url, /alt=media/, 'without alt=media Drive returns JSON metadata, not the file');
  assert.match(asked.url, /files\/file-123/);
  assert.equal(asked.auth, 'Bearer tok');
  assert.equal(bytes.toString(), 'sqlite-bytes');
});

test('a failed download says so instead of writing a truncated backup', async () => {
  const fake = async () => ({ ok: false, status: 404 });
  await assert.rejects(
    () => downloadFile('tok', 'missing', fake),
    /could not download missing: 404/,
  );
});

test('a download failure never echoes the token', async () => {
  const fake = async () => ({ ok: false, status: 401 });
  await assert.rejects(
    () => downloadFile('super-secret-token', 'f1', fake),
    (err) => !err.message.includes('super-secret-token'),
  );
});
