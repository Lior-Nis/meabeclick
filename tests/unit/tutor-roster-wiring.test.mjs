/**
 * Source-level checks that the landing page's tutor cards, the header
 * sidebar's contact line, and the dashboard subtitle all read tutor names
 * from `src/lib/tutors.ts` instead of hardcoding them — see PRODUCT.md's
 * "ready for a third tutor" pillar. A grep rather than a render: these are
 * Svelte 5 components a plain node:test cannot mount, but "does this file's
 * source still contain the literal name" is exactly what a hardcode looks
 * like, and exactly what a real third tutor would break.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('the landing page imports TUTORS and does not hardcode the tutor names', () => {
  const src = read('src/routes/+page.svelte');
  assert.match(src, /from ['"]\$lib\/tutors(\.ts)?['"]/, 'imports the roster');
});

test('the landing page renders its tutor cards from TUTORS, not hardcoded markup', () => {
  const src = read('src/routes/+page.svelte');
  const start = src.indexOf('tutors-preview');
  const end = src.indexOf('hero-feature-carousel');
  assert.ok(start > -1 && end > start, 'found the tutor cards section');
  const section = src.slice(start, end);
  // The demo dashboard illustration ("מורה: ניקול") and the testimonials
  // quoting both tutors by name are explicitly left as-is (illustration /
  // real quotes, not config) — this only checks the two tutor cards
  // themselves.
  assert.match(section, /\{#each TUTORS as tutor/, 'the two cards come from an #each over TUTORS');
  assert.doesNotMatch(section, /ניקול/, 'no hardcoded ניקול left in the tutor cards');
  assert.doesNotMatch(section, /ליאור/, 'no hardcoded ליאור left in the tutor cards');
});

test('Header.svelte reads the contact tutor\'s name from the roster', () => {
  const src = read('src/lib/components/Header.svelte');
  assert.match(src, /from ['"]\$lib\/tutors(\.ts)?['"]/, 'imports the roster');
  assert.doesNotMatch(src, /ניקול/, 'no hardcoded ניקול left in Header.svelte');
});

test('the dashboard subtitle reads tutor names from the roster', () => {
  const src = read('src/routes/app/dashboard/+page.svelte');
  assert.match(src, /from ['"]\$lib\/tutors(\.ts)?['"]/, 'imports the roster');
  assert.doesNotMatch(src, /ניקול וליאור/, 'no hardcoded "ניקול וליאור" left in the dashboard');
});

test('the two server fallbacks no longer name ניקול', () => {
  const enroll = read('src/lib/server/enroll.ts');
  const studentsApi = read('src/routes/api/students/+server.ts');
  assert.doesNotMatch(enroll, /'ניקול'/, 'enroll.ts fallback must not name a specific tutor');
  assert.doesNotMatch(studentsApi, /'ניקול'/, 'students/+server.ts fallback must not name a specific tutor');
});

test('booking/+page.svelte reads every tutor mention from the roster', () => {
  const src = read('src/routes/booking/+page.svelte');
  assert.match(src, /from ['"]\$lib\/tutors(\.ts)?['"]/, 'imports the roster');
  assert.doesNotMatch(src, /ניקול/, 'no hardcoded ניקול left in the booking flow');
  assert.doesNotMatch(src, /ליאור/, 'no hardcoded ליאור left in the booking flow');
  // Grammar check: contactTutor() is called, not a bare string interpolation
  // of a name captured once at the top (which would go stale if a family's
  // booking is later reassigned to a different default tutor).
  assert.match(src, /contactTutor\(\)\.name/, 'uses contactTutor().name, not a copied-out string');
});

test('login/+page.svelte subtitle reads from tutorNames()', () => {
  const src = read('src/routes/login/+page.svelte');
  assert.match(src, /from ['"]\$lib\/tutors(\.ts)?['"]/, 'imports the roster');
  assert.match(src, /\{tutorNames\(\)\}/, 'renders the subtitle from tutorNames()');
  assert.doesNotMatch(src, /ניקול וליאור/, 'no hardcoded "ניקול וליאור" left in the login subtitle');
});

test('portal/+page.svelte\'s "כתבו ל..." link names the contact tutor', () => {
  const src = read('src/routes/portal/+page.svelte');
  assert.match(src, /from ['"]\$lib\/tutors(\.ts)?['"]/, 'imports the roster');
  assert.match(src, /כתבו ל\{contactTutor\(\)\.name\}/, 'ל + contactTutor().name, built as ל + name');
  assert.doesNotMatch(src, /כתבו לניקול/, 'no hardcoded "כתבו לניקול" left in the portal page');
});

test('request-link/+server.ts\'s mail-down error names the contact tutor', () => {
  const src = read('src/routes/api/request-link/+server.ts');
  assert.match(src, /from ['"]\$lib\/tutors(\.ts)?['"]/, 'imports the roster');
  assert.match(src, /contactTutor\(\)\.name/, 'the error message reads the contact tutor from the roster');
  assert.doesNotMatch(src, /פנו לניקול/, 'no hardcoded "פנו לניקול" left in the error message');
});

/**
 * A repo-wide net, on top of the per-file checks above: every .ts/.svelte
 * source file this session owns must be free of the literal tutor names,
 * except the files the approved design explicitly excludes (the roster
 * itself, historical migration seed data, the legal pages naming the
 * business's operator, and the landing page — covered by its own dedicated
 * test above, since its demo-dashboard illustration and testimonials are
 * real content, not config). app/parent and app/student were exempt while
 * another session owned them; Todoist 6hcWrpq7X4Hp7Vfq brought them in.
 * Comments are stripped first: a doc comment recalling the OLD hardcoded
 * copy (as email.ts's and this file's do) is not itself a hardcode.
 */
const EXEMPT = new Set([
  'src/lib/tutors.ts',
  'src/lib/server/migrations/002_family_access.ts',
  'src/routes/privacy/+page.svelte',
  'src/routes/terms/+page.svelte',
  'src/routes/+page.svelte',
  'tests/unit/tutor-roster-wiring.test.mjs',
]);

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(svelte|ts)$/.test(entry)) out.push(full);
  }
  return out;
}

test('no other owned source file hardcodes ניקול or ליאור', () => {
  const offenders = [];
  for (const full of walk(join(ROOT, 'src'))) {
    const rel = relative(ROOT, full).split('\\').join('/');
    if (EXEMPT.has(rel)) continue;
    const code = stripComments(readFileSync(full, 'utf8'));
    if (/ניקול|ליאור/.test(code)) offenders.push(rel);
  }
  assert.deepEqual(offenders, []);
});

test('the tutor\'s phone number is typed in exactly one place', () => {
  // It was duplicated into booking, portal, app/parent and app/student;
  // src/lib/contact.ts is where it lives now.
  const offenders = [];
  for (const full of walk(join(ROOT, 'src'))) {
    const rel = relative(ROOT, full).split('\\').join('/');
    // The roster's own home, and historical migration seed data.
    if (rel === 'src/lib/contact.ts' || rel === 'src/lib/server/migrations/002_family_access.ts') continue;
    const code = stripComments(readFileSync(full, 'utf8'));
    if (/972546969891|0546969891/.test(code)) offenders.push(rel);
  }
  assert.deepEqual(offenders, []);
});
