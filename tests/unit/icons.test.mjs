// The icon catalogue, and the fallback that lets it ship before the artwork.
//
// The branded set does not exist yet, so every icon renders the emoji it
// replaces until `src/lib/icons/svg/<name>.svg` appears. That is what makes
// this shippable in pieces: no empty boxes, no big-bang swap, and an icon
// goes branded the moment its file lands, with no code change.
//
// These run under `node --test`, which has no Vite — so they also pin the
// guard that keeps registry.ts importable without import.meta.glob. Without
// it the whole module throws here, and every test that touches a page
// through the harness would fail for a reason that looks unrelated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { ICONS, iconFor, pendingIcons } = await import('../../src/lib/icons/registry.ts');

test('the registry is importable without Vite', () => {
  // The point of the typeof guard. If this throws, `node --test` cannot load
  // any module that reaches the registry.
  assert.ok(Object.keys(ICONS).length > 0);
});

test('every icon has an emoji to fall back to', () => {
  // A name with no fallback renders nothing until its art exists — an
  // invisible button, which is worse than the emoji it replaced.
  for (const [name, entry] of Object.entries(ICONS)) {
    assert.ok(entry.fallback, `${name} has no fallback`);
    assert.ok(entry.of, `${name} does not say what it means — the catalogue is documentation`);
  }
});

test('asking for an unknown icon fails loudly', () => {
  // A typo'd name must not render an empty span that nobody notices.
  assert.throws(() => iconFor('definitely-not-an-icon'), /unknown icon/);
});

test('an icon resolves to its fallback while unbranded', () => {
  const cal = iconFor('calendar');
  assert.equal(cal.fallback, '📅');
  // Outside Vite there is no glob, so svg is always null here. The branded
  // path is covered by the build: see the PR's bundle check.
  assert.equal(cal.svg, null);
});

test('every SVG on disk matches a name in the catalogue', () => {
  // A file named after nothing is art that will never render. Catching it
  // here beats wondering why a drawn icon never showed up.
  const dir = join(root, 'src/lib/icons/svg');
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir).filter(f => f.endsWith('.svg'))) {
    const name = f.replace(/\.svg$/, '');
    assert.ok(name in ICONS, `${f} matches no icon name — add "${name}" to ICONS, or rename the file`);
  }
});

test('pendingIcons reports what still needs drawing', () => {
  // Without Vite nothing is branded, so this is the full catalogue — the
  // useful assertion is that it returns names, not that it returns none.
  const pending = pendingIcons();
  assert.equal(pending.length, Object.keys(ICONS).length);
  assert.ok(pending.includes('calendar'));
});

test('the two channels that cannot take icons are left alone', () => {
  // WhatsApp is plain text through CallMeBot, and Gmail/Outlook render no
  // inline SVG while blocking remote images by default. An icon there is
  // strictly worse than the emoji it replaced, so those files keep theirs —
  // and this fails if a later sweep "finishes the job" by stripping them.
  const queue = readFileSync(join(root, 'src/lib/server/lesson/queue.ts'), 'utf8');
  assert.match(queue, /⚠️|✅/, 'WhatsApp notifications must keep their emoji — no markup reaches that channel');

  const mail = readFileSync(join(root, 'src/lib/server/email.ts'), 'utf8');
  assert.match(mail, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, 'email must keep its emoji — clients block images and drop inline SVG');
});
