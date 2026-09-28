/**
 * Payments, replacing the hand-maintained Markdown table that the old
 * pricing module (since deleted) parsed.
 *
 * That lookup matched a Hebrew display name against a Latin one and returned
 * null every time, so the parent portal's Payments section never rendered in
 * production. Rows keyed on account_id cannot fail that way.
 *
 * Amounts are INTEGER agorot. Currency is never a float: 100 * 0.01 summed
 * a hundred times is not 100 in binary floating point, and a balance a
 * parent reads must be exact.
 */
import { handle } from './db.ts';
import { israelDay, israelToday } from '../dates.ts';

export type PaymentRow = {
  id: number; account_id: number; student_id: number; booking_id: number | null;
  date: string; kind: string; amount_agorot: number; status: string; note: string | null;
};

export function addPayment(p: {
  accountId: number; studentId: number; bookingId?: number | null;
  date: string; kind: 'single' | 'double' | 'triple'; amountAgorot: number;
  status: 'owed' | 'paid' | 'void'; note?: string | null;
}): number {
  // Amounts are agorot and must arrive as integers. Rounding a non-integer
  // here would silently paper over the exact bug this invariant exists to
  // catch: a caller that passed shekels, or botched a shekels-to-agorot
  // conversion. A wrong balance a parent reads is worse than a thrown error
  // a developer reads.
  if (!Number.isInteger(p.amountAgorot)) {
    throw new TypeError(
      `addPayment: amountAgorot must be an integer number of agorot, got ${p.amountAgorot}`,
    );
  }

  const info = handle().prepare(`
    INSERT INTO payments (account_id, student_id, booking_id, date, kind, amount_agorot, status, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(p.accountId, p.studentId, p.bookingId ?? null, p.date, p.kind,
         p.amountAgorot, p.status, p.note ?? null);
  return Number(info.lastInsertRowid);
}

/** Voids every charge attached to a booking — used when the hour is
 *  released because a downstream step failed. A voided row keeps the
 *  history without being owed. */
export function voidChargeForBooking(bookingId: number): void {
  handle().prepare(
    `UPDATE payments SET status = 'void' WHERE booking_id = ?`
  ).run(bookingId);
}

/** Sets the status of several charges at once, and reports how many rows
 *  changed. All-or-nothing is enforced by the caller checking existence
 *  first — a half-applied batch on money is worse than a rejected one. */
export function setPaymentStatus(ids: number[], status: 'owed' | 'paid' | 'void'): number {
  const db = handle();
  const stmt = db.prepare(`UPDATE payments SET status = ? WHERE id = ?`);
  let changed = 0;
  for (const id of ids) changed += Number(stmt.run(status, id).changes);
  return changed;
}

export function paymentsExist(ids: number[]): boolean {
  if (!ids.length) return false;
  // Compared against the DISTINCT count, not ids.length: a duplicate id
  // (e.g. a caller that didn't de-dupe) must not fail this check when every
  // id it names does exist — "every id exists" doesn't say "no repeats".
  const distinct = new Set(ids);
  const placeholders = ids.map(() => '?').join(',');
  const row = handle().prepare(
    `SELECT COUNT(*) AS n FROM payments WHERE id IN (${placeholders})`
  ).get(...ids) as { n: number };
  return row.n === distinct.size;
}

export function paymentsForAccount(accountId: number): PaymentRow[] {
  return handle().prepare(
    `SELECT * FROM payments WHERE account_id = ? ORDER BY date DESC, id DESC`
  ).all(accountId) as PaymentRow[];
}

/** One child's charges, newest first. Scoped to the student rather than the
 *  account so a parent viewing one child does not see a sibling's lessons
 *  itemised under their name. */
export function chargesForStudent(studentId: number): PaymentRow[] {
  return handle().prepare(
    `SELECT * FROM payments WHERE student_id = ? ORDER BY date DESC, id DESC`
  ).all(studentId) as PaymentRow[];
}

export type AccountBalance = {
  /** Every 'owed' row, whether the lesson has happened or not. */
  owedAgorot: number;
  paidAgorot: number;
  /** 'owed' for a lesson on or before asOf — what a parent actually owes. */
  dueAgorot: number;
  /** 'owed' for a lesson after asOf — booked, not yet given. */
  upcomingAgorot: number;
};

/* There is deliberately no `balanceAgorot: owed − paid` here. A lesson is one
   row whose status FLIPS owed → paid, so a settled lesson leaves the owed sum
   and enters the paid sum — the difference is not a balance, it is
   `−paid_so_far` once everything is settled. It read as a negative debt on the
   parent's board. What a family still owes is `dueAgorot`; what it has been
   charged in total is `paidAgorot + owedAgorot`. */

/* One SELECT shared by the per-account and all-account figures, so the
   tutor's headline total and a parent's balance can never be computed two
   different ways. `void` appears in no branch, which is what makes a
   cancelled lesson stop counting everywhere at once. */
const BALANCE_COLUMNS = `
  COALESCE(SUM(CASE WHEN status = 'owed' THEN amount_agorot END), 0) AS owed,
  COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_agorot END), 0) AS paid,
  COALESCE(SUM(CASE WHEN status = 'owed' AND date <= ? THEN amount_agorot END), 0) AS due,
  COALESCE(SUM(CASE WHEN status = 'owed' AND date >  ? THEN amount_agorot END), 0) AS upcoming
