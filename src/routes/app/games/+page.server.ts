/**
 * Port of pages/app/games.html — the games CATALOG (a tool for picking a
 * template), not a game. Requires a tutor session (spec §6): this is one of
 * the two /app/* pages that does, unlike /app/parent and /app/student.
 *
 * The old page fetched /games/registry.json client-side with no auth at
 * all — the catalog is now gated the same way /app/dashboard is, per spec.
 *
 * registry.json is checked-in config, not runtime-written content (it does
 * not live under DATA_DIR — see spec §7), so it is imported directly rather
 * than served through a content route.
 *
 * Each ready template's "try the example" link needs a real
 * /app/play/[template] URL, which — per src/lib/server/urls.ts — must be
 * signed. Signing requires the HMAC secret, which is server-only, so the
 * link is built here rather than in the client script the old page used.
 * There is no real "assigned student" for a catalog preview, so the
 * signature is minted for a placeholder demo identity; nothing depends on
 * that identity being real until a lesson is actually assigned. (The
 * template page these links point at, /app/play/[template], is ported in a
 * later task — until then these links 404, same as any other homework link
 * would before that route exists.)
 *
 * Reads the registry through src/lib/server/lesson/registry.ts — the same
 * typed access the lesson-generation pipeline uses — rather than a second,
 * independent read of games/registry.json.
 */
import { requireAuth } from '$server/auth.ts';
import { gameUrl } from '$server/urls.ts';
import { getRegistry } from '$server/lesson/registry.ts';
import type { PageServerLoad } from './$types';

const DEMO_STUDENT = 'דוגמה';

export interface CatalogEntry {
  key: string;
  title: string;
  ready: boolean;
  bestFor: string;
  ageRange: [number, number];
  itemRange: [number, number];
  exampleUrl: string | null;
}

export const load: PageServerLoad = async (event) => {
  requireAuth(event);

  const entries: CatalogEntry[] = Object.entries(getRegistry().templates).map(([key, t]) => {
    const ready = t.status === 'ready';
    let exampleUrl: string | null = null;
    if (ready && t.example) {
      try {
        exampleUrl = gameUrl({ template: key, dataId: t.example, student: DEMO_STUDENT });
      } catch {
        exampleUrl = null;
      }
    }
    return {
      key,
      title: t.title,
      ready,
      bestFor: t.bestFor ?? '',
      ageRange: t.ageRange ?? [0, 0],
      itemRange: t.itemRange ?? [0, 0],
      exampleUrl,
    };
  });

  return {
    ready: entries.filter(e => e.ready),
    soon: entries.filter(e => !e.ready),
  };
};
