import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'pay-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const P = await import('../../src/lib/server/payments.ts');
const DB = await import('../../src/lib/server/db.ts');
import { PLANS } from '../../src/lib/plans.ts';

const acct = E.createAccount({ name: 'משפחת לוי', credential: 'fam' });
const dana = E.createStudent({ code: 'dana',  name: 'דנה',  accountId: acct.id, credential: 'a' });
const yosi = E.createStudent({ code: 'yossi', name: 'יוסי', accountId: acct.id, credential: 'b' });

test('balance is zero for an account with no payments', () => {
  const empty = E.createAccount({ name: 'חדש', credential: 'n' });
  assert.deepEqual(P.balanceForAccount(empty.id, '2026-09-05'), { owedAgorot: 0, paidAgorot: 0, dueAgorot: 0, upcomingAgorot: 0 });
});

test('balance sums owed minus paid across every child on the account', () => {
  P.addPayment({ accountId: acct.id, studentId: dana.id, date: '2026-08-01', kind: 'single', amountAgorot: 10000, status: 'paid' });
  P.addPayment({ accountId: acct.id, studentId: yosi.id, date: '2026-08-02', kind: 'double', amountAgorot: 18000, status: 'owed' });

  assert.deepEqual(P.balanceForAccount(acct.id, '2026-09-05'), {
    owedAgorot: 18000, paidAgorot: 10000, dueAgorot: 18000, upcomingAgorot: 0,
  });
});

test('balance sums exactly over many rows', () => {
  const a = E.createAccount({ name: 'דיוק', credential: 'd' });
  const s = E.createStudent({ code: 'exact', name: 'מדויק', accountId: a.id, credential: 'e' });
  for (let i = 0; i < 100; i++) {
    P.addPayment({ accountId: a.id, studentId: s.id, date: '2026-08-01', kind: 'single', amountAgorot: 3333, status: 'owed' });
  }
  assert.equal(P.balanceForAccount(a.id, '2026-09-05').owedAgorot, 333300);
});

test('a payment cannot reference a nonexistent account', () => {
  assert.throws(
    () => P.addPayment({ accountId: 99999, studentId: dana.id, date: '2026-08-01', kind: 'single', amountAgorot: 10000, status: 'owed' }),
    /FOREIGN KEY/i,
  );
});

test('a non-integer amount is rejected rather than silently rounded', () => {
  const before = P.paymentsForAccount(acct.id).length;

  assert.throws(
    () => P.addPayment({
      accountId: acct.id, studentId: dana.id, date: '2026-08-01',
      kind: 'single', amountAgorot: 33.33, status: 'owed',
    }),
    /integer/,
    'a shekels-shaped amount was accepted',
  );

  assert.equal(P.paymentsForAccount(acct.id).length, before,
    'a rejected payment still wrote a row');
});

test('an unknown status is rejected by the database', () => {
  assert.throws(
    () => P.addPayment({
      accountId: acct.id, studentId: dana.id, date: '2026-08-01',
      kind: 'single', amountAgorot: 10000, status: 'pending',
    }),
    /CHECK/i,
    'an unknown status was accepted',
  );
});

test('a lesson dated today is due; tomorrow is upcoming', () => {
  const acc = E.createAccount({ name: 'משפחת בוחן', credential: 'x' });
  const kid = E.createStudent({ code: 'boundary', name: 'גבול', accountId: acc.id, credential: 'x' });

  P.addPayment({ accountId: acc.id, studentId: kid.id, date: '2026-09-05', kind: 'double', amountAgorot: 21500, status: 'owed' });
  P.addPayment({ accountId: acc.id, studentId: kid.id, date: '2026-09-06', kind: 'double', amountAgorot: 21500, status: 'owed' });

  const b = P.balanceForAccount(acc.id, '2026-09-05');
  assert.equal(b.dueAgorot, 21500, 'a lesson dated exactly asOf has happened');
  assert.equal(b.upcomingAgorot, 21500);
  assert.equal(b.owedAgorot, 43000, 'owed still totals both');
});

test('void rows are excluded from every figure', () => {
  const acc = E.createAccount({ name: 'משפחת ביטול', credential: 'x' });
  const kid = E.createStudent({ code: 'voided', name: 'בוטל', accountId: acc.id, credential: 'x' });

  P.addPayment({ accountId: acc.id, studentId: kid.id, date: '2026-01-01', kind: 'single', amountAgorot: 12000, status: 'void' });

  const b = P.balanceForAccount(acc.id, '2026-09-05');
  assert.equal(b.dueAgorot, 0);
  assert.equal(b.upcomingAgorot, 0);
  assert.equal(b.owedAgorot, 0);
  assert.equal(b.paidAgorot, 0);
});

