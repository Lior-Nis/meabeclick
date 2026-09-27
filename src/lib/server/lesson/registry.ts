/**
 * Typed access to games/registry.json — the matching layer between lesson
 * generation and the game templates. It tells the lesson-prep pipeline which
 * game type fits which learning goal, and exactly what data shape each
 * template needs.
 *
 * Read lazily, on first use (getRegistry()) — NOT at module load. This used
 * to be a top-level `JSON.parse(readFileSync(...))`, which meant importing
 * this module at all, for any reason, crashed immediately if
 * games/registry.json was absent or invalid. That fragility was flagged and
 * deferred back in Task 11's review; Task 18 is what actually exercised it,
 * when the /app/games catalog page became this module's first real caller.
 * Task 21's boot check (src/lib/server/boot-checks.ts) now WARNS rather
 * than throws on a bad registry.json, specifically so a booking — which
 * never touches this file — is not taken down by a broken games manifest;
 * that guarantee only holds if importing this module can't itself blow up,
 * hence lazy. getRegistry() caches after the first successful read, so
 * repeated calls (isKnownTemplate on every /app/play/[template] request)
 * don't re-read the file.
 *
 * Path resolved from process.cwd(), not import.meta.url: this module had no
 * real caller until task 18 (the /app/games catalog page) gave it one, and
 * that first real use caught `npm run build` failing — the adapter-node
 * build inlines this module into whichever route bundle imports it, and
 * that bundled chunk's import.meta.url is the OUTPUT file's path
 * (.svelte-kit/output/server/entries/pages/app/games/...), four `..`
 * segments up from which is not the repo root. cwd is what dataDir() in
 * content.ts already resolves `./data` against (both `npm run dev` and the
 * built `node build/index.js` start from the project root), so this
 * matches that precedent instead of introducing a second, bundler-fragile
 * scheme.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REGISTRY_PATH = join(process.cwd(), 'games', 'registry.json');

export interface RegistryTemplate {
  title: string;
  status: string;
  bestFor?: string;
  itemRange?: [number, number];
  ageRange?: [number, number];
  dataSchema?: unknown;
  notes?: string;
  example?: string;
  name?: string;
}

export interface SelectionRule {
  when: string;
  use: string;
  goal: string;
}

export interface Registry {
  version: number;
  urlPattern: string;
  selection: { rules: SelectionRule[]; fallback: string };
  templates: Record<string, RegistryTemplate>;
  conventions?: Record<string, string>;
}

let cached: Registry | null = null;

/** Reads and parses games/registry.json on first call, caching the result
 *  for the life of the process; every later call returns the cached value
 *  without touching the filesystem again. Throws (ENOENT / SyntaxError)
 *  if the file is missing or invalid — callers that need graceful
 *  degradation (there are none today; both current callers are routes
 *  where an uncaught throw correctly becomes a 500 for that route only)
 *  should catch around this, not the boot check, which only warns. */
export function getRegistry(): Registry {
  if (!cached) {
    // The `as Registry` is load-bearing, not decorative: JSON.parse
    // returns `any`, and assigning an `any` to a variable whose declared
    // type is `Registry | null` widens it right back to the full declared
    // type instead of narrowing — without the cast, TS can't prove `cached`
    // is non-null on the `return` below.
    cached = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')) as Registry;
  }
  return cached;
}

/** True when `template` names a known, playable template file — used to
 *  reject an unknown template before it ever reaches a route handler. */
export function isKnownTemplate(template: string): boolean {
  return Object.prototype.hasOwnProperty.call(getRegistry().templates, template);
}
