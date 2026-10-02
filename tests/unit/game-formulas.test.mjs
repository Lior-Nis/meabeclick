// Formulas inside the games read left to right.
//
// Seen 2026-10-02 in a library lesson's two truths: «2x > 4 אז x > 2»
// displayed scrambled, its formulas and the Hebrew between them reordered
// by the right-to-left line. The deck and homework already isolate each
// formula (FormulaText.svelte, $lib/bidi.ts); the games printed text as is.
// Every piece of lesson text a game shows now goes through FormulaText.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TEXT = {
  TwoTruths: ['it.text', 'whyText'],
  ErrorHunt: ['rounds[idx].problem', 's.text', 'whyText'],
  Quiz: ['questions[idx].q', 'o.text', 'whyText'],
  Matching: ['c.text', 'shownHint', 'whyText'],
  Sequence: ['s.text'],
  Memory: ['c.text'],
  SpeedDrill: ['cur.q', 'o.text'],
  Sort: ['items[idx].text', 'b.name'],
  Table: ['c', 'r.label'],
  NumberLine: ['whyText'],
  GraphMatch: ['rounds[idx].prompt', 'o.label', 'whyText'],
  Labelling: ['b.label'],
  RoundHint: ['shown'],
};

const markup = (f) => {
  const src = readFileSync(join(process.cwd(), `src/lib/games/${f}.svelte`), 'utf8');
  return { src, body: src.slice(src.indexOf('</script>'), src.indexOf('<style') > 0 ? src.indexOf('<style') : undefined) };
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

for (const [file, exprs] of Object.entries(TEXT)) {
  test(`${file}: its lesson text goes through FormulaText`, () => {
    const { src, body } = markup(file);
    assert.match(src, /import FormulaText from '\$lib\/components\/FormulaText\.svelte';/);
    // A component inside a template string is text, not markup: the table's
    // aria-label once read «$<FormulaText …» this way.
    assert.doesNotMatch(body, /\$<FormulaText/);
    for (const e of exprs) {
      /* As a text node: `{expr}` right after a tag or text, not inside an
         attribute value and not already FormulaText's own `text={expr}`. */
      const bare = new RegExp(`(?<![=\\w"$])\\{${esc(e)}\\}`, 'g');
      assert.equal((body.match(bare) ?? []).length, 0, `${file} prints {${e}} as is`);
      assert.match(body, new RegExp(`<FormulaText text=\\{${esc(e)}\\} />`), `${file} renders ${e} with FormulaText`);
    }
  });
}
