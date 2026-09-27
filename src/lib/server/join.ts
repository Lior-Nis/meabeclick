/**
 * Join codes — the fallback path for getting a child onto their own board.
 *
 * The primary path is a link the parent forwards from their own phone. A
 * code exists for the family shapes that path does not fit: a child with no
 * WhatsApp, a shared family tablet, a school Chromebook, or a child who
 * cleared their browser and needs back in without waiting for a parent to
 * re-send anything.
 *
 * It is deliberately short enough to read aloud across a room, which is
 * exactly why it is single-use and expires in a week — a code that can be
 * overheard must stop working shortly after it has done its job.
 */

import { randomInt } from 'node:crypto';
import {
  insertJoinCode, activeJoinCodeForStudent, redeemJoinCode as redeem,
  type StudentRow,
} from './entities.ts';

/** No O/0, I/1, or L: the code gets read aloud and copied by hand, and
 *  every one of those pairs turns into a support message. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LENGTH = 6;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** randomInt, not Math.random: this is an access token, and a predictable
 *  generator would make the whole codespace walkable from one observed code. */
function generate(): string {
  let out = '';
  for (let i = 0; i < LENGTH; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** `K7M2QP` → `K7M-2QP`. Display only — never stored, never compared. */
export function formatJoinCode(code: string): string {
  return code.length === LENGTH ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}

/** Accepts whatever the child actually typed: lowercase, spaces, the
 *  display hyphen, or a pasted code with a stray newline. */
export function normalizeJoinCode(input: unknown): string {
  return String(input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * The code a parent should show for this student — the existing unused one
 * when there is one, otherwise a fresh code.
 *
 * Reusing matters: a parent who reads the code to their child, then
 * refreshes the page, must not find a different code on screen while the
 * child is typing the first one.
 */
export function joinCodeForStudent(studentId: number): string {
  const now = new Date();
  const existing = activeJoinCodeForStudent(studentId, now.toISOString());
  if (existing) return existing.code;

  // A collision would throw on the PRIMARY KEY. At 31^6 it is vanishingly
  // unlikely, but retrying is cheaper than a 500 in a parent's face.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const row = insertJoinCode({
        code: generate(),
        studentId,
        expiresAt: new Date(now.getTime() + TTL_MS).toISOString(),
      });
      return row.code;
    } catch {
      /* collision — try another */
    }
  }
  throw new Error('join: could not allocate a code');
}

/** The student this code admits, or null if it was unknown, expired, or
 *  already used. Callers must not distinguish those cases to the visitor:
 *  saying which one is a probe oracle for guessing live codes. */
export function claimJoinCode(input: unknown): StudentRow | null {
  const code = normalizeJoinCode(input);
  if (code.length !== LENGTH) return null;
  return redeem(code, new Date().toISOString());
}
