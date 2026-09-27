/**
 * The tutor sees held homework; families do not (spec D6). The tutor's
 * activity route is the one caller that must opt in, on EVERY read — its
 * PATCH and DELETE check ownership through the same read, so without it
 * she could not delete a held task, which spec D3 relies on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = readFileSync(join(process.cwd(), 'src/routes/api/students/[code]/activity/+server.ts'), 'utf8');
const dash = readFileSync(join(process.cwd(), 'src/routes/app/dashboard/+page.svelte'), 'utf8');

test('every homework read in the tutor route includes held rows', () => {
  const calls = route.match(/homeworkForStudent\([^)]*\)/g) ?? [];
  assert.ok(calls.length >= 3);
  for (const c of calls) assert.match(c, /includeHeld:\s*true/, c);
});

test('the route says until when a task is held', () => {
  assert.match(route, /heldUntil:\s*h\.held_until/);
});

test('the dashboard marks a held task as waiting for its lesson', () => {
  assert.match(readFileSync(join(process.cwd(), 'src/lib/tutor-homework.ts'), 'utf8'), /heldUntil: string \| null/);
  assert.match(dash, /\{#if hw\.heldUntil\}/);
  assert.match(dash, /ממתין לדיווח על השיעור/);
});

test('family routes never ask for held rows', () => {
  for (const f of ['src/routes/api/portal/[code]/+server.ts', 'src/routes/api/portal/[code]/homework/+server.ts', 'src/lib/server/progress.ts']) {
    assert.doesNotMatch(readFileSync(join(process.cwd(), f), 'utf8'), /includeHeld/, f);
  }
});
