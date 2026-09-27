/**
 * The brand values a generated deck has to agree with the site about.
 *
 * A lesson deck is a stand-alone HTML file: it cannot import tokens.css at
 * runtime, so its palette has to be written into the document. Until now
 * that was a literal inside renderSlides — a hand-copy of the site's tokens
 * under different names (`--brand` for `--accent`, `--cta` for `--accent2`,
 * `--mint` for `--accent3`).
 *
 * The copies happen to agree today; every one of the eight values matches.
 * Nothing kept them that way, and Todoist id:6hRhqRXHcGj9m98H names exactly
 * that risk: «אי־התאמה אפשרית בין צבעי האתר לבין הנחיות יצירת חומרי הלימוד,
 * ולכן כל יצירה חדשה עלולה להמציא שפה חזותית אחרת».
 *
 * This is now the one place the deck reads from, and
 * tests/unit/brand-tokens.test.mjs asserts every value still equals the
 * matching token in src/lib/styles/tokens.css. A change to either side that
 * is not made to both is a failing test rather than a deck that quietly
 * stops looking like the site.
 *
 * This is the third hand-copied shape fixed today (see
 * $lib/progress-facts.ts and $lib/skill-suggestion.ts). The lesson is the
 * same each time: a duplicate that agrees at the moment it is written is
 * still a duplicate.
 */

/** Deck variable name → the token in tokens.css it must equal. */
export const DECK_TOKEN_SOURCE: Record<string, string> = {
  bg: '--bg-base',
  card: '--bg-card',
  text: '--text-primary',
  muted: '--text-muted',
  brand: '--accent',
  cta: '--accent2',
  mint: '--accent3',
  border: '--border',
};

export const DECK_PALETTE: Record<string, string> = {
  bg: '#f8fafc',
  card: '#ffffff',
  text: '#1e293b',
  muted: '#64748b',
  brand: '#2563eb',
  cta: '#fa8231',
  mint: '#10b981',
  border: '#e2e8f0',
};

/** The site's type face, so a deck and a page never disagree about it. */
export const DECK_FONT = "'Heebo', sans-serif";

/** The `:root{...}` block a stand-alone document needs. */
export function deckRootCss(): string {
  const vars = Object.entries(DECK_PALETTE).map(([k, v]) => `--${k}:${v}`).join(';');
  return `:root{${vars}}`;
}
