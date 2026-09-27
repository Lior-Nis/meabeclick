// The deploy pipeline's two halves have to agree, and nothing else checks it.
//
// CI builds an image and tags it; the VPS pulls a tag and runs it. Those are
// written in different files, in different languages, and neither is
// exercised by any test — the whole pipeline is only ever tried in
// production. Two faults this pins:
//
//   1. compose pinned a bare `:latest` while `git pull` fetched a specific
//      commit. Two merges landing close together could leave the running
//      image AHEAD of the checkout, with nothing failing to say so.
//   2. the workflow ran only on pushes to main, so pull requests reported
//      "no checks reported" — CI could not gate a PR it never ran on, and
//      every PR had to be verified by hand.
//   3. APP_TAG had a `:-latest` default, so a hand-run `docker compose up -d`
//      started the LOCALLY CACHED :latest without pulling. On 2026-09-18
//      that rolled production back to an image predating both the
//      /api/reports/prompt route and the cron-key guard on /api/remind,
//      silently, for six minutes. A default is the whole hazard: it makes
//      the unsafe command look like the normal one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const compose = readFileSync(join(root, 'docker-compose.yml'), 'utf8');
const workflow = readFileSync(join(root, '.github/workflows/deploy.yml'), 'utf8');

test('the app image is pinned to the commit being deployed, not a moving tag', () => {
  // The line may carry a `:?` message containing spaces, so match to EOL
  // rather than to the first whitespace.
  const image = compose.match(/^\s*image:\s*(ghcr\.io\/.+)$/m)?.[1];
  assert.ok(image, 'the app service should still name a ghcr.io image');
  assert.match(image, /\$\{APP_TAG[:?}]/,
    'the tag must come from APP_TAG — a bare :latest races the git checkout');
});

