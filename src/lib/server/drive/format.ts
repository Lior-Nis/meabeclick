/**
 * A lesson as a Google Doc, both ways — spec
 * docs/superpowers/specs/2026-09-25-drive-student-folders-design.md D2, §3.
 *
 * Written as HTML because Drive's HTML import keeps dir="rtl" (a Markdown
 * import leaves Hebrew paragraphs left-to-right). Read back from Drive's
 * MARKDOWN export, which keeps the structure; it adds noise that is regular
 * enough to strip — "**…**" around headings, "> " before list items, "\="
 * escapes, trailing double spaces — seen verbatim in the probe fixtures in
 * tests/unit/drive-format.test.mjs.
 */
import { esc } from '../email.ts';
import type { LessonPlan } from '../lesson/prep.ts';

const EXAMPLE = 'דוגמה:';
const ANSWER = 'תשובה:';

export function planToHtml(plan: LessonPlan, meta: { subject: string; level: string; student?: string }): string {
  const p = (text: string) => `<p dir="rtl">${text}</p>`;
  const slides = plan.slides.map(s => [
    `<h2 dir="rtl">${esc(s.heading)}</h2>`,
    `<ul dir="rtl">${s.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>`,
    s.note ? p(`<i>${esc(s.note)}</i>`) : '',
  ].join('')).join('');
  const examples = plan.examples.map(e => [
    `<h2 dir="rtl">${EXAMPLE} ${esc(e.problem)}</h2>`,
    e.steps.length ? `<ol dir="rtl">${e.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : '',
    p(`<b>${ANSWER}</b> ${esc(e.answer)}`),
  ].join('')).join('');
  const line = [meta.subject, meta.level, meta.student].filter(Boolean).map(esc).join(' · ');
  return `<html dir="rtl"><head><meta charset="utf-8"></head><body dir="rtl">`
    + `<h1 dir="rtl">${esc(plan.title)}</h1>${p(line)}${slides}${examples}</body></html>`;
}

export function indexHtml(student: string, lessons: { title: string; date: string; fileId: string }[]): string {
  const items = lessons.map(l =>
    `<li><a href="https://docs.google.com/document/d/${encodeURIComponent(l.fileId)}/edit">${esc(l.title)}</a> — ${esc(l.date)}</li>`,
  ).join('');
  return `<html dir="rtl"><head><meta charset="utf-8"></head><body dir="rtl">`
    + `<h1 dir="rtl">${esc(student)} — כל השיעורים</h1>`
    + `<p dir="rtl"><i>המסמך הזה נוצר אוטומטית ומתעדכן לבד — עריכות בו לא נשמרות. עורכים בתוך מסמך השיעור עצמו.</i></p>`
    + `<ul dir="rtl">${items}</ul></body></html>`;
}

/** What parseDriveMarkdown returns: the editor's input shape, to be
 *  checked by normalizeEdit like any edit made on the site. */
export interface DriveEdit {
  title: string;
  slides: { heading: string; bullets: string[]; note?: string }[];
  examples: { problem: string; steps: string[]; answer: string }[];
}

/** One exported line, with Drive's export noise removed. */
function clean(line: string): string {
  let s = line.replace(/\s+$/, '');
  s = s.replace(/^(>\s?)+/, '').trim();               // RTL indents come back as blockquotes
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!=|>~])/g, '$1'); // backslash escapes
  return s;
}

/** Strips "**…**" (or "__…__") wrapping a whole string. */
const unbold = (s: string) => s.replace(/^\*\*(.+)\*\*$/, '$1').replace(/^__(.+)__$/, '$1').trim();

/** Formatting she typed INSIDE a line — bold, a link — as the plain text a
 *  student should see; the deck has no Markdown renderer, so "**x**" would
 *  reach a child as asterisks. */
const inline = (s: string) => s
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\*\*([^*]+)\*\*/g, '$1')
  .replace(/__([^_]+)__/g, '$1')
  .trim();

/** A Markdown table row as one bullet ("a · b"); null for the separator
 *  row. Tables are not a slide shape, but what she typed is not dropped. */
function tableRow(line: string): string | null {
  const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => inline(c.trim()));
  if (cells.every(c => /^:?-{2,}:?$/.test(c) || c === '')) return null;
  return cells.filter(Boolean).join(' · ');
}

export function parseDriveMarkdown(md: string): DriveEdit {
  const out: DriveEdit = { title: '', slides: [], examples: [] };
  type Section = { kind: 'slide'; i: number } | { kind: 'example'; i: number } | null;
  let section: Section = null;

  for (const raw of md.split(/\r?\n/)) {
    const line = clean(raw);
    if (!line) continue;

    let m: RegExpMatchArray | null;
    if ((m = line.match(/^#\s+(.+)$/))) { out.title = inline(unbold(m[1])); continue; }
    if ((m = line.match(/^##\s+(.+)$/))) {
      const heading = inline(unbold(m[1]));
      if (heading.startsWith(EXAMPLE)) {
        out.examples.push({ problem: heading.slice(EXAMPLE.length).trim(), steps: [], answer: '' });
        section = { kind: 'example', i: out.examples.length - 1 };
      } else {
        out.slides.push({ heading, bullets: [] });
        section = { kind: 'slide', i: out.slides.length - 1 };
      }
      continue;
    }
    if (!section) continue; // text above the first heading (the subject line)

    if (line.startsWith('|')) {
      const row = tableRow(line);
      if (row && section.kind === 'slide') out.slides[section.i].bullets.push(row);
      else if (row) out.examples[section.i].steps.push(row);
      continue;
    }

    const item = line.match(/^(?:[*-]|\d+\.)\s+(.+)$/)?.[1]?.trim();
    const plain = unbold(line);

    if (section.kind === 'example') {
      const ex = out.examples[section.i];
      const answer = plain.replace(/^\*\*/, '').match(new RegExp(`^${ANSWER}\\**\\s*(.*)$`));
      if (answer) ex.answer = inline(answer[1]);
      else ex.steps.push(inline(item ?? plain));
      continue;
    }

    const slide = out.slides[section.i];
    const note = line.match(/^(?:\*([^*].*[^*]|[^*])\*|_(.+)_)$/);
    if (!item && note) slide.note = inline(note[1] ?? note[2]);
    else slide.bullets.push(inline(item ?? plain)); // nothing she typed is dropped
  }
  return out;
}
