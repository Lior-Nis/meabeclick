/**
 * A deliberately small maths notation, and a parser that refuses everything
 * else.
 *
 * ## Why not KaTeX or MathJax
 *
 * Both are maintained and MIT/Apache licensed, so licensing is not the
 * objection. Size is part of it — KaTeX is around 280KB once its fonts and
 * stylesheet are counted, on a page a child opens on a phone — but the real
 * objection is surface. They accept the whole of LaTeX and then work to make
 * that safe (`trust: false`, `\includegraphics` off, `\html...` off). The
 * task asks for "a limited and explicit output syntax", and a parser that
 * only knows nine constructs cannot be talked into a tenth.
 *
 * It also keeps the CSP intact: no remote origin, no new inline script, no
 * font download.
 *
 * ## The notation
 *
 * Formulas appear between `\(` and `\)`. Inside, exactly this is allowed:
 *
 *   \frac{a}{b}   fraction          x^{2}   power
 *   \sqrt{a}      square root       a_{1}   subscript
 *   {…}           grouping
 *   \cdot \times \div \pm \le \ge \ne \infty \pi \theta \alpha \beta
 *   digits, Latin letters, Hebrew letters, spaces,
 *   + - = < > ( ) [ ] , . : ; / |
 *
 * Anything else — a backslash command not on that list, an unbalanced brace,
 * a stray character — makes the whole formula fail to parse, and the caller
 * shows the original source text instead. Failing loudly to a readable
 * fallback beats rendering half of an equation, because half an equation is
 * wrong rather than ugly, and a child cannot tell.
 *
 * ## Guarantees this module makes
 *
 * - **Total.** Never throws. Returns null on anything it does not accept.
 * - **Bounded.** One left-to-right pass with an explicit depth cap, so no
 *   input can make it recurse or backtrack pathologically.
 * - **No HTML.** It returns data, never markup. The renderer builds elements
 *   from it; nothing is ever interpolated into innerHTML, so an injection
 *   here is not "unlikely", it has nowhere to happen.
 */

export type MathNode =
  | { k: 'text'; v: string }
  | { k: 'frac'; num: MathNode[]; den: MathNode[] }
  | { k: 'sqrt'; body: MathNode[] }
  | { k: 'sup'; base: MathNode; exp: MathNode[] }
  | { k: 'sub'; base: MathNode; idx: MathNode[] }
  | { k: 'group'; body: MathNode[] };

/** Symbols that stand for one character. Nothing here can introduce markup. */
const SYMBOLS: Record<string, string> = {
  cdot: '·', times: '×', div: '÷', pm: '±',
  le: '≤', ge: '≥', ne: '≠', infty: '∞',
  pi: 'π', theta: 'θ', alpha: 'α', beta: 'β',
};

/** One ordinary character. Hebrew is allowed because a formula can carry a
 *  Hebrew label — "שטח = ..." — and splitting that out would be worse. */
const PLAIN = /[0-9A-Za-z֐-׿+\-=<>()[\],.:;/| ]/;

/** Deep enough for any lesson formula, shallow enough that recursion is
 *  provably bounded. A nesting beyond this is a malformed answer, not a
 *  legitimate one we are refusing. */
const MAX_DEPTH = 12;

export function parseMath(src: string): MathNode[] | null {
  let i = 0;

  function parseSeq(depth: number, stopAtBrace: boolean): MathNode[] | null {
    if (depth > MAX_DEPTH) return null;
    const out: MathNode[] = [];

    while (i < src.length) {
      const c = src[i];

      if (c === '}') {
        if (stopAtBrace) return out;
        return null;                    // a close with nothing open
      }

      if (c === '{') {
        i += 1;
        const body = parseSeq(depth + 1, true);
        if (body === null || src[i] !== '}') return null;
        i += 1;
        out.push({ k: 'group', body });
        continue;
      }

      if (c === '^' || c === '_') {
        const base = out.pop();
        if (!base) return null;         // nothing to raise or lower
        i += 1;
        const arg = parseArg(depth + 1);
        if (arg === null) return null;
        out.push(c === '^' ? { k: 'sup', base, exp: arg } : { k: 'sub', base, idx: arg });
        continue;
      }

      if (c === '\\') {
        const m = /^\\([a-zA-Z]+)/.exec(src.slice(i));
        if (!m) return null;
        const name = m[1];
        i += m[0].length;

        if (name === 'frac') {
          const num = parseArg(depth + 1);
          if (num === null) return null;
          const den = parseArg(depth + 1);
          if (den === null) return null;
          out.push({ k: 'frac', num, den });
          continue;
        }
        if (name === 'sqrt') {
          const body = parseArg(depth + 1);
          if (body === null) return null;
          out.push({ k: 'sqrt', body });
          continue;
        }
        if (Object.prototype.hasOwnProperty.call(SYMBOLS, name)) {
          out.push({ k: 'text', v: SYMBOLS[name] });
          continue;
        }
        return null;                    // an unknown command fails the whole formula
      }

      if (!PLAIN.test(c)) return null;

      // Take the whole run of ordinary characters at once, so the tree stays
      // shallow and the renderer emits one text node per run.
      let j = i;
      while (j < src.length && PLAIN.test(src[j])) j += 1;
      out.push({ k: 'text', v: src.slice(i, j) });
      i = j;
    }

    // Ran out of input while a brace was still open.
    return stopAtBrace ? null : out;
  }

  /** An argument: `{...}` or exactly one following character. */
  function parseArg(depth: number): MathNode[] | null {
    if (depth > MAX_DEPTH) return null;
    if (src[i] === '{') {
      i += 1;
      const body = parseSeq(depth + 1, true);
      if (body === null || src[i] !== '}') return null;
      i += 1;
      return body;
    }
    const c = src[i];
    if (c === undefined) return null;
    if (c === '\\') {
      const m = /^\\([a-zA-Z]+)/.exec(src.slice(i));
      if (!m || !Object.prototype.hasOwnProperty.call(SYMBOLS, m[1])) return null;
      i += m[0].length;
      return [{ k: 'text', v: SYMBOLS[m[1]] }];
    }
    if (!PLAIN.test(c) || c === ' ') return null;
    i += 1;
    return [{ k: 'text', v: c }];
  }

  const nodes = parseSeq(0, false);
  if (nodes === null || i !== src.length) return null;
  return nodes;
}

export interface Segment {
  /** A formula that parsed, or null for ordinary text. */
  math: MathNode[] | null;
  /** The original source, shown verbatim when `math` is null — and what a
   *  copy of the message should carry either way. */
  raw: string;
}

/**
 * Splits an answer into text and formula segments.
 *
 * A `\(` with no `\)` is not a formula: it is text that happens to contain a
 * backslash, and treating it as an unterminated formula would swallow the
 * rest of the answer.
 */
export function splitMath(text: string): Segment[] {
  const out: Segment[] = [];
  let rest = text;

  while (rest.length) {
    const open = rest.indexOf('\\(');
    if (open === -1) break;
    const close = rest.indexOf('\\)', open + 2);
    if (close === -1) break;

    if (open > 0) out.push({ math: null, raw: rest.slice(0, open) });
    const body = rest.slice(open + 2, close);
    out.push({ math: parseMath(body), raw: body });
    rest = rest.slice(close + 2);
  }

  if (rest.length) out.push({ math: null, raw: rest });
  return out;
}