`;

type BalanceRow = { owed: number; paid: number; due: number; upcoming: number };

const toBalance = (row: BalanceRow): AccountBalance => ({
  owedAgorot: row.owed,
  paidAgorot: row.paid,
  dueAgorot: row.due,
  upcomingAgorot: row.upcoming,
});

/**
 * @param asOf `YYYY-MM-DD`. Passed in rather than read from the clock so the
 *             due/upcoming boundary is testable without freezing time, and
 *             so every figure on one page shares one notion of "today".
 */
export function balanceForAccount(accountId: number, asOf: string): AccountBalance {
  const row = handle().prepare(
    `SELECT ${BALANCE_COLUMNS} FROM payments WHERE account_id = ?`
  ).get(asOf, asOf, accountId) as BalanceRow;
  return toBalance(row);
}

/**
 * One child's figures, for the multi-child overview.
 *
 * `balanceForAccount` deliberately sums the whole family, which is the right
 * number for a parent's headline — but it would print the identical figure
 * on every child's card. Same shared columns, filtered one level down, so
 * the per-child cards and the family total cannot be computed two different
 * ways and disagree.
 */
export function balanceForStudent(studentId: number, asOf: string): AccountBalance {
  const row = handle().prepare(
    `SELECT ${BALANCE_COLUMNS} FROM payments WHERE student_id = ?`
  ).get(asOf, asOf, studentId) as BalanceRow;
  return toBalance(row);
}

/** The same query without the account filter — the tutor's headline figure.
 *  Deliberately not a sum over balanceForAccount in JavaScript: two code
 *  paths for one number is how the dashboard and the portal start to
 *  disagree. */
export function balanceAllAccounts(asOf: string): AccountBalance {
  const row = handle().prepare(
    `SELECT ${BALANCE_COLUMNS} FROM payments`
  ).get(asOf, asOf) as BalanceRow;
  return toBalance(row);
}

/**
 * Dates here are Israel's (see israelDay in $lib/dates.ts), never
 * `iso.slice(0, 10)`. Booking slots are minted with `toISOString()`,
 * so they carry a UTC date — and a lesson at 01:00 Israel time is on the
 * PREVIOUS day in UTC. Slicing would date its charge a day early, which
 * moves it across the due/upcoming boundary in §5 without anyone touching
 * the money. Today's booking windows happen to end at 21:00 (18:00Z, same
 * day) so a slice would work by luck; this does not depend on that luck
 * surviving a change to the windows.
 *
 * The date a lesson falls on, in the tutor's timezone.
 */
export const lessonDateInIsrael = (iso: string): string => israelDay(iso);

/** Today, for the due/upcoming boundary. */
export const todayInIsrael = (): string => israelToday();
