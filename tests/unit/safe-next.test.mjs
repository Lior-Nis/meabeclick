import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeNext } from '../../src/lib/safe-next.ts';

const ORIGIN = 'https://maab.example';

test('safeNext rejects bypass vectors that resolve off-origin', () => {
  const bypasses = [
    ['/\\evil.example', 'backslash escape to //evil.example'],
    ['//evil.example/steal', 'protocol-relative URL'],
    ['https://evil.example/steal', 'absolute URL'],
    ['/\\/evil.example', 'double-backslash variant'],
    ['javascript:alert(1)', 'javascript: protocol'],
  ];

  for (const [input, desc] of bypasses) {
    const result = safeNext(input, ORIGIN);
    assert.equal(
      result,
      '/app/dashboard',
      `${desc}: "${input}" should fall back to dashboard`
    );
  }
});

test('safeNext normalizes and returns legitimate same-origin paths', () => {
  const cases = [
    ['/app/plan/yuval', '/app/plan/yuval', 'simple path'],
    ['/app/plan/yuval?subject=math', '/app/plan/yuval?subject=math', 'path with query string'],
    ['/app/report/12?lesson=1', '/app/report/12?lesson=1', 'report path with query'],
    ['/app/plan/yuval?subject=math#section', '/app/plan/yuval?subject=math', 'fragment stripped'],
  ];

  for (const [input, expected, desc] of cases) {
    const result = safeNext(input, ORIGIN);
    assert.equal(result, expected, `${desc}: "${input}" should return "${expected}"`);
  }
});

test('safeNext handles null and empty cases', () => {
  assert.equal(safeNext(null, ORIGIN), '/app/dashboard', 'null returns dashboard');
  assert.equal(safeNext(undefined, ORIGIN), '/app/dashboard', 'undefined returns dashboard');
  assert.equal(safeNext('', ORIGIN), '/app/dashboard', 'empty string returns dashboard');
});

test('safeNext rejects relative paths that do not start with /', () => {
  const relatives = ['evil.example', 'app/dashboard', '../../../evil'];
  for (const input of relatives) {
    const result = safeNext(input, ORIGIN);
    assert.equal(result, '/app/dashboard', `relative path "${input}" should return dashboard`);
  }
});
