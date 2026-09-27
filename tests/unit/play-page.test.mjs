import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

// The loader below (src/routes/app/play/[template]/+page.server.ts) imports
// via the `$server/...` alias, same as any route file — only src/lib/
// server/** itself is relative-imports-only. That alias is resolved by
// SvelteKit's Vite build (svelte.config.js: `alias: { $server:
// 'src/lib/server' }`), which plain `node --test` knows nothing about.
// Register a resolve hook — scoped to this process only, mirroring exactly
// the one alias svelte.config.js already declares — so the unmodified
// loader loads and runs for real, the same technique
// tests/unit/results-write-path.test.mjs uses.
const SERVER_ROOT = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), '../../src/lib/server') + '/',
).href;
const loaderSource = `
  export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('$server/')) {
      const rest = specifier.slice('$server/'.length);
      return nextResolve(new URL(rest, ${JSON.stringify(SERVER_ROOT)}).href, context);
    }
    return nextResolve(specifier, context);
  }
`;
register(`data:text/javascript,${encodeURIComponent(loaderSource)}`, import.meta.url);

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'play-')), 'results.db');
process.env.SESSION_SECRET = 'test-secret-for-signing';

// The loader also reads the game data file through $server/content.ts,
// which resolves games-data/<dataId>.json under DATA_DIR (see
// src/lib/server/content.ts and src/lib/server/paths.ts). Point it at a
// scratch dir carrying exactly one such file.
const DATA_DIR = await mkdtemp(join(tmpdir(), 'play-data-'));
process.env.DATA_DIR = DATA_DIR;
await mkdir(join(DATA_DIR, 'games-data'), { recursive: true });
await writeFile(
  join(DATA_DIR, 'games-data', 'quiz1.json'),
  JSON.stringify({ title: 'חידון', subject: 'מתמטיקה' }),
);

const E = await import('../../src/lib/server/entities.ts');
const R = await import('../../src/lib/server/results.ts');
const U = await import('../../src/lib/server/urls.ts');
const D = await import('../../src/lib/server/db.ts');
const { load } = await import('../../src/routes/app/play/[template]/+page.server.ts');

const acct = E.createAccount({ name: 'משפחה', credential: 'x' });
const noga = E.createStudent({ code: 'noga', name: 'נוגה', accountId: acct.id, credential: 'p' });

/** Builds the URL object load() receives, exactly as the real router would
 *  populate it from a signed `?d=&s=&t=` link — the signature comes from a
 *  real gameUrl() (urls.ts), never reimplemented. */
function urlFor(student, dataId = 'quiz1') {
  const path = U.gameUrl({ template: 'quiz', dataId, student });
  return new URL(`http://x${path}`);
}

test('getBest returns the highest score for that student and game', () => {
  R.writeResult({ studentId: noga.id, dataId: 'g1', template: 'quiz', score: 4, total: 10 });
  R.writeResult({ studentId: noga.id, dataId: 'g1', template: 'quiz', score: 9, total: 10 });
  R.writeResult({ studentId: noga.id, dataId: 'g1', template: 'quiz', score: 6, total: 10 });
  assert.equal(R.getBest(noga.id, 'g1'), 9);
});

test('getBest returns null for a game never played', () => {
  assert.equal(R.getBest(noga.id, 'never-played'), null);
});

test("getBest does not read another student's score", () => {
  const dan = E.createStudent({ code: 'dan', name: 'דן', accountId: acct.id, credential: 'p' });
  R.writeResult({ studentId: dan.id, dataId: 'g2', template: 'quiz', score: 10, total: 10 });
  assert.equal(R.getBest(noga.id, 'g2'), null);
});

test('a best survives the link switching from a display name to a code', () => {
  // The regression this guards: a child plays under ?s=נוגה, links switch to
  // ?s=noga, and their personal best resets to nothing. Both references
  // resolve to the same id, so the best is the same.
  R.writeResult({ studentId: noga.id, dataId: 'g3', template: 'quiz', score: 8, total: 10 });
  const viaName = R.resolveStudent('נוגה');
  const viaCode = R.resolveStudent('noga');
  assert.equal(viaName, viaCode);
  assert.equal(R.getBest(viaCode, 'g3'), 8);
});

test('a code resolves to the Hebrew display name for the page subtitle', () => {
  const id = R.resolveStudent('noga');
  assert.equal(R.studentRefById(id).name, 'נוגה');
});

test('the real play-page loader renders the Hebrew name (not the code) for a code-carrying link, and reads id-keyed best', async () => {
  R.writeResult({ studentId: noga.id, dataId: 'quiz1', template: 'quiz', score: 9, total: 10 });

  const result = await load({ params: { template: 'quiz' }, url: urlFor('noga') });

  assert.ok(
    result.subject.includes('נוגה'),
    `expected the Hebrew display name in subject, got: ${result.subject}`,
  );
  assert.ok(
    !result.subject.includes('noga'),
    `the code must not leak into the child-facing subject, got: ${result.subject}`,
  );
  assert.equal(result.best, 9, 'best must come from the id-keyed results_v2 history');
});

test('the real play-page loader still renders an old display-name-carrying link, falling back for both name and best', async () => {
  // Two students sharing a first name: unresolvable by name, exactly the
  // shape an old (pre-code) link can carry and the loader must not crash on.
  const orA = E.createStudent({ code: 'or-a', name: 'אור', accountId: acct.id, credential: 'p' });
  E.createStudent({ code: 'or-b', name: 'אור', accountId: acct.id, credential: 'p' });
  assert.equal(R.resolveStudent('אור'), null, 'the fixture must actually be ambiguous');

  // A legacy score, written directly into the retired name-keyed table this
  // loader's `best` ternary falls back to reading (`getBest` from db.ts) so
  // the assertion doesn't depend on a second production write path.
  D.handle().prepare(`
    INSERT INTO results (student, at, data_id, template, score, total)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('אור', new Date().toISOString(), 'quiz1', 'quiz', 5, 10);

  const result = await load({ params: { template: 'quiz' }, url: urlFor('אור') });

  assert.ok(
    result.subject.includes('אור'),
    `an unresolvable old link must still render the raw name it carries, got: ${result.subject}`,
  );
  assert.equal(result.best, 5, 'an unresolvable link must fall back to the legacy name-keyed best');
  void orA;
});
