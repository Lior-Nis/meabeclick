/**
 * Formulas inside Hebrew text, each kept left to right.
 *
 * In a right-to-left paragraph "ב. 5-2x+4=9-2x" is not laid out as one
 * formula: digits and Latin letters form separate directional runs, and the
 * minus and equals signs between them take the paragraph's direction, so
 * the parts come out reordered. Wrapping each formula in its own
 * left-to-right isolate (FormulaText.svelte) keeps it whole, and leaves the
 * Hebrew around it alone.
 *
 * A formula starts at a digit, a Latin letter or "(", and ends at one of
 * those, ")" or a superscript; spaces and maths symbols may sit inside it,
 * sentence punctuation after it stays outside. Plain digits are left as
 * they are: alone, they already read right. A minus directly before it
 * belongs to it — unless a Hebrew letter precedes the minus, because «ל-16»
 * is the prefix hyphen of "to 16", not a negative number.
 */
const FORMULA = /(?:(?<![֐-׿])[-−])?[0-9A-Za-z(](?:[0-9A-Za-z+\-−*/=^().,:;<>≤≥×·÷√²³% ]*[0-9A-Za-z)²³%])?/g;

export interface FormulaRun { text: string; ltr: boolean }

export function formulaRuns(text: string): FormulaRun[] {
  const out: FormulaRun[] = [];
  let at = 0;
  const plain = (t: string) => {
    const prev = out[out.length - 1];
    if (prev && !prev.ltr) prev.text += t; else out.push({ text: t, ltr: false });
  };
  for (const m of text.matchAll(FORMULA)) {
    const start = m.index ?? 0;
    if (start > at) plain(text.slice(at, start));
    /* Digits alone already read right inside Hebrew («שיעור 1», «2026»):
       only a run with a sign, an operator or a letter needs its own
       direction. */
    if (/^\d+$/.test(m[0])) plain(m[0]); else out.push({ text: m[0], ltr: true });
    at = start + m[0].length;
  }
  if (at < text.length) plain(text.slice(at));
  return out;
}
