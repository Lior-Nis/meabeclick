import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'test-secret-not-a-real-one';
const { gameUrl, verifyGameSignature, lessonUrl, portalLink } = await import('../../src/lib/server/urls.ts');

test('gameUrl builds a site-absolute signed url under /app/play', async () => {
  const url = gameUrl({ template: 'memory', dataId: 'noga-integrals-memory', student: 'נוגה' });
  assert.ok(url.startsWith('/app/play/memory?'), url);
  const q = new URL(url, 'http://x').searchParams;
  assert.equal(q.get('d'), 'noga-integrals-memory');
  assert.equal(q.get('s'), 'נוגה');
  assert.ok(q.get('t'), 'expected a signature');
});

test('a valid signature verifies and a tampered one does not', async () => {
  const url = gameUrl({ template: 'quiz', dataId: 'x-quiz', student: 'דנה' });
  const t = new URL(url, 'http://x').searchParams.get('t');

  assert.equal(verifyGameSignature({ dataId: 'x-quiz', student: 'דנה', t }), true);
  assert.equal(verifyGameSignature({ dataId: 'x-quiz', student: 'יוסי', t }), false,
    'a signature must not transfer to another student');
  assert.equal(verifyGameSignature({ dataId: 'other', student: 'דנה', t }), false,
    'a signature must not transfer to another assignment');
  assert.equal(verifyGameSignature({ dataId: 'x-quiz', student: 'דנה', t: 'forged' }), false);
});

test('a naive "dataId student" delimiter collision is not exploitable', async () => {
  // dataId="a b", student="c"  vs  dataId="a", student="b c" would hash to
  // the identical string "a b c" under a plain `${dataId} ${student}` join.
  // A signature minted for one pair must not verify for the other.
  const url = gameUrl({ template: 'quiz', dataId: 'a b', student: 'c' });
  const t = new URL(url, 'http://x').searchParams.get('t');

  assert.equal(verifyGameSignature({ dataId: 'a b', student: 'c', t }), true);
  assert.equal(verifyGameSignature({ dataId: 'a', student: 'b c', t }), false,
    'a signature must not transfer across a re-split of the same bytes');
});

test('lessonUrl returns a site-absolute lesson path', () => {
  assert.equal(lessonUrl('algebra-basics'), '/lessons/algebra-basics');
});

test('portalLink returns a site-absolute portal path for a student code', () => {
  assert.equal(portalLink('noga'), '/portal?s=noga');
});

const REAL_TEMPLATES = [
  'memory', 'quiz', 'matching', 'sequence', 'sort', 'table', 'labelling',
  'number-line', 'speed-drill', 'error-hunt', 'graph-match', 'two-truths',
];

test('gameUrl accepts every real template name', () => {
  for (const template of REAL_TEMPLATES) {
    const url = gameUrl({ template, dataId: 'x', student: 'y' });
    assert.ok(url.startsWith(`/app/play/${template}?`), url);
  }
});

test('gameUrl throws on a path-traversal template rather than minting a url', () => {
  assert.throws(() => gameUrl({ template: '../foo', dataId: 'x', student: 'y' }));
});

test('gameUrl throws on an empty template', () => {
  assert.throws(() => gameUrl({ template: '', dataId: 'x', student: 'y' }));
});

test('lessonUrl throws on a path-traversal slug rather than minting a url', () => {
  assert.throws(() => lessonUrl('../foo'));
});

test('lessonUrl throws on an empty slug', () => {
  assert.throws(() => lessonUrl(''));
});

test('portalLink throws on a path-traversal code rather than minting a url', () => {
  assert.throws(() => portalLink('../foo'));
});

test('portalLink throws on an empty code', () => {
  assert.throws(() => portalLink(''));
});
