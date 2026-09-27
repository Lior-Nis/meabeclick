/**
 * The single place generated content — lesson slides, game data, unreviewed
 * drafts — is read off disk once it moves under DATA_DIR. Portal files are
 * NOT handled here — see `portalDir()` in `paths.ts` for why they're kept
 * on their own, separately-configured path instead of folded into this
 * module's `contentPath()`.
 *
 * Why this exists: SvelteKit's `static/` directory is copied into the build
 * at BUILD time, but this app writes lessons, game data and drafts at
 * RUNTIME (server/lesson-queue.mjs). Anything under `static/` 404s the
 * moment it's generated after the last deploy — it has to be served
 * through a route instead.
 *
 * More importantly, this inverts today's protection model. `server/app.mjs`
 * blocks `/Students`, `/students` and `/portal` with an opt-out deny-list —
 * both added REACTIVELY after student material was found publicly served on
 * the old Vercel deployment. A route only exists for what's explicitly
 * wired up here, so a future generated directory is private by default
 * instead of public until someone remembers to block it.
 *
 * Every caller-supplied identifier (a slug, a game data id) is checked
 * against the same allowlist `urls.ts` already uses to mint
 * these URLs (`assertPathSegment` — lowercase letters, digits, hyphens
 * only; imported, not duplicated). It's an allowlist rather than a `..`
 * blacklist because a blacklist misses encodings (`..%2F`, `%2e%2e`,
 * unicode variants) — the allowlist has no such gaps because it's
 * exhaustive about what's admitted, not what's excluded.
 *
 * The `.json` / `.html` suffix each kind reads is a fixed literal this
 * module appends AFTER validation, never something threaded through the
 * regex — an id like "noga-integrals-quiz" must pass the same strict
 * charset a bare slug does; the file that id resolves to is this module's
 * business, not the caller's.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertPathSegment } from './urls.ts';

// process.env, not `$env/dynamic/private`: that import is a Vite virtual
// module and would make this file unimportable by `node --test`, which is
// how this module's own unit tests load it (ruling P2, same reasoning as
// urls.ts).
export const dataDir = (): string => process.env.DATA_DIR ?? './data';

// A draft directory only ever holds these two files (see publishDraftOnly
// in server/lesson-queue.mjs and src/lib/server/lesson/queue.ts) — an exact
// allowlist of filenames is stronger than a regex permitting "any single
// extension" and needs no separate charset rule for the dot.
const DRAFT_FILES = new Set(['slides.html', 'lesson.json']);

/**
 * The one place a generated-content kind maps to an on-disk path. Both the
 * reader (`readContent`, below) and the writer (`src/lib/server/lesson/
 * queue.ts`) resolve through this — not two independent copies of the same
 * layout, which is exactly how the write side and the read side drifted:
 * Task 11 ported the queue mechanically, before DATA_DIR existed, so it
 * kept writing to the pre-migration `SITE_ROOT`-relative locations while
 * this module's read side (Task 12) was defined against DATA_DIR. Nothing
 * caught it because the characterization suite disables generation, and
 * click-through only exercises game data that had already been moved.
 * `portalDir()` in `paths.ts` is deliberately NOT folded in here — see its
 * doc comment.
 */
export function contentPath(
  kind: 'lessons' | 'games-data' | 'drafts',
  ...segments: string[]
): string {
  switch (kind) {
    case 'games-data': {
      const [id] = segments;
      assertPathSegment('id', id ?? '');
      return join(dataDir(), 'games-data', `${id}.json`);
    }
    case 'lessons': {
      const [slug] = segments;
      assertPathSegment('slug', slug ?? '');
      return join(dataDir(), 'lessons', slug, 'slides.html');
    }
    case 'drafts': {
      const [slug, file] = segments;
      assertPathSegment('slug', slug ?? '');
      if (!file || !DRAFT_FILES.has(file)) {
        throw new Error('content: illegal draft file');
      }
      return join(dataDir(), 'drafts', slug, file);
    }
    default:
      throw new Error(`content: unknown kind ${kind}`);
  }
}

export async function readContent(
  kind: 'lessons' | 'games-data' | 'drafts',
  ...segments: string[]
): Promise<Buffer> {
  return readFile(contentPath(kind, ...segments));
}