test('balanceAllAccounts equals the sum of every account', () => {
  // The tutor's headline figure and the parents' figures are the same
  // query; if these ever disagree, one of the two screens is lying.
  const a1 = E.createAccount({ name: 'משפחה א', credential: 'a' });
  const s1 = E.createStudent({ code: 'sum-a', name: 'א', accountId: a1.id, credential: 'a' });
  const a2 = E.createAccount({ name: 'משפחה ב', credential: 'b' });
  const s2 = E.createStudent({ code: 'sum-b', name: 'ב', accountId: a2.id, credential: 'b' });

  P.addPayment({ accountId: a1.id, studentId: s1.id, date: '2026-01-01', kind: 'single', amountAgorot: 12000, status: 'paid' });
  P.addPayment({ accountId: a2.id, studentId: s2.id, date: '2026-01-02', kind: 'double', amountAgorot: 21500, status: 'owed' });

  const all = P.balanceAllAccounts('2026-09-05');

  // Get all distinct account IDs from the database
  const accountRows = DB.handle().prepare('SELECT DISTINCT account_id FROM payments ORDER BY account_id').all();
  const allAccountIds = accountRows.map(r => r.account_id);

  const summed = allAccountIds
    .map(id => P.balanceForAccount(id, '2026-09-05'))
    .reduce((t, b) => ({
      owedAgorot: t.owedAgorot + b.owedAgorot,
      paidAgorot: t.paidAgorot + b.paidAgorot,
      dueAgorot: t.dueAgorot + b.dueAgorot,
      upcomingAgorot: t.upcomingAgorot + b.upcomingAgorot,
    }), { owedAgorot: 0, paidAgorot: 0, dueAgorot: 0, upcomingAgorot: 0 });

  assert.equal(all.owedAgorot, summed.owedAgorot);
  assert.equal(all.paidAgorot, summed.paidAgorot);
  assert.equal(all.dueAgorot, summed.dueAgorot);
  assert.equal(all.upcomingAgorot, summed.upcomingAgorot);
});

test('todayInIsrael returns a YYYY-MM-DD string', () => {
  assert.match(P.todayInIsrael(), /^\d{4}-\d{2}-\d{2}$/);
});

test('a lesson is dated in Israel, not in UTC', () => {
  // 00:30 Israel time on the 6th is still the 5th in UTC. Slicing the ISO
  // string would date this charge a day early and move it across the
  // due/upcoming boundary.
  assert.equal(P.lessonDateInIsrael('2026-09-05T21:30:00.000Z'), '2026-09-06');
  assert.equal(P.lessonDateInIsrael('2026-09-05T13:00:00.000Z'), '2026-09-05');
});

test('chargesForStudent returns only that child, newest first', () => {
  const acc = E.createAccount({ name: 'משפחת רשימה', credential: 'l' });
  const a = E.createStudent({ code: 'list-a', name: 'א', accountId: acc.id, credential: 'l' });
  const b = E.createStudent({ code: 'list-b', name: 'ב', accountId: acc.id, credential: 'l' });

  P.addPayment({ accountId: acc.id, studentId: a.id, date: '2026-02-01', kind: 'single', amountAgorot: 12000, status: 'owed' });
  P.addPayment({ accountId: acc.id, studentId: a.id, date: '2026-03-01', kind: 'single', amountAgorot: 12000, status: 'paid' });
  P.addPayment({ accountId: acc.id, studentId: b.id, date: '2026-02-15', kind: 'double', amountAgorot: 21500, status: 'owed' });

  const rows = P.chargesForStudent(a.id);
  assert.equal(rows.length, 2, "a sibling's charges must not appear");
  assert.equal(rows[0].date, '2026-03-01', 'newest first');
});

test('every plan price round-trips through a charge unchanged', () => {
  const acc = E.createAccount({ name: 'משפחת מחיר', credential: 'p' });
  const kid = E.createStudent({ code: 'prices', name: 'מחיר', accountId: acc.id, credential: 'p' });

  for (const plan of PLANS) {
    P.addPayment({
      accountId: acc.id, studentId: kid.id, date: '2026-01-01',
      kind: plan.kind, amountAgorot: plan.shekels * 100, status: 'owed',
    });
  }

  assert.equal(
    P.balanceForAccount(acc.id, '2026-09-05').owedAgorot,
    PLANS.reduce((n, p) => n + p.shekels * 100, 0),
  );
});

