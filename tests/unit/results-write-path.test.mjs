import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

// The route file below imports via the `$server/...` alias — route files
// under src/routes/** do that normally (see the task's global constraints);
// only src/lib/server/** is relative-imports-only. That alias is resolved
// by SvelteKit's Vite build (svelte.config.js: `alias: { $server:
// 'src/lib/server' }`), which plain `node --test` knows nothing about: an
// unadapted `await import('.../+server.ts')` fails immediately with
// "Cannot find package '$server'", before the handler's call shape ever
// comes into play. Rather than weaken this test to avoid the real route
// file (e.g. by re-implementing its logic, or asserting only on the HTTP
// response), register a resolve hook — scoped to this process only, and
// mirroring exactly the one alias svelte.config.js already declares — so
// the unmodified route module loads and runs for real.
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

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'res-write-')), 'results.db');
process.env.SESSION_SECRET = 'test-secret-for-signing';

const E = await import('../../src/lib/server/entities.ts');
const D = await import('../../src/lib/server/db.ts');
const U = await import('../../src/lib/server/urls.ts');
const { POST } = await import('../../src/routes/api/game-result/+server.ts');

const acct = E.createAccount({ name: 'משפחה', credential: 'x' });
const noga = E.createStudent({ code: 'noga', name: 'נוגה', accountId: acct.id, credential: 'p' });
E.createStudent({ code: 'or-a', name: 'אור', accountId: acct.id, credential: 'p' });
E.createStudent({ code: 'or-b', name: 'אור', accountId: acct.id, credential: 'p' });

/** A real signed submission, exactly as a game posts one.
 *  `sign()` is private to urls.ts, so the signature is taken from a real
 *  gameUrl() rather than re-implemented — a copied signer would only ever
 *  test itself. */
function post(student, dataId) {
  const t = new URL(`http://x${U.gameUrl({ template: 'quiz', dataId, student })}`)
    .searchParams.get('t');
  const request = new Request('http://localhost/api/game-result', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ student, dataId, t, template: 'quiz', score: 7, total: 10 }),
  });
  return POST({ request });
}

const v2Rows = () => D.handle().prepare(`SELECT * FROM results_v2`).all();
const legacyRows = () => D.handle().prepare(`SELECT * FROM results`).all();

test('a play submitted under a code lands in results_v2 with the student id', async () => {
  const res = await post('noga', 'code-quiz');
  assert.equal(res.status, 200);

  const row = v2Rows().find(r => r.data_id === 'code-quiz');
  assert.ok(row, 'expected a results_v2 row');
  assert.equal(row.student_id, noga.id);
  assert.equal(row.score, 7);
  assert.equal(legacyRows().some(r => r.data_id === 'code-quiz'), false);
});

test('an old link carrying a unique display name also lands in results_v2', async () => {
  await post('נוגה', 'name-quiz');

  const row = v2Rows().find(r => r.data_id === 'name-quiz');
  assert.ok(row, 'a resolvable old link must still be attributed');
  assert.equal(row.student_id, noga.id);
});

test('a play under a shared name falls back to the legacy table rather than being dropped', async () => {
  await post('אור', 'shared-quiz');

  assert.equal(v2Rows().some(r => r.data_id === 'shared-quiz'), false);
  const row = legacyRows().find(r => r.data_id === 'shared-quiz');
  assert.ok(row, 'an unresolvable play must still be stored, never dropped');
  assert.equal(row.student, 'אור');
});

test('an unresolvable play still reaches the tutor through readResults', async () => {
  await post('אור', 'shared-quiz-2');
  assert.ok(D.readResults()['אור'], 'finished homework must not look broken');
});
