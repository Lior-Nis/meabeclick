// tests/unit/tutor-setup.test.mjs
//
// A tutor's setup link and the cookie that carries them through Google
// (docs/superpowers/specs/2026-10-16-tutor-meet-setup-design.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'tsetup-')), 'results.db');
process.env.SITE_URL = 'https://site.example';
const S = await import('../../src/lib/server/tutor-setup.ts');
const E = await import('../../src/lib/server/entities.ts');
const { handle } = await import('../../src/lib/server/db.ts');

const NOW = Date.parse('2027-01-10T10:00:00Z');
const DAY = 24 * 3600e3;
const ROOM = 'https://meet.google.com/abc-defg-hij';

test('a code is 43 base64url chars, only its hash is stored, and it finds its teacher', () => {
  const t = E.createTeacher({ name: 'מורה א' });
  const code = S.mintSetupCode(t.id, NOW);
  assert.match(code, /^[A-Za-z0-9_-]{43}$/);
  const row = handle().prepare(`SELECT setup_hash, setup_expires FROM teachers WHERE id = ?`).get(t.id);
  assert.notEqual(row.setup_hash, code, 'the raw code must not be stored');
  assert.match(row.setup_hash, /^[0-9a-f]{64}$/);
  assert.equal(row.setup_expires, new Date(NOW + 7 * DAY).toISOString());
  assert.equal(S.teacherForCode(code, NOW).id, t.id);
  assert.equal(S.setupLink(code), `https://site.example/app/tutor-setup/${code}`);
});

test('a code expires after 7 days, and a newer code replaces it', () => {
  const t = E.createTeacher({ name: 'מורה ב' });
  const first = S.mintSetupCode(t.id, NOW);
  assert.equal(S.teacherForCode(first, NOW + 7 * DAY - 1)?.id, t.id);
  assert.equal(S.teacherForCode(first, NOW + 7 * DAY), null);
  const second = S.mintSetupCode(t.id, NOW);
  assert.equal(S.teacherForCode(first, NOW), null, 'the replaced code still works');
  assert.equal(S.teacherForCode(second, NOW).id, t.id);
});

test('anything that is not a live code finds nobody', () => {
  const t = E.createTeacher({ name: 'מורה ג' });
  const code = S.mintSetupCode(t.id, NOW);
  for (const bad of [undefined, null, '', 'short', `${code}x`, code.replace(/./, '.'), 42]) {
    assert.equal(S.teacherForCode(bad, NOW), null, String(bad));
  }
  handle().prepare(`UPDATE teachers SET active = 0 WHERE id = ?`).run(t.id);
  assert.equal(S.teacherForCode(code, NOW), null, 'a deactivated teacher still matched');
});

test('completeSetup saves the room and the account, and uses the code up', () => {
  const t = E.createTeacher({ name: 'מורה ד' });
  const code = S.mintSetupCode(t.id, NOW);
  S.completeSetup(t.id, ROOM, 'tutor@example.com');
  const row = E.getTeacher(t.id);
  assert.equal(row.meet_url, ROOM);
  assert.equal(row.meet_account, 'tutor@example.com');
  assert.equal(row.setup_hash, null);
  assert.equal(S.teacherForCode(code, NOW), null);
});

test('the started cookie round-trips, and is refused when tampered or stale', () => {
  const nonce = S.newNonce();
  const code = 'A'.repeat(43);
  const v = S.mintStartedCookie(7, code, nonce, NOW);
  assert.deepEqual(S.readSetupCookie(v, NOW), { kind: 'started', teacherId: 7, code, nonce });
  assert.equal(S.readSetupCookie(v, NOW + S.COOKIE_TTL_MS), null, 'stale');
  assert.equal(S.readSetupCookie(v.replace('s.7.', 's.8.'), NOW), null, 'teacher swapped');
  assert.equal(S.readSetupCookie(v.slice(0, -2) + 'xx', NOW), null, 'signature');
  for (const bad of [undefined, null, '', 'nodot', '.x']) assert.equal(S.readSetupCookie(bad, NOW), null);
});

test('the done cookie names only the teacher', () => {
  assert.deepEqual(S.readSetupCookie(S.mintDoneCookie(3, NOW), NOW), { kind: 'done', teacherId: 3 });
});

test('cookie options: scoped to the setup pages, secure only over https', () => {
  const o = S.setupCookieOptions(new URL('https://site.example/x'));
  assert.deepEqual(o, { path: '/app/tutor-setup', httpOnly: true, sameSite: 'lax', secure: true, maxAge: 900 });
  assert.equal(S.setupCookieOptions(new URL('http://127.0.0.1:5000/x')).secure, false);
});
