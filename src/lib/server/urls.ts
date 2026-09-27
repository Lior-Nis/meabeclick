/**
 * The single place every game and lesson URL is built and signed.
 *
 * Why this exists: today `portal/noga.json` and the `lessons` table's
 * `games` column persist raw URL strings (`games/memory.html?d=...&s=...`)
 * directly into data. Any URL scheme change silently breaks stored records,
 * and nothing catches it — the portal endpoint faithfully returns whatever
 * is on disk. The fix is that records store FACTS (`GameRef` — template +
 * dataId) and URLs are DERIVED here, at render time, in one place.
 *
 * That centralization also makes a real security fix nearly free: game
 * results are forgeable today (`/api/game-result` accepts any anonymous
 * POST). Games are opened from a WhatsApp link with no session, so there is
 * nothing to authenticate against — but because every game URL is minted
 * here, this module can sign it, and the result endpoint can verify the
 * signature came from a legitimately issued assignment. The signature also
 * carries which student is asking, which a later task uses to look up a
 * personal best from the database instead of a localStorage value that
 * WhatsApp's in-app browser wipes between sessions.
 */

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

// process.env, not `$env/dynamic/private`: that import is a Vite virtual
// module and would make this file unimportable by `node --test`, which is
// how this module's own unit tests load it (ruling P2).
//
// If SESSION_SECRET is unset, signing with an empty secret would produce
// signatures anyone can reproduce (an HMAC keyed with '' needs no secret
// knowledge to forge). Instead fall back to a random secret generated once
// at module load, matching the precedent in auth.ts: signed URLs still
// can't be forged, the only cost is that they stop verifying across a
// server restart. Warn so the gap is visible in logs, same as auth.ts.
const SECRET = process.env.SESSION_SECRET || randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('SESSION_SECRET is not set — using a random one, so game links invalidate on restart.');
}

export type GameRef = { template: string; dataId: string };

// Path segments (unlike query params, which URLSearchParams percent-encodes
// safely) are interpolated directly into the URL this module mints. Those
// URLs go out over email and WhatsApp and are later trusted for signature
// verification, so this module does not depend on every present and future
// caller remembering to sanitize its input before calling in — it enforces
// the shape itself and throws loudly on anything else, rather than silently
// minting a traversal-shaped URL like `/app/play/../../etc/passwd`.
const PATH_SEGMENT = /^[a-z0-9-]+$/;

// Exported so other modules that mint or read filesystem/URL segments
// (src/lib/server/content.ts) reuse this exact allowlist instead of
// maintaining a second copy that could quietly drift out of sync.
export function assertPathSegment(name: string, value: string): void {
  if (!PATH_SEGMENT.test(value)) {
    // Keep the message short — do not echo the offending value, which may
    // be arbitrarily long or attacker-controlled.
    throw new Error(`urls: invalid ${name}`);
  }
}

/**
 * Signed over the PAIR (dataId, student) — not either alone, and not their
 * naive concatenation. A plain `${dataId} ${student}` delimiter is
 * spoofable: dataId="a b", student="c" and dataId="a", student="b c" hash
 * to the identical string "a b c". Length-prefixing each field before
 * hashing removes that ambiguity — the byte length is part of what's
 * signed, so no split of the same bytes across the two fields can collide.
 */
function sign(dataId: string, student: string): string {
  const msg = `${dataId.length}:${dataId}|${student.length}:${student}`;
  return createHmac('sha256', SECRET).update(msg).digest('base64url');
}

export function gameUrl({ template, dataId, student }: GameRef & { student: string }): string {
  assertPathSegment('template', template);
  const q = new URLSearchParams({ d: dataId, s: student, t: sign(dataId, student) });
  return `/app/play/${template}?${q}`;
}

export function verifyGameSignature({
  dataId,
  student,
  t,
}: {
  dataId: string;
  student: string;
  t: string | null | undefined;
}): boolean {
  if (!t) return false;
  const want = Buffer.from(sign(dataId, student));
  const got = Buffer.from(t);
  // Length check before timingSafeEqual: it throws on mismatched lengths
  // rather than returning false.
  return got.length === want.length && timingSafeEqual(got, want);
}

export function lessonUrl(slug: string): string {
  assertPathSegment('slug', slug);
  return `/lessons/${slug}`;
}

/** The student portal page for a given student code, e.g. "/portal?s=noga". */
export function portalLink(code: string): string {
  assertPathSegment('code', code);
  return `/portal?s=${code}`;
}
