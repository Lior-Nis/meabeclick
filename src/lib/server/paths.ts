/**
 * Root directory for student portal files (one JSON per student), the one
 * place that path is computed.
 *
 * Overridable via PORTAL_DIR so the characterization test suite can point
 * bookings and portal reads at a scratch directory instead of the real,
 * tracked portal/ directory, which holds actual student PII. Left unset,
 * this resolves to exactly the on-disk path every caller used before this
 * override existed — nothing about production behavior changes.
 *
 * This is the seed of the centralized content module (`src/lib/server/
 * content.ts`) the SvelteKit migration introduces once portal/ moves under
 * DATA_DIR — see docs/superpowers/specs/2026-08-27-sveltekit-migration-design.md.
 *
 * NOT expressed in terms of content.ts's `contentPath('portal', code)`,
 * even though the shapes look identical (`<dir>/portal/<code>.json`):
 * folding it in would change the default, PORTAL_DIR-unset path. Today
 * that default is `<repo root>/portal` (via SITE, computed from this
 * file's own location); `contentPath`'s default root is `dataDir()`,
 * which falls back to `./data` relative to the process's cwd — a
 * different directory. Silently moving where student PII portal files
 * resolve to, for every deployment that leaves PORTAL_DIR unset, is
 * exactly the kind of drift this module exists to prevent, so this
 * function is left alone on purpose.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export function portalDir(): string {
  return process.env.PORTAL_DIR || join(SITE, 'portal');
}
