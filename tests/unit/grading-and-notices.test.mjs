/**
 * Pre-launch review, 2026-09-28: the tutor could not grade homework (a
 * child's «ממתין לבדיקה» never ended), and nobody was told anything — not
 * the tutor when a child handed work in, not the family when a lesson was
 * reported. Todoist 6hfCvVRxF6J86Cvq.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';

process.env.DATA_DIR = await mkdtemp(join(tmpdir(), 'notices-'));
process.env.SITE_URL = 'https://site.test';
process.env.SESSION_SECRET = 'test-secret';
const read = (f) => readFileSync(join(process.cwd(), f), 'utf8');
const G = await import('../../src/lib/homework-grade.ts');
const E = await import('../../src/lib/server/entities.ts');
const L = await import('../../src/lib/server/lessons.ts');
const DB = await import('../../src/lib/server/db.ts');
const N = await import('../../src/lib/server/notices.ts');

test('grades and their words are declared once, and both pages use them', () => {
  assert.deepEqual(G.GRADES, ['ok', 'partial', 'redo']);
  for (const g of G.GRADES) assert.ok(G.GRADE_LABEL[g] && G.GRADE_BUTTON[g]);
  const student = read('src/routes/app/student/+page.svelte');
  assert.match(student, /from '\$lib\/homework-grade\.ts'/);
  assert.doesNotMatch(student, /const GRADE_LABEL: Record/);
  const dash = read('src/routes/app/dashboard/+page.svelte');
  assert.match(dash, /from '\$lib\/homework-grade\.ts'/);
});

test('the dashboard grades handed-in work, and shows how much is waiting', () => {
  const dash = read('src/routes/app/dashboard/+page.svelte');
  assert.match(dash, /\{#if hw\.submitted && !hw\.graded\}/);
  assert.match(dash, /gradeHw\(s\.code, hw\.id, g\)/);
  assert.match(dash, /JSON\.stringify\(\{ kind: 'homework', id: Number\(hwId\), grade \}\)/);
  assert.match(dash, /ממתינות לבדיקה/);
});

test('the tutor hears when a child hands work in — once, not on an undo', async () => {
  const sent = [];
  const send = (t) => { sent.push(t); };
  await N.noticeHomeworkSubmitted({ studentName: 'נוגה', task: 'דף עבודה', wasSubmitted: false, nowSubmitted: true, by: 'student' }, send);
  await N.noticeHomeworkSubmitted({ studentName: 'נוגה', task: 'דף עבודה', wasSubmitted: true, nowSubmitted: true, by: 'student' }, send);
  await N.noticeHomeworkSubmitted({ studentName: 'נוגה', task: 'דף עבודה', wasSubmitted: true, nowSubmitted: false, by: 'student' }, send);
  await N.noticeHomeworkSubmitted({ studentName: 'נוגה', task: 'דף עבודה', wasSubmitted: false, nowSubmitted: true, by: 'teacher' }, send);
  assert.equal(sent.length, 1, 'only the child handing it in; the tutor marking it herself needs no message');
  assert.match(sent[0], /נוגה/);
  assert.match(sent[0], /דף עבודה/);
});

function family() {
  const a = E.createAccount({ name: 'משפחת כהן', phone: null, credential: 'x', email: 'fam@example.com' });
  const s = E.createStudent({ code: `nt${Date.now() % 100000}${Math.floor(Math.random() * 1000)}`, name: 'נוגה כהן', accountId: a.id, credential: 'x' });
  DB.handle().prepare(`INSERT INTO bookings_v2 (student_id, start, "end", duration, at, status) VALUES (?, '2027-04-05T14:00:00.000Z', '2027-04-05T15:30:00.000Z', 90, '2027-01-01', 'confirmed')`).run(s.id);
  const bookingId = Number(DB.handle().prepare(`SELECT id FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get().id);
  return { a, s, bookingId };
}

test('the family is emailed once when the lesson is reported: its homework and a link, never the tutor\'s note', async () => {
  const { s, bookingId } = family();
  L.addHomework({ studentId: s.id, task: 'תרגילים 1-5', bookingId });
  L.addHomework({ studentId: s.id, task: 'עדיין מוחזק', bookingId, heldUntil: '2099-01-01T00:00:00.000Z' });
  const mails = [];
  const send = async (m) => { mails.push(m); return true; };
  assert.equal(await N.emailFamilyAfterReport(bookingId, { send }), 'sent');
  assert.equal(await N.emailFamilyAfterReport(bookingId, { send }), 'already-sent', 're-filing a report does not re-send');
  assert.equal(mails.length, 1);
  const m = mails[0];
  assert.equal(m.to, 'fam@example.com');
  assert.equal(m.studentName, 'נוגה כהן');
  assert.deepEqual(m.tasks, ['תרגילים 1-5'], 'only what the family can already see');
  assert.match(m.link, /^https:\/\/site\.test\/enter\?t=/);
  assert.equal('note' in m, false);
});

test('a family with no email is skipped, and says so', async () => {
  const a = E.createAccount({ name: 'בלי מייל', phone: null, credential: 'x' });
  const s = E.createStudent({ code: `ne${Date.now() % 100000}`, name: 'ילד', accountId: a.id, credential: 'x' });
  DB.handle().prepare(`INSERT INTO bookings_v2 (student_id, start, "end", duration, at, status) VALUES (?, '2027-04-06T14:00:00.000Z', '2027-04-06T15:30:00.000Z', 90, '2027-01-01', 'confirmed')`).run(s.id);
  const bookingId = Number(DB.handle().prepare(`SELECT id FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get().id);
  assert.equal(await N.emailFamilyAfterReport(bookingId, { send: async () => true }), 'no-email');
});

test('the routes call them: submission from the family route, the email after a report', () => {
  const hw = read('src/routes/api/portal/[code]/homework/+server.ts');
  assert.match(hw, /noticeHomeworkSubmitted\(/);
  const reports = read('src/routes/api/reports/+server.ts');
  assert.match(reports, /emailFamilyAfterReport\(booking\.id/);
});
