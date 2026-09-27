// tests/unit/ask-conversation.test.mjs
//
// The question box as a short conversation, not a support ticket.
//
// Todoist id:6hR9MvprJ3vj7pVH. Two gaps, both measured in a browser before
// being fixed:
//
//   1. Double send. The send button is disabled while a request is in
//      flight; the KEYBOARD is not, and Enter does not go through the
//      button. Retyping mid-request fired a second /api/ask. Measured: two
//      concurrent calls for what the child experienced as one question.
//
//   2. Every failure said the same sentence. A rate limit, an unconfigured
//      engine and a dropped connection are different events with different
//      remedies, and a child told "I could not answer" for all three learns
//      that the box is unreliable — the one reading we can definitely
//      avoid.
//
// Source assertions, because both live in the component and this repo has
// no browser runner. The measurements are in the PR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const page = readFileSync(join(ROOT, 'src/routes/app/student/+page.svelte'), 'utf8');

test('a second question cannot start while one is in flight', () => {
  const body = page.slice(page.indexOf('async function ask('));
  assert.match(body.slice(0, 400), /if\s*\(sending\)\s*return/,
    'the disabled button does not cover Enter, which is how the double send happened');
});

test('the send button does not pass its click event as the question', () => {
  // ask() takes an optional question now, so `onclick={ask}` would hand it
  // a MouseEvent and .trim() it. svelte-check caught this; the assertion
  // keeps it caught if the signature changes again.
  assert.doesNotMatch(page, /onclick=\{ask\}/);
  assert.match(page, /onclick=\{\(\)\s*=>\s*ask\(\)\}/);
});

test('failures are told apart rather than collapsed into one sentence', () => {
  const fn = page.slice(page.indexOf('function failureFor('), page.indexOf('async function ask('));
  for (const status of ['429', '401', '503', '502']) {
    assert.match(fn, new RegExp(`\\b${status}\\b`), `no branch for ${status}`);
  }
  assert.match(fn, /status === null/, 'a network failure has no status and needs its own branch');
});

test('retry is offered only where trying again could work', () => {
  const fn = page.slice(page.indexOf('function failureFor('), page.indexOf('async function ask('));
  // A rate limit is the case where inviting a retry makes it worse.
  const rateLimit = fn.slice(fn.indexOf('429'), fn.indexOf('429') + 260);
  assert.match(rateLimit, /retry:\s*false/, 'retrying a 429 makes it worse');
  // A dropped connection is the case where it is the obvious remedy.
  const network = fn.slice(fn.indexOf('status === null'), fn.indexOf('status === null') + 300);
  assert.match(network, /retry:\s*true/);
});

test('the retry control resends the question it belongs to', () => {
  assert.match(page, /onclick=\{\(\)\s*=>\s*ask\(m\.retry\)\}/,
    'it must resend that message\'s question, not whatever is in the box now');
  assert.match(page, /class="retry"[^>]*disabled=\{sending\}/s,
    'and it must not be pressable while another request is running');
});

test('the handoff to the tutor carries only the question the child asked', () => {
  // «ללא שיתוף מידע מעבר לשאלה הנראית». The WhatsApp link is built from
  // the subject and the question, and nothing else — no history, no
  // progress, no balance.
  const at = page.indexOf('bubble(\'sys\', f.text');
  const wa = page.slice(at, at + 260);
  assert.match(wa, /waLink\(/);
  assert.doesNotMatch(wa, /chatHistory/, 'the handoff must not carry the conversation');
});

test('the child is told once when the assistant starts forgetting the start of the chat', () => {
  // «לציין בבירור מתי מתחילה שיחה חדשה». /api/ask sees only the last
  // REMEMBERED_TURNS turns, so from the fourth question on the first
  // exchange is gone — and nothing said so. Wording chosen by Lior,
  // 2026-09-25.
  assert.match(page, /const REMEMBERED_TURNS = 6;/);
  assert.match(page, /chatHistory\.slice\(-REMEMBERED_TURNS\)/,
    'the note and the request must agree on how much is remembered');
  const body = page.slice(page.indexOf('async function ask('));
  assert.match(body, /chatHistory\.length > REMEMBERED_TURNS && !forgetNoted/);
  assert.match(body, /bubble\('sys', 'התחלנו שיחה חדשה — אני זוכר רק את השאלות האחרונות'\)/);
});

test('the page and the server remember the same number of turns', () => {
  const server = readFileSync(join(ROOT, 'src/routes/api/ask/+server.ts'), 'utf8');
  const n = Number(server.match(/const MAX_HISTORY_TURNS = (\d+);/)[1]);
  assert.equal(Number(page.match(/const REMEMBERED_TURNS = (\d+);/)[1]), n);
});
