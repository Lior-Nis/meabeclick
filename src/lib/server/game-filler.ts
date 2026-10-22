/**
 * Catalog example games. The bodies live in `game_filler` (migration 030),
 * not in a file named after a student. `games/registry.json` points at the
 * generic id. A link already sent still carries the old id — the first
 * name was part of that id — and this map is what opens the same exercise.
 *
 * Per-lesson games are not in this table. They stay files under
 * DATA_DIR/games-data, and /app/play reads the file when this returns null.
 * The speed-drill example is one of those files
 * (seed/games-data/nikol-derivrules-speed.json).
 */
import { handle } from './db.ts';

export const GAME_FILLER_ALIASES: Readonly<Record<string, string>> = {
  'noga-derivatives-errorhunt': 'example-derivatives-errorhunt',
  'noga-derivatives-matching': 'example-derivatives-matching',
  'noga-derivatives-table': 'example-derivatives-table',
  'noga-derivgraphs-match': 'example-derivgraphs-match',
  'noga-functions-sort': 'example-functions-sort',
  'noga-integrals-memory': 'example-integrals-memory',
  'noga-integrals-quiz': 'example-integrals-quiz',
  'noga-integrals-sequence': 'example-integrals-sequence',
  'noga-integrals-twotruths': 'example-integrals-twotruths',
  'noga-parabola-labelling': 'example-parabola-labelling',
  'yonatan-fractions-numberline': 'example-fractions-numberline',
};

export function canonicalFillerId(dataId: string): string {
  return GAME_FILLER_ALIASES[dataId] ?? dataId;
}

/** The stored JSON, or null when this id is not a catalog example. */
export function readGameFiller(dataId: string): string | null {
  const id = canonicalFillerId(dataId);
  const row = handle().prepare(`SELECT body FROM game_filler WHERE id = ?`).get(id) as
    | { body: string }
    | undefined;
  return row?.body ?? null;
}
