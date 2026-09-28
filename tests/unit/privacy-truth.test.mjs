/**
 * The privacy page and the question box, from the pre-launch review,
 * 2026-09-28 (Todoist 6hfCvVrg8gVQwMjq). The page said there was no
 * measurement at all, and said nothing of the Drive folders or of a child's
 * questions going to an AI model; the question box spoke as if it were the
 * tutor. And the page promised AI tools never get the family name, while
 * the question box sent the child's full name.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f) => readFileSync(join(process.cwd(), f), 'utf8');
const privacy = () => read('src/routes/privacy/+page.svelte');

test('the question box sends the AI a first name, as the privacy page promises', () => {
  const ask = read('src/routes/api/ask/+server.ts');
  assert.match(ask, /name: firstName\(String\(student\.name \?\? ''\)\)/);
  assert.match(privacy(), /איננו מעבירים אליהם את שם המשפחה/, 'the promise it has to keep');
});

test('the question box says it is an automatic helper, not the tutor', () => {
  const s = read('src/routes/app/student/+page.svelte');
  assert.doesNotMatch(s, /אני אנסה לעזור/);
  assert.match(s, /עוזר אוטומטי/);
  assert.match(s, /aria-label="השאלה שלכם לעוזר"/, 'the input is labelled');
  assert.doesNotMatch(s, /המורה יכולה/, 'no gender assumed for the tutor');
});

test('the privacy page tells the truth about measurement', () => {
  const p = privacy();
  assert.doesNotMatch(p, /אין באתר שלנו כלי מדידה/, 'there is first-party measurement');
  assert.match(p, /מזהה אקראי/);
  assert.match(p, /הדפדפן שומר\s+מזהה אקראי \(לא עוגייה\)/);
  assert.match(p, /365 יום|שנה/);
  assert.match(p, /לא Google\s+Analytics|לא Google Analytics/, 'and still no third-party tools');
});

test('the privacy page names the question box and the Drive folders', () => {
  const p = privacy();
  assert.match(p, /תיבת\s+השאלות/);
  assert.match(p, /Google Drive/);
});
