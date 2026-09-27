/**
 * The lesson document's format, both ways. The two fixtures below are
 * VERBATIM Markdown exports from Google Drive (production probe,
 * 2026-09-25): one from a Markdown import, one from the HTML import this
 * code actually uses — whose export wraps headings in ** and lists in "> ".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = await mkdtemp(join(tmpdir(), 'drive-format-'));
const F = await import('../../src/lib/server/drive/format.ts');
const { normalizeEdit } = await import('../../src/lib/server/lesson/editing.ts');

const FROM_HTML_IMPORT = `# **שיעור בדיקה**

## **מה זה אחוז**

> * חלק ממאה  
> * 50% \\= חצי

*הערה על השקף*

## **דוגמה: 20% מ-50**

> 1. 0.2·50

**תשובה:** 10
`;

const FROM_MD_IMPORT = `# שיעור בדיקה

## מה זה אחוז

- חלק ממאה  
- 50% \\= חצי

>   
> הערה על השקף

## דוגמה: 20% מ-50

1. 0.2·50

**תשובה:** 10
`;

const EXPECTED = {
  title: 'שיעור בדיקה',
  slides: [{ heading: 'מה זה אחוז', bullets: ['חלק ממאה', '50% = חצי'], note: 'הערה על השקף' }],
  examples: [{ problem: '20% מ-50', steps: ['0.2·50'], answer: '10' }],
};

test('the export of the HTML import parses back to the lesson', () => {
  assert.deepEqual(F.parseDriveMarkdown(FROM_HTML_IMPORT), EXPECTED);
});

test('a plain Markdown export parses the same way (a blockquote line is a bullet, not lost)', () => {
  const r = F.parseDriveMarkdown(FROM_MD_IMPORT);
  assert.equal(r.title, EXPECTED.title);
  assert.deepEqual(r.examples, EXPECTED.examples);
  assert.ok(r.slides[0].bullets.includes('חלק ממאה'));
  assert.ok(r.slides[0].bullets.includes('הערה על השקף'), 'text she typed is never dropped');
});

test('what the parser returns passes the editor\'s own rules', () => {
  assert.equal(normalizeEdit(F.parseDriveMarkdown(FROM_HTML_IMPORT)).ok, true);
});

test('a lesson written as HTML is right-to-left, escaped, and reads back as itself', () => {
  const plan = {
    title: 'אחוזים <b>', gradeContext: 'כיתה ט',
    slides: [{ heading: 'מה זה אחוז', bullets: ['חלק ממאה'], note: 'שימו לב' }],
    examples: [{ problem: '20% מ-50', steps: ['0.2·50'], answer: '10' }],
    homework: [], games: {},
  };
  const html = F.planToHtml(plan, { subject: 'מתמטיקה', level: 'כיתה ט', student: 'דנה' });
  assert.match(html, /<html dir="rtl"/);
  assert.match(html, /אחוזים &lt;b&gt;/);
  assert.match(html, /<h2 dir="rtl">מה זה אחוז<\/h2>/);
  assert.match(html, /<h2 dir="rtl">דוגמה: 20% מ-50<\/h2>/);
  assert.match(html, /<b>תשובה:<\/b> 10/);
});

test('the index links every lesson, newest first, and says it is generated', () => {
  const html = F.indexHtml('דנה', [
    { title: 'שיעור ב', date: '2027-02-01', fileId: 'B' },
    { title: 'שיעור א', date: '2027-01-01', fileId: 'A' },
  ]);
  assert.match(html, /נוצר אוטומטית/);
  assert.ok(html.indexOf('/d/B/') < html.indexOf('/d/A/'));
  assert.match(html, /href="https:\/\/docs\.google\.com\/document\/d\/B\/edit"/);
});

/* Deferred from #132's review, closed 2026-09-28: formatting she types in
   Google Docs must not reach a student as Markdown symbols. */
test('inline bold, links and tables come back as plain text', () => {
  const md = `# שיעור

## הגדרה

> * מספר **ראשוני** מתחלק רק ב-1 ובעצמו
> * ראו [סרטון הסבר](https://example.com/v)

| מספר | ראשוני? |
| :---- | :---- |
| 7 | כן |

## **דוגמה:** האם 9 ראשוני?

> 1. 9 = 3·3

**תשובה:** לא
`;
  const r = F.parseDriveMarkdown(md);
  assert.deepEqual(r.slides[0].bullets, [
    'מספר ראשוני מתחלק רק ב-1 ובעצמו',
    'ראו סרטון הסבר',
    'מספר · ראשוני?',
    '7 · כן',
  ]);
  assert.deepEqual(r.examples, [{ problem: 'האם 9 ראשוני?', steps: ['9 = 3·3'], answer: 'לא' }],
    'a partly bold «דוגמה:» heading is still an example');
});