test('voiding a booking\'s charge erases the debt without touching another booking', () => {
  const acc = E.createAccount({ name: 'משפחת ריק', credential: 'v' });
  const kid = E.createStudent({ code: 'voidable', name: 'ריק', accountId: acc.id, credential: 'v' });

  // Two bookings on one account: the one released downstream, and a
  // neighbour that must survive it. voidChargeForBooking matches on
  // booking_id, so a wrong predicate would silently clear the family's
  // whole ledger from inside a failure handler.
  const doomed = E.reserveBooking({
    studentId: kid.id,
    start: '2026-09-01T10:00:00.000Z', end: '2026-09-01T11:30:00.000Z', durationMin: 90,
  });
  const keeper = E.reserveBooking({
    studentId: kid.id,
    start: '2026-09-02T10:00:00.000Z', end: '2026-09-02T11:30:00.000Z', durationMin: 90,
  });
  assert.ok(doomed && keeper);

  const doomedId = P.addPayment({
    accountId: acc.id, studentId: kid.id, bookingId: doomed,
    date: '2026-09-01', kind: 'double', amountAgorot: 21500, status: 'owed',
  });
  P.addPayment({
    accountId: acc.id, studentId: kid.id, bookingId: keeper,
    date: '2026-09-02', kind: 'double', amountAgorot: 21500, status: 'owed',
  });

  P.voidChargeForBooking(doomed);

  const rows = P.chargesForStudent(kid.id);
  const voided = rows.find(r => r.id === doomedId);
  assert.equal(voided.status, 'void');
  assert.equal(rows.find(r => r.booking_id === keeper).status, 'owed',
    'another booking\'s charge must be untouched');

  // The voided row counts toward nothing: the released hour is not a debt,
  // is not planned, and was never money received.
  const b = P.balanceForAccount(acc.id, '2026-09-05');
  assert.equal(b.dueAgorot, 21500, 'only the surviving charge is due');
  assert.equal(b.upcomingAgorot, 0);
  assert.equal(b.owedAgorot, 21500);
  assert.equal(b.paidAgorot, 0);
});

test('balanceForStudent scopes to one child, not the family', () => {
  // The overview shows a card per child, so it needs a per-child figure —
  // balanceForAccount deliberately sums the whole family and would print
  // the same number on every card.
  const acc = E.createAccount({ name: 'משפחת פיצול', credential: 'split' });
  const a = E.createStudent({ code: 'split-a', name: 'א', accountId: acc.id, credential: 'split' });
  const b = E.createStudent({ code: 'split-b', name: 'ב', accountId: acc.id, credential: 'split' });

  P.addPayment({ accountId: acc.id, studentId: a.id, date: '2026-01-01', kind: 'double', amountAgorot: 21500, status: 'owed' });
  P.addPayment({ accountId: acc.id, studentId: a.id, date: '2027-01-01', kind: 'single', amountAgorot: 12000, status: 'owed' });
  P.addPayment({ accountId: acc.id, studentId: b.id, date: '2026-01-01', kind: 'single', amountAgorot: 12000, status: 'paid' });

  const forA = P.balanceForStudent(a.id, '2026-09-05');
  assert.equal(forA.dueAgorot, 21500);
  assert.equal(forA.upcomingAgorot, 12000, 'a 2027 lesson is upcoming, not due');
  assert.equal(forA.paidAgorot, 0, "the sibling's payment must not appear here");

  const forB = P.balanceForStudent(b.id, '2026-09-05');
  assert.equal(forB.dueAgorot, 0);
  assert.equal(forB.paidAgorot, 12000);

  // And the two children still add up to the family figure.
  const family = P.balanceForAccount(acc.id, '2026-09-05');
  assert.equal(family.dueAgorot, forA.dueAgorot + forB.dueAgorot);
  assert.equal(family.paidAgorot, forA.paidAgorot + forB.paidAgorot);
});

test('balanceForStudent excludes a voided charge', () => {
  const acc = E.createAccount({ name: 'משפחת ריק', credential: 'void2' });
  const kid = E.createStudent({ code: 'void-kid', name: 'ק', accountId: acc.id, credential: 'void2' });
  P.addPayment({ accountId: acc.id, studentId: kid.id, date: '2026-01-01', kind: 'single', amountAgorot: 12000, status: 'void' });

  const b = P.balanceForStudent(kid.id, '2026-09-05');
  assert.equal(b.dueAgorot, 0);
  assert.equal(b.owedAgorot, 0);
  assert.equal(b.paidAgorot, 0);
});