test('APP_TAG has no default, so a bare `docker compose up` cannot deploy', () => {
  // Fault 3 in this file's header. `${APP_TAG:-latest}` reads as a harmless
  // convenience and is not: compose starts the locally cached :latest
  // without pulling, so the safest-looking command ships the oldest code on
  // the box. Without a default, compose refuses and says what to pass.
  const image = compose.match(/^\s*image:\s*(ghcr\.io\/.+)$/m)?.[1] ?? '';
  assert.doesNotMatch(image, /\$\{APP_TAG:-/,
    'APP_TAG must not have a default — that default is how production got rolled back');
});

test('CI publishes the tag the deploy asks for', () => {
  // APP_TAG is `git rev-parse HEAD`, the full 40-char SHA, so CI must tag
  // with the full github.sha. A short-sha tag (type=sha) would pull nothing.
  assert.match(workflow, /:\$\{\{\s*github\.sha\s*\}\}/,
    'the image must be tagged with the full github.sha for APP_TAG to resolve');
});

test('pull requests run the gates', () => {
  assert.match(workflow, /^\s*pull_request:/m, 'PRs must trigger the workflow');
  assert.match(workflow, /npm test/, 'the suite must run');
  assert.match(workflow, /npm run check/, 'the type-check must run');
});

test('a pull request never pushes an image or deploys', () => {
  // A PR token is read-only for packages, and a deploy from an unmerged
  // branch would put unreviewed code in front of families.
  assert.match(workflow, /push:\s*\$\{\{\s*github\.event_name\s*!=\s*'pull_request'\s*\}\}/,
    'the image push must be conditional on the event');

  const deployJob = workflow.slice(workflow.indexOf('\n  deploy:'));
  assert.match(deployJob, /if:\s*github\.event_name\s*!=\s*'pull_request'/,
    'the deploy job must be gated to non-PR events');
});

test('the image is still BUILT on a pull request', () => {
  // The point of building without pushing: a Dockerfile or .dockerignore
  // fault fails no test and no type-check. One such fault — a runtime bind
  // mount left in the build context — already broke a deploy before any of
  // this ran on PRs.
  const buildStep = workflow.slice(workflow.indexOf('Build and push image'));
  assert.doesNotMatch(buildStep.split('\n').slice(0, 12).join('\n'), /if:/,
    'the build step itself must not be skipped on pull requests');
});

test('only one deploy touches the box at a time', () => {
  // The forced command reads state the box already has — `git pull` then
  // `APP_TAG=$(git rev-parse HEAD)`. Two of those interleaving means one
  // deploy resolves APP_TAG from the other's commit and ships an image that
  // does not match its own checkout. It is also the only thing that
  // distinguished the deploys that failed (#27 and #28, overlapping) from
  // every one that succeeded.
  const deployJob = workflow.slice(workflow.indexOf('\n  deploy:'));
  assert.match(deployJob, /concurrency:/, 'the deploy job must be serialized');
  assert.match(deployJob, /cancel-in-progress:\s*false/,
    'a queued deploy should wait, not be dropped');
});

test('the SSH retry window is wide enough for a transient blip', () => {
  // The observed failures were TCP connect timeouts with nothing reaching
  // sshd, over a ~70s window. A wider window is the fix for a transient one;
  // a shorter timeout is not.
  const attempts = Number(workflow.match(/attempt"?\s*-ge\s*(\d+)/)?.[1] ?? 0);
  const backoff = Number(workflow.match(/sleep\s+(\d+)/)?.[1] ?? 0);
  assert.ok(attempts >= 5, `expected at least 5 attempts, found ${attempts}`);
  assert.ok(attempts * backoff >= 120, `retry window is ${attempts * backoff}s, want >= 120s`);
});

/* The two systemd --user timers curl http://127.0.0.1:3000 so the CRON_KEY
   never leaves the box. Their comments claimed compose published that port;
   it did not, so every run died with `curl: (7) Failed to connect`. The
   units predate the move into a container and nobody re-read them. */
test('the app is reachable on loopback, which is the only way the cron timers can call it', () => {
  const appBlock = compose.slice(compose.indexOf('\n  app:'), compose.indexOf('\n  caddy:'));
  assert.match(appBlock, /ports:\s*\n\s*-\s*["']127\.0\.0\.1:3000:3000["']/,
    'the timers curl 127.0.0.1:3000 — without this mapping they cannot reach the app at all');
});

test('the app is not published on every interface', () => {
  const appBlock = compose.slice(compose.indexOf('\n  app:'), compose.indexOf('\n  caddy:'));
  // "3000:3000" without a host would bind 0.0.0.0 and put the app in front
  // of the internet beside Caddy, unfronted.
  assert.doesNotMatch(appBlock, /-\s*["']3000:3000["']/,
    'bind the app to loopback only; Caddy is what faces the public');
});

/* The deploy is for a commit; the box deploys whatever main points at.
 *
 * The forced command derives APP_TAG from the box's own HEAD after
 * `git pull`, not from the commit the workflow run is for. When two PRs
 * merge moments apart, the earlier run pulls the later commit and asks
 * GHCR for an image that is still being built.
 *
 * Observed 2026-09-18: #71 and #72 merged moments apart and #71's deploy
 * failed five times over three minutes on `failed to resolve reference
 * ...:de1fff95...` — #72's image, unpublished at that point. Production
 * was never affected; #72's own run deployed. What it cost was the error
 * message, which blamed the VPS firewall.
 */
test('a superseded run skips rather than deploying a commit it is not for', () => {
  const deployJob = workflow.slice(workflow.indexOf('\n  deploy:'));
  assert.match(deployJob, /commits\/main/,
    'the deploy must learn what main actually points at before shipping');
  assert.match(deployJob, /!=\s*"\$\{\{\s*github\.sha\s*\}\}"/,
    'compare that tip against this run\'s own commit');
  // Skip, not fail: the newer commit's run is queued behind this one and
  // deploys both. Failing would redden a run that did nothing wrong.
  assert.match(deployJob, /Superseded[\s\S]{0,300}?exit 0/,
    'a superseded deploy should exit 0, not fail the run');
});

test('an unresolvable image is not reported as a firewall problem', () => {
  const deployJob = workflow.slice(workflow.indexOf('\n  deploy:'));
  // Anchor on the grep itself, not on the comment that explains it.
  const guard = /grep -q 'failed to resolve reference'/.exec(deployJob);
  assert.ok(guard, 'the image-missing failure must be told apart from a connectivity one');
  // The retry loop existed for TCP timeouts. An image GHCR does not have
  // will not appear because we asked again, and five 30s retries in front
  // of the wrong error message is how an afternoon gets spent on ufw.
  const branch = deployJob.slice(guard.index, guard.index + 600);
  assert.match(branch, /exit 1/, 'fail fast on a non-transient failure');
  assert.doesNotMatch(branch.slice(0, branch.indexOf('exit 1')), /firewall/,
    'this branch must not send anyone to the firewall');
});

/* The same mistake, a second time, from a different cause.
 *
 * On 2026-09-22 `main` was rewritten by `git filter-repo` to purge student
 * records from history. Every commit hash changed, so the box's
 * `git pull --ff-only` aborted with `Not possible to fast-forward` — which
 * is `--ff-only` working exactly as intended. The retry loop tried it five
 * times over three minutes and then blamed the VPS firewall, which was
 * reachable throughout and had nothing to do with it.
 *
 * A rewritten history is a fact, not a flake. Retrying a fact wastes the
 * window in which someone is still looking at the run.
 */
test('a diverged checkout is not reported as a firewall problem', () => {
  const deployJob = workflow.slice(workflow.indexOf('\n  deploy:'));
  const guard = /grep -q 'Not possible to fast-forward'/.exec(deployJob);
  assert.ok(guard, 'a rewritten history must be told apart from a connectivity failure');

  const branch = deployJob.slice(guard.index, guard.index + 900);
  assert.match(branch, /exit 1/, 'fail fast: no retry can undo a rewrite');
  assert.doesNotMatch(branch.slice(0, branch.indexOf('exit 1')), /firewall/,
    'this branch must not send anyone to the firewall');

  // The person reading this is looking for something to run, not for a
  // description of what went wrong. Give them the command.
  assert.match(branch, /git fetch origin && git reset --hard origin\/main/,
    'print the one-time fix, not just the diagnosis');
});

test('the catch-all failure admits the firewall is a guess', () => {
  const deployJob = workflow.slice(workflow.indexOf('\n  deploy:'));
  const tail = deployJob.slice(deployJob.indexOf('attempt" -ge 5'));
  // Two non-transient causes are classified before this point. What lands
  // here is genuinely unexplained, and saying "check the firewall" flatly
  // is what sent someone there twice. Hedge the guess, keep the hint.
  assert.match(tail.slice(0, 700), /no recognised cause/,
    'the exhausted-retries error must say the cause was not recognised');
});
