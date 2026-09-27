/**
 * Shared-secret check for the two timer-driven endpoints
 * (POST /api/reports/prompt, GET /api/remind). Both are reachable from the
 * internet and driven by a systemd timer rather than a person, so neither
 * has a session cookie to check — this is the whole door.
 *
 * Constant-time, and closed when no key is configured: a missing
 * CRON_KEY must never mean "no check".
 */
import { timingSafeEqual } from 'node:crypto';

export function authorizedCronRequest(given: string | null): boolean {
  const expected = process.env.CRON_KEY ?? '';
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
