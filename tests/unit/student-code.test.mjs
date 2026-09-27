/**
 * The address a child's page lives at.
 *
 * It used to be transliterated from their first name, which fails on a large
 * share of Israeli names because א ה ו ע transliterate to nothing and a
 * trailing ה is dropped on purpose. Measured on fourteen common names, five
 * came out two characters or shorter:
 *
 *   מאיה → "mi"   נועה → "no"   אביה → "bi"   עדן → "dn"
 *   אלה  → "l"  → below the length floor → fell back to "student"
 *
 * That last one is the sharp end: a girl named אלה was handed the address
 * `student`, which collides with the existing test account and dedupes to
 * `student2`.
 *
 * Found on 2026-09-22 by running the pipeline for an invented student called
 * מאיה לוי, who was given `mi`.
 *
 * Two further reasons not to derive it from the name at all, beyond length:
 * two different children whose names share a consonant skeleton collide by
 * construction, and the address travels — a parent forwards the link over
 * WhatsApp — so a name in the URL is the child's name in someone else's
 * chat history.
 *
 * A code the tutor types herself is still honoured. That is a deliberate
 * choice she made, not a guess made on her behalf.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'code-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const { makeCode } = await import('../../src/lib/server/enroll.ts');

const account = E.createAccount({ name: 'משפחה', credential: 'x' });
const claim = (code) => E.createStudent({ code, name: 'x', accountId: account.id, credential: 'p' });

/** The names that broke it, plus ones that transliterated fine. */
const NAMES = ['מאיה לוי', 'נועה כהן', 'אביה רם', 'עדן אלון', 'אלה שחר',
               'רוני גל', 'שירה מור', 'תמר בן דוד', 'יואב אבני'];

test('no name produces an address shorter than three characters', () => {
  for (const name of NAMES) {
    const code = makeCode(name, null);
    assert.ok(code.length >= 3, `${name} produced ${JSON.stringify(code)}`);
  }
});

test('no child is ever handed the address "student"', () => {
  // אלה used to land here, on top of the Codex smoke-test account.
  for (const name of NAMES) {
    assert.notEqual(makeCode(name, null), 'student', `${name} fell back to the test account's code`);
  }
});

test('two children with different names never collide', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const code = makeCode('מאיה לוי', null);
    assert.equal(seen.has(code), false, `repeated code ${code}`);
    seen.add(code);
    claim(code);
  }
});

test('the address does not carry the child\'s name', () => {
  // It is forwarded over WhatsApp by a parent. A name in the URL is the
  // child's name in a stranger's chat history.
  const code = makeCode('מאיה לוי', null);
  assert.doesNotMatch(code, /^mi/, 'still derived from the name');
  assert.doesNotMatch(code, /maya|mai/i);
});

test('the address is a legal URL segment and unguessable-looking', () => {
  for (let i = 0; i < 50; i++) {
    const code = makeCode('נועה כהן', null);
    assert.match(code, /^[a-z0-9]+$/, `${code} is not a plain path segment`);
    claim(code);
  }
});

test('a code the tutor typed herself is still used', () => {
  // She chose it; that is not a guess made on her behalf.
  assert.equal(makeCode('מאיה לוי', 'maya-g9'), 'maya-g9');
  assert.equal(makeCode('מאיה לוי', 'Maya G9!'), 'mayag9');
});

test('a requested code that is already taken does not silently overwrite', () => {
  claim('taken-one');
  const code = makeCode('מאיה לוי', 'taken-one');
  assert.notEqual(code, 'taken-one');
  assert.ok(code.length >= 3);
});

test('a requested code too short to be usable is not accepted as-is', () => {
  const code = makeCode('מאיה לוי', 'a');
  assert.ok(code.length >= 3, `got ${JSON.stringify(code)}`);
});
