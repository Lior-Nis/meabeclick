// Every host path the app service mounts must be excluded from the Docker
// build context.
//
// Written after a deploy failed outright at `docker compose up -d --build`:
//
//   #5 [internal] load build context
//   #5 ERROR: error from sender: open /home/meabeclick/mea-beclick/codex-home:
//              permission denied
//
// codex-home holds live Codex credentials, so it is mode 700 owned by the
// container's uid — which means the *host* user that runs the deploy cannot
// read it. Docker sends the whole context before it builds anything, so an
// unreadable directory anywhere in the tree is not a warning, it is a failed
// deploy with nothing built.
//
// The general rule the failure taught: a runtime bind mount is never a build
// input. It is either unreadable (credentials), enormous (data/), or stale
// the moment it is copied. `data` and `service-account.json` were already
// excluded for exactly these reasons; this test is what makes the next one
// impossible to forget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The `app:` service block — the only service built from our Dockerfile, so
 *  the only one whose mounts touch the build context. caddy runs a public
 *  image and has no context of its own. */
function appServiceBlock(compose) {
  const lines = compose.split('\n');
  const start = lines.findIndex(l => /^ {2}app:\s*$/.test(l));
  assert.notEqual(start, -1, 'docker-compose.yml no longer has an `app:` service — update this test');
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}\S/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

test('every host bind mount of the app service is out of the build context', async () => {
  const compose = await readFile(join(root, 'docker-compose.yml'), 'utf8');
  const ignored = (await readFile(join(root, '.dockerignore'), 'utf8'))
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));

  // `- ./host/path:/container/path[:ro]` entries, host side only.
  const mounts = [...appServiceBlock(compose).matchAll(/^\s*-\s+\.\/([^:\s]+):/gm)].map(m => m[1]);
  assert.ok(mounts.length >= 3, `expected the app service to still have bind mounts, found ${mounts.length}`);

  for (const mount of mounts) {
    // A .dockerignore entry excludes the path itself and everything under it,
    // so a mount is covered by its own name or by any parent directory.
    const segments = mount.split('/');
    const covered = segments.some((_, i) => ignored.includes(segments.slice(0, i + 1).join('/')));
    assert.ok(covered, `docker-compose.yml mounts ./${mount} but .dockerignore does not exclude it — ` +
      'a runtime mount in the build context breaks `docker compose up --build` on the VPS');
  }
});

test('the credential mounts specifically are excluded', async () => {
  // Named outright rather than left to the loop above: these two are the ones
  // whose permissions make the failure a hard stop rather than slow bloat,
  // and a future edit that drops one should fail with an obvious message.
  const ignored = await readFile(join(root, '.dockerignore'), 'utf8');
  for (const path of ['codex-home', 'service-account.json', 'data']) {
    assert.match(ignored, new RegExp(`^${path}$`, 'm'), `.dockerignore must exclude ${path}`);
  }
});
