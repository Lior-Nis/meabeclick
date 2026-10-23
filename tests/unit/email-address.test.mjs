import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidEmailAddress,
  MAX_EMAIL_LENGTH,
  normalizeEmail,
} from '../../src/lib/server/email-address.ts';

const longestValid = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`;
const overlong = `${longestValid}e`;

test('email validation accepts one bounded mailbox, including international domains', () => {
  assert.equal(Buffer.byteLength(longestValid), MAX_EMAIL_LENGTH);
  assert.equal(isValidEmailAddress(longestValid), true);
  assert.equal(isValidEmailAddress('ליאור@דוגמה.ישראל'), true);
  assert.equal(normalizeEmail('  Dana+Math@Example.COM  '), 'dana+math@example.com');
});

test('email validation rejects parser structures, controls, and overlong values', () => {
  const invalid = [
    [['attacker@example.com']],
    overlong,
    'victim@example.com\r\nBcc: attacker@example.com',
    'Name <attacker@example.com>',
    'one@example.com,two@example.com',
    'comment@example.com (attacker@example.com)',
    '.leading@example.com',
    'double..dot@example.com',
    'missing-domain-dot@example',
  ];

  for (const value of invalid) {
    assert.equal(isValidEmailAddress(value), false, `expected rejection for ${JSON.stringify(value)}`);
  }
});
