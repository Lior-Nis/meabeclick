#!/usr/bin/env node
/**
 * Copies the Lucide icons this app uses into src/lib/icons/svg/.
 *
 * Vendored rather than imported at runtime, deliberately: the app ships ~30
 * icons out of Lucide's 2000, the files are a few hundred bytes each, and
 * inlining them means no runtime dependency and no request. It also means an
 * icon can be hand-replaced with custom artwork one file at a time without
 * fighting a package — which is the whole point of the registry.
 *
 * MAPPING, not naming: the left column is what this app calls the thing, the
 * right is Lucide's file. Those drift (help-circle became circle-help), and a
 * rename upstream should fail loudly here rather than silently drop an icon.
 *
 * Re-run after `npm i -D lucide-static@latest`:  node scripts/vendor-icons.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/lucide-static/icons');
const out = join(root, 'src/lib/icons/svg');

/** appName: lucideName */
const MAP = {
  'my-page': 'backpack',      student: 'backpack',      subjects: 'book-open',
  games: 'gamepad-2',         message: 'message-circle', payments: 'credit-card',
  faq: 'circle-help',         portal: 'graduation-cap',  dashboard: 'layout-dashboard',
  booking: 'calendar-plus',   calendar: 'calendar',      homework: 'notebook-pen',
  progress: 'trending-up',    slides: 'presentation',    family: 'users',
  email: 'mail',              link: 'link',              key: 'key',
  done: 'circle-check',       check: 'check',            warning: 'triangle-alert',
  add: 'plus',                close: 'x',                edit: 'pencil',
  delete: 'trash-2',          greeting: 'hand',          celebrate: 'party-popper',
  'day-one': 'rocket',        trouble: 'frown',
};

const version = JSON.parse(readFileSync(join(root, 'node_modules/lucide-static/package.json'), 'utf8')).version;
let written = 0;

for (const [name, lucide] of Object.entries(MAP)) {
  const file = join(src, `${lucide}.svg`);
  if (!existsSync(file)) {
    console.error(`MISSING upstream: ${lucide}.svg (for "${name}") — Lucide may have renamed it`);
    process.exitCode = 1;
    continue;
  }
  const svg = readFileSync(file, 'utf8')
    // The component sizes the icon; fixed width/height would fight it.
    .replace(/\s+width="24"/, '').replace(/\s+height="24"/, '')
    // Lucide's own class is dead weight once inlined, and `lucide-x` colliding
    // with an app class is a bug waiting to happen.
    .replace(/\s+class="[^"]*"/, '')
    .replace(/<!--[^>]*-->\n?/, '')
    .trim();

  writeFileSync(join(out, `${name}.svg`), `<!-- ${lucide} from lucide-static v${version} — ISC. See ./README.md -->\n${svg}\n`);
  written++;
}
console.log(`vendored ${written} icons from lucide-static v${version}`);
