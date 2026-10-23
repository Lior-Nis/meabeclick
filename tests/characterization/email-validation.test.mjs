import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { login, startServer } from './harness.mjs';

const overlong = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(62)}`;

const hostileAddresses = [
  ['nested recipient array', [['attacker@example.com']]],
  ['overlong address', overlong],
  ['header injection', 'victim@example.com\r\nBcc: attacker@example.com'],
];

function booking(email, day) {
  return {
    name: 'בדיקת אבטחה',
    subject: 'מתמטיקה',
    phone: '0501234567',
    email,
    level: 'כיתה י',
    durationMin: 45,
    start: `2027-03-${day}T10:00:00+02:00`,
    end: `2027-03-${day}T10:45:00+02:00`,
  };
}

test('public booking rejects hostile and overlong email values before writing state', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const statuses = [];
    for (const [name, email] of hostileAddresses) {
      const day = String(15 + statuses.length).padStart(2, '0');
      const response = await fetch(`${baseUrl}/api/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(booking(email, day)),
      });
      statuses.push([name, response.status]);
    }

    assert.deepEqual(statuses, hostileAddresses.map(([name]) => [name, 400]));

    const db = new DatabaseSync(dbPath, { readOnly: true });
    const bookings = db.prepare('SELECT COUNT(*) AS n FROM bookings_v2').get().n;
    const accounts = db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;
    db.close();
    assert.equal(bookings, 0, 'rejected addresses must not reserve a lesson');
    assert.equal(accounts, 0, 'rejected addresses must not create a family');
  } finally {
    await stop();
  }
});

test('public link requests reject the same hostile and overlong email values', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const statuses = [];
    for (const [name, email] of hostileAddresses) {
      const response = await fetch(`${baseUrl}/api/request-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      statuses.push([name, response.status]);
    }

    assert.deepEqual(statuses, hostileAddresses.map(([name]) => [name, 400]));
  } finally {
    await stop();
  }
});

test('tutor student creation cannot persist an address Nodemailer may reinterpret', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const statuses = [];
    for (const [name, email] of hostileAddresses) {
      const response = await fetch(`${baseUrl}/api/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ name, email }),
      });
      statuses.push([name, response.status]);
    }

    assert.deepEqual(statuses, hostileAddresses.map(([name]) => [name, 400]));

    const db = new DatabaseSync(dbPath, { readOnly: true });
    const accounts = db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;
    db.close();
    assert.equal(accounts, 0, 'invalid tutor-entered addresses must not be persisted for later mail');
  } finally {
    await stop();
  }
});
