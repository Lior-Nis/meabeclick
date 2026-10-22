// server/health-alert.sh: the message from the host when a health unit
// fails — the one case the app cannot report (it is down). Run for real
// under bash with a fake curl and journalctl on PATH, so nothing leaves the
// machine and what curl was given can be read back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), '../../server/health-alert.sh');
const HOOK = 'https://hooks.slack.com/services/T000/B000/secretsecret';

function sandbox(envFile, curlAnswer = 'ok') {
  const dir = mkdtempSync(join(tmpdir(), 'health-alert-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  /* Records argv and stdin (where the webhook URL must travel), one call per file. */
  writeFileSync(join(bin, 'curl'), `#!/usr/bin/env bash
n=$(ls "${dir}"/call-* 2>/dev/null | wc -l)
printf '%s\\n' "$@" > "${dir}/call-$n.args"
cat > "${dir}/call-$n.stdin"
printf '%s' '${curlAnswer}'
`);
  writeFileSync(join(bin, 'journalctl'), `#!/usr/bin/env bash\necho "curl: (7) Failed to connect to 127.0.0.1 port 3000"\n`);
  chmodSync(join(bin, 'curl'), 0o755);
  chmodSync(join(bin, 'journalctl'), 0o755);
  writeFileSync(join(dir, '.env'), envFile);
  const run = () => spawnSync('bash', [script, 'meabeclick-ops-health.service'], {
    encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: dir, MEABECLICK_DIR: dir, XDG_STATE_HOME: join(dir, 'state') },
  });
  const calls = () => {
    const out = [];
    for (let i = 0; existsSync(join(dir, `call-${i}.args`)); i++) {
      out.push({ args: readFileSync(join(dir, `call-${i}.args`), 'utf8'), stdin: readFileSync(join(dir, `call-${i}.stdin`), 'utf8') });
    }
    return out;
  };
  return { run, calls };
}

test('a failed unit sends ONE Slack message naming it, with the webhook on stdin, not argv', () => {
  const s = sandbox(`ADMIN_PASSWORD=hunter2\nOPS_SLACK_WEBHOOK_URL="${HOOK}"\n`);
  const r = s.run();
  assert.equal(r.status, 0, r.stderr);
  const [call, ...more] = s.calls();
  assert.equal(more.length, 0);
  assert.ok(call.stdin.includes(HOOK), 'URL handed to curl via -K -');
  assert.ok(!call.args.includes('secretsecret'), 'the webhook URL never appears on the command line');
  const body = JSON.parse(call.args.split('\n')[call.args.split('\n').indexOf('--data-binary') + 1]);
  assert.match(body.text, /meabeclick-ops-health\.service/);
  assert.match(body.text, /Failed to connect/);
  assert.ok(!(r.stdout + r.stderr).includes('secretsecret'));
  assert.ok(!(r.stdout + r.stderr + call.args).includes('hunter2'), 'nothing else from .env is read');
});

test('a second failure within the hour is not a second message', () => {
  const s = sandbox(`OPS_SLACK_WEBHOOK_URL=${HOOK}\n`);
  assert.equal(s.run().status, 0);
  assert.equal(s.run().status, 0);
  assert.equal(s.calls().length, 1);
});

test('WhatsApp via CallMeBot when that pair is set; nothing configured fails the alert unit itself', () => {
  const wa = sandbox(`OPS_CALLMEBOT_PHONE=972500000000\nOPS_CALLMEBOT_API_KEY=k123\n`, 'Message queued');
  assert.equal(wa.run().status, 0);
  const [c] = wa.calls();
  assert.match(c.stdin, /api\.callmebot\.com\/whatsapp\.php/);
  assert.match(c.args, /phone=972500000000/);

  const none = sandbox(`ADMIN_PASSWORD=x\n`);
  const r = none.run();
  assert.notEqual(r.status, 0, 'a failure nobody was told about must be red');
  assert.match(r.stderr, /NOBODY WAS TOLD/);
  assert.equal(none.calls().length, 0);
});

test('a refused Slack hook is a failure, and its answer is scrubbed of the URL', () => {
  const s = sandbox(`OPS_SLACK_WEBHOOK_URL=${HOOK}\n`, `invalid_token ${HOOK}`);
  const r = s.run();
  assert.notEqual(r.status, 0);
  assert.ok(!(r.stdout + r.stderr).includes('secretsecret'));
});
