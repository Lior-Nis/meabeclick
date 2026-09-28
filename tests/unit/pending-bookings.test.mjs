// tests/unit/pending-bookings.test.mjs
//
// A booking with a known family's email, not signed in as that family, is
// held until the address on file confirms it. See
// docs/superpowers/specs/2026-09-28-confirm-known-email-booking-design.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'pending-')), 'results.db');
process.env.SESSION_SECRET = 'test-secret-not-a-real-one';
const E = await import('../../src/lib/server/entities.ts');
const P = await import('../../src/lib/server/pending-bookings.ts');
const A = await import('../../src/lib/server/family-auth.ts');

const account = E.createAccount({ name: 'משפחת כהן', phone: null, credential: 'x', email: 'cohen@example.com' });
const HOUR = { start: '2030-01-10T08:00:00.000Z', end: '2030-01-10T09:30:00.000Z' };
const body = { name: 'זר', subject: 'מתמטיקה', level: 'כיתה ח', phone: '0500000000', email: 'cohen@example.com', ...HOUR, durationMin: 90 };

test('a live hold takes the hour: booking and availability both see it', () => {
  const id = P.holdBooking({ accountId: account.id, body, now: new Date('2030-01-01T00:00:00Z') });
  assert.ok(id > 0);
  assert.equal(E.slotTaken(HOUR.start, HOUR.end), true);
  assert.deepEqual(E.readBookings('2030-01-10T00:00:00Z', '2030-01-11T00:00:00Z').map(r => ({ ...r })), [{ start: HOUR.start, end: HOUR.end }]);
  assert.deepEqual(P.pendingById(id)?.body, body, 'the booking waits whole');
});

test('a hold lasts a day, or until the lesson if that is sooner', () => {
  assert.equal(P.holdExpiry(new Date('2030-01-01T00:00:00Z'), HOUR.start), '2030-01-02T00:00:00.000Z');
  assert.equal(P.holdExpiry(new Date('2030-01-10T07:00:00Z'), HOUR.start), HOUR.start);
});

test('an expired hold frees the hour and can no longer be claimed', () => {
  const later = { start: '2030-02-10T08:00:00.000Z', end: '2030-02-10T09:30:00.000Z' };
  // Made in 2020: long expired by now.
  const id = P.holdBooking({ accountId: account.id, body: { ...body, ...later }, now: new Date('2020-01-01T00:00:00Z') });
  assert.equal(E.slotTaken(later.start, later.end), false);
  assert.equal(P.pendingById(id), null);
  assert.equal(P.claimPending(id), null);
});

test('a hold is claimed once', () => {
  const at = { start: '2030-03-10T08:00:00.000Z', end: '2030-03-10T09:30:00.000Z' };
  const id = P.holdBooking({ accountId: account.id, body: { ...body, ...at }, now: new Date('2030-01-01T00:00:00Z') });
  const claimed = P.claimPending(id);
  assert.equal(claimed?.accountId, account.id);
  assert.equal(claimed?.body.start, at.start);
  assert.equal(P.claimPending(id), null, 'a second click, or a replay, finds nothing');
  assert.equal(E.slotTaken(at.start, at.end), false, 'claimed: the booking itself takes the hour now');
});

test('a confirmation token is not a session, and a session token is not a confirmation', () => {
  const t = A.mintPendingToken(7, Date.parse('2030-01-02T00:00:00Z'));
  assert.equal(A.verifyPendingToken(t), 7);
  assert.equal(A.verifyFamilyToken(t), null, 'cannot sign anyone in');
  assert.equal(A.verifyPendingToken(A.mintAccountLinkToken(account.id)), null);
  assert.equal(A.verifyPendingToken(t.slice(0, -2) + 'xx'), null, 'tampered');
  assert.equal(A.verifyPendingToken(A.mintPendingToken(7, Date.now() - 1000)), null, 'expired');
});
