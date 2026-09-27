#!/usr/bin/env node
/**
 * Convert a portal JSON file's `homework` and `games` entries from the
 * legacy { url } shape to the new { template, dataId } shape src/lib/
 * server/urls.ts's gameUrl() now derives URLs from.
 *
 * Idempotent: an entry that has already been converted (no `url` field)
 * is left untouched, so this is safe to run more than once, or against a
 * file that mixes old-shape and new-shape entries.
 *
 * The exact recipe (which regex, which fields survive) is the hand-edit
 * commit 91bbf2a made to the repo's portal/noga.json, generalized so it
 * can run against the LIVE VPS copy instead — see ruling P13 and
 * server/README.md's "Cutover from the Express deployment" section, step
 * 3. That hand-edit only touched the repo copy; production kept reading
 * the VPS's old-shape file, whose game links pointed at deleted
 * games/*.html files. This script is what step 3 actually runs.
 *
 * Usage:
 *   node scripts/migrate-portal-shape.mjs <portal-file.json> [...more]
 *
 * Run this against data/portal/<code>.json on the VPS (or a local copy of
 * it), not the repo's portal/<code>.json — the repo copy was already
 * migrated by hand in 91bbf2a and is only kept as the seed for a *fresh*
 * install (see server/README.md's Install section).
 */
import { readFile, writeFile } from 'node:fs/promises';

// What server/lesson-queue.mjs used to bake directly into portal/<code>.json
// and the `lessons` table's `games` column: "games/<template>.html?d=<dataId>
// &s=<student>". The template is the .html file's basename; dataId is the
// raw `d` query param (percent-decoded, in case a caller ever encoded it).
const LEGACY_URL = /^games\/([a-z0-9-]+)\.html\?d=([^&]+)(?:&s=.*)?$/;

/**
 * Converts one homework/games entry in place-equivalent fashion (returns a
 * new object; never mutates the input). Anything that isn't the exact
 * legacy shape — including an already-migrated {template,dataId} entry,
 * which has no `url` field at all — is returned unchanged rather than
 * guessed at.
 */
export function migrateEntry(entry) {
  if (entry === null || typeof entry !== 'object') return entry;
  if (typeof entry.url !== 'string') return { ...entry };
  const match = LEGACY_URL.exec(entry.url);
  if (!match) return { ...entry };
  const [, template, dataId] = match;
  const { url, ...rest } = entry;
  return { ...rest, template, dataId: decodeURIComponent(dataId) };
}

/** Converts every entry in a portal record's `homework` and `games`
 *  arrays (the only two places game refs are stored). Returns a new
 *  object; never mutates the input. */
export function migratePortalShape(portal) {
  const out = { ...portal };
  for (const key of ['homework', 'games']) {
    if (Array.isArray(out[key])) {
      out[key] = out[key].map(migrateEntry);
    }
  }
  return out;
}

async function migrateFile(path) {
  const raw = await readFile(path, 'utf8');
  const portal = JSON.parse(raw);
  const migrated = migratePortalShape(portal);
  await writeFile(path, `${JSON.stringify(migrated, null, 2)}\n`, 'utf8');
}

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('usage: node scripts/migrate-portal-shape.mjs <portal-file.json> [...]');
    process.exitCode = 1;
    return;
  }
  for (const file of files) {
    await migrateFile(file);
    console.log(`migrated ${file}`);
  }
}

// Only run as a CLI, not when imported by the test suite.
if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
