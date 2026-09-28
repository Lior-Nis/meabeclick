/**
 * The tutor's booking email says when a lesson is hers to prepare: any
 * subject but maths (see maths-only-autopilot.test.mjs). nodemailer is
 * stubbed as in family-booking-email-tutor.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

globalThis.__sentMail = [];
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      if (specifier === 'nodemailer') {
        return { url: 'data:text/javascript,' + encodeURIComponent(\`
          export default { createTransport() { return { sendMail(msg) { globalThis.__sentMail.push(msg); return Promise.resolve({}); } }; } };
        \`), shortCircuit: true, format: 'module' };
      }
      return nextResolve(specifier, context);
    }
  `)}`,
  import.meta.url,
);
process.env.GMAIL_USER = 'tutor@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-password';
const { sendBookingEmail } = await import('../../src/lib/server/email.ts');

const booking = (subject) => ({ name: 'נוגה', subject, level: 'כיתה ח', start: '2026-10-01T10:00:00.000Z', durationMin: 90, phone: '0501234567', email: 'p@example.com' });

test('a physics booking tells the tutor the lesson is hers to prepare', async () => {
  globalThis.__sentMail.length = 0;
  await sendBookingEmail(booking('פיזיקה'), true, null);
  const [msg] = globalThis.__sentMail;
  assert.match(msg.text, /ההכנה ידנית/);
  assert.match(msg.html, /ההכנה ידנית/);
});

test('a maths booking says nothing of the kind', async () => {
  globalThis.__sentMail.length = 0;
  await sendBookingEmail(booking('מתמטיקה'), true, null);
  assert.doesNotMatch(globalThis.__sentMail[0].text, /ההכנה ידנית/);
});
