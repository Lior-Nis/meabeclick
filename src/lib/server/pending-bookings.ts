/**
 * A booking held until its family confirms it — see migration 021 and
 * docs/superpowers/specs/2026-09-28-confirm-known-email-booking-design.md.
 *
 * Holding is what OVERLAP_SOURCE (entities.ts) reads; confirming is one
 * atomic claim, after which /api/book books the stored body the ordinary way.
 */
import { handle } from './db.ts';
import { mintPendingToken } from './family-auth.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A day from `now`, or the lesson's start if that comes first: a hold
 *  never outlives the lesson it is for. */
export function holdExpiry(now: Date, start: string): string {
  const dayLater = now.getTime() + DAY_MS;
  const lesson = Date.parse(start);
  return new Date(Number.isFinite(lesson) ? Math.min(dayLater, lesson) : dayLater).toISOString();
}

export interface HeldBooking {
  id: number;
  accountId: number;
  body: Record<string, unknown> & { start: string; end: string };
  expiresAt: string;
}

/** Holds the hour. The caller has already checked it is free, with no
 *  `await` in between — the same rule as reserveBooking. */
export function holdBooking(h: {
  accountId: number;
  body: Record<string, unknown> & { start: string; end: string };
  now?: Date;
}): number {
  const now = h.now ?? new Date();
  const info = handle().prepare(`
    INSERT INTO pending_bookings (account_id, body, start, "end", at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(h.accountId, JSON.stringify(h.body), h.body.start, h.body.end,
         now.toISOString(), holdExpiry(now, h.body.start));
  return Number(info.lastInsertRowid);
}

type Row = { id: number; account_id: number; body: string; expires_at: string };
const toHeld = (r: Row): HeldBooking => ({
  id: r.id, accountId: r.account_id, body: JSON.parse(r.body), expiresAt: r.expires_at,
});
const LIVE = `status = 'pending' AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

/** A hold that can still be confirmed, or null. */
export function pendingById(id: number): HeldBooking | null {
  const r = handle().prepare(`SELECT id, account_id, body, expires_at FROM pending_bookings WHERE id = ? AND ${LIVE}`)
    .get(id) as Row | undefined;
  return r ? toHeld(r) : null;
}

/** Claims a live hold, once: the second click, a replay or an expired hold
 *  gets null. Claiming releases the hour, for the booking to take. */
export function claimPending(id: number): HeldBooking | null {
  const held = pendingById(id);
  if (!held) return null;
  const changed = handle().prepare(`UPDATE pending_bookings SET status = 'confirmed' WHERE id = ? AND ${LIVE}`).run(id).changes;
  return changed === 1 ? held : null;
}

/** The link in the confirmation email. */
export function confirmLink(held: { id: number; expiresAt: string }): string {
  const token = mintPendingToken(held.id, Date.parse(held.expiresAt));
  const site = (process.env.SITE_URL ?? '').replace(/\/+$/, '');
  return `${site}/confirm-booking?t=${token}`;
}
