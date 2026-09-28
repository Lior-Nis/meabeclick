/**
 * How a family pays: the PayBox box Lior set up on 2026-09-28 (Todoist
 * 6hfCvXwG38gr8C5q, "parent board has no way to pay"). It is said where a
 * family meets money — the parent board's payments, the booking
 * confirmation and the after-lesson email — and in the pages that describe
 * payment, which said only «במזומן או בביט».
 *
 * nodemailer is stubbed as in family-booking-email-tutor.test.mjs, so the
 * real email.ts builds the messages.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

const LINK = 'https://links.payboxapp.com/k247i3oUN6b';
const { PAYBOX_LINK } = await import('../../src/lib/contact.ts');
const { sendFamilyBookingEmail, sendLessonReportedEmail } = await import('../../src/lib/server/email.ts');
const read = (f) => readFileSync(join(process.cwd(), f), 'utf8');
function sources(dir = 'src') {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : /\.(ts|svelte|js)$/.test(p) ? [p] : [];
  });
}

test('the link is declared once', () => {
  assert.equal(PAYBOX_LINK, LINK);
  const typed = sources().filter((f) => read(f).includes('payboxapp.com'));
  assert.deepEqual(typed, [join('src', 'lib', 'contact.ts')]);
});

test('the booking confirmation says how to pay', async () => {
  globalThis.__sentMail.length = 0;
  await sendFamilyBookingEmail(
    { name: 'נוגה', subject: 'מתמטיקה', level: 'כיתה ח', start: '2026-10-01T10:00:00.000Z', durationMin: 90, phone: '0501234567', email: 'p@example.com' },
    { created: true, accountCreated: true, student: { code: 'noga1', name: 'נוגה' }, portalLink: 'https://example.com/enter?t=x' },
  );
  const [msg] = globalThis.__sentMail;
  assert.ok(msg.text.includes(LINK), 'text');
  assert.ok(msg.html.includes(LINK), 'html');
  assert.match(msg.text, /PayBox/);
});

test('the after-lesson email says how to pay', async () => {
  globalThis.__sentMail.length = 0;
  await sendLessonReportedEmail({ to: 'p@example.com', studentName: 'נוגה', lessonStart: '2026-10-01T10:00:00.000Z', tasks: ['דף עבודה'], link: 'https://example.com/enter?t=x' });
  const [msg] = globalThis.__sentMail;
  assert.ok(msg.text.includes(LINK), 'text');
  assert.ok(msg.html.includes(LINK), 'html');
});

test('the parent board offers it where the money is', () => {
  const p = read('src/routes/app/parent/+page.svelte');
  assert.match(p, /import \{ PAYBOX_LINK, TUTOR_PHONE \} from '\$lib\/contact\.ts';/);
  const payments = p.indexOf('<span class="sec-title">תשלומים</span>');
  const button = p.indexOf('href={PAYBOX_LINK}');
  assert.ok(payments > 0 && button > payments, 'in the payments section');
});

test('the pages that describe payment name PayBox', () => {
  for (const f of ['src/routes/terms/+page.svelte', 'src/routes/privacy/+page.svelte', 'src/routes/+page.svelte']) {
    assert.match(read(f), /PayBox/, f);
  }
});
