/**
 * The parent portal's "no students yet" screen, and who is allowed to see it.
 *
 * Nicole reported the parent page showing «הדף האישי עדיין בהכנה» on an
 * account that has two enrolled children with working portal files
 * (verified against production on 2026-09-20: account 5 owns `kid-b` and
 * `kid-c`, and no account in the database has zero students).
 *
 * That copy tells a family their page is not ready and points them at
 * WhatsApp and the booking form. On an account that HAS children, every
 * sentence of it is false, and the advice it gives — book again — is the
 * advice the comment above it says it must never give.
 *
 * The screen was guarded on `!CURRENT`, which is not "this account has no
 * students". `CURRENT` is the board the page fetches after mount, so it is
 * also null whenever the page mounted without choosing a child. `onMount`
 * had exactly that path: neither the overview nor a selected student, fall
 * through to `loading = false` and render whatever `!CURRENT` renders.
 *
 * Reaching it needs `data.selected` to be null while students exist — a
 * student row whose `code` is empty, say, since the load does
 * `selected?.code ?? null` and `??` does not catch `''`. Rare, not
 * impossible, and the cost of being wrong is telling a paying parent their
 * child is not enrolled.
 *
 * These are source assertions rather than a rendered test on purpose: the
 * screen only ever appears after mount, so the server HTML this suite can
 * reach renders the spinner instead. Pinning the guard is what actually
 * keeps the copy honest.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const page = readFileSync(join(root, 'src/routes/app/parent/+page.svelte'), 'utf8');

test('the "not ready yet" screen is guarded on having no students, not on an unloaded board', () => {
  const guard = /\{:else if ([^}]+)\}\s*(?:<!--(?:[^-]|-(?!->))*-->\s*)*<div class="boot">\s*<BrandMark[^>]*\/>\s*<div class="boot-icon">/;
  const m = guard.exec(page);
  assert.ok(m, 'could not find the empty-state branch — has the markup moved?');
  assert.match(
    m[1],
    /data\.students\.length === 0/,
    'the empty state must key off an account with no students; `!CURRENT` is also true '
    + 'for an account whose board simply has not been chosen, and this copy tells such a '
    + 'family they are not enrolled',
  );
});

test('navigating never leaves an account with students on an unchosen board', () => {
  // Was 'mounting'. The fallback this protects is unchanged; what moved is
  // where it lives. Opening a child ran in onMount, which does not re-run on
  // a navigation within the same route — /app/parent → /app/parent?s=<code>
  // reused the component, so tapping a child from the family overview
  // fetched nothing and left a spinner only a reload could clear
  // (Todoist id:6hW962W25vCfcfrq). It is an $effect keyed on the navigation
  // now; see tests/unit/parent-portal-navigation.test.mjs.
  //
  // The hazard below is the same one either way: ending the spinner having
  // chosen nothing, so the template falls through to a screen that tells an
  // enrolled family they are not enrolled.
  const effect = /\$effect\(\(\) => \{([\s\S]*?)\n  \}\);/.exec(page);
  assert.ok(effect, 'could not find the effect that opens a child');
  assert.match(
    effect[1],
    /data\.students\[0\]/,
    'with no child named and no overview, it must fall back to a student the account '
    + 'actually has rather than ending the spinner on nothing',
  );
});
