/**
 * The icon catalogue: one semantic name per thing the UI points at, and the
 * emoji each one replaces.
 *
 * ## Why there is a fallback at all
 *
 * The set is currently Lucide (ISC), vendored into ./svg — see that
 * directory's README. The fallback stays because it is what lets any single
 * icon be swapped for custom artwork, or a new name be added, without a
 * flag day: `<Icon name="x" />` renders the emoji until `svg/x.svg` exists
 * and the artwork from then on, with no code change and no intermediate
 * state where the page shows empty boxes.
 *
 * ## What is deliberately NOT here
 *
 * Two surfaces keep their emoji permanently, because an icon cannot reach
 * them:
 *
 *  - WhatsApp notifications (src/lib/server/lesson/queue.ts) are plain text
 *    through CallMeBot. There is no markup, so ⚠️/✅ are the only visual
 *    signal available.
 *  - Transactional email (src/lib/server/email.ts). Gmail and Outlook do not
 *    render inline SVG, and most clients block remote images by default, so
 *    a branded icon degrades to nothing where an emoji renders everywhere.
 *
 * A student's avatar (the `emoji` field on their portal record) is also out
 * of scope: it is per-student data, not chrome, and it is theirs.
 */

/** Every icon the UI can ask for. Adding a name here is what makes it
 *  available; adding the matching SVG is what makes it branded. */
export const ICONS = {
  // ── navigation and sections ──
  'my-page':    { fallback: '🎒', of: 'the family\'s own board' },
  subjects:     { fallback: '📚', of: 'subjects, and the lesson log' },
  games:        { fallback: '🎮', of: 'games' },
  message:      { fallback: '💬', of: 'a message to the tutor' },
  whatsapp:     { fallback: '💬', of: "a link that opens a WhatsApp chat — WhatsApp's own mark" },
  payments:     { fallback: '💳', of: 'pricing and the payments section' },
  faq:          { fallback: '❓', of: 'questions' },
  portal:       { fallback: '🎓', of: 'the parent/student portal' },
  dashboard:    { fallback: '🖥️', of: 'the tutor dashboard' },
  booking:      { fallback: '🗓️', of: 'booking a lesson' },
  calendar:     { fallback: '📅', of: 'a scheduled lesson' },
  homework:     { fallback: '📝', of: 'homework' },
  progress:     { fallback: '📈', of: 'progress' },
  slides:       { fallback: '📊', of: 'a lesson deck' },
  family:       { fallback: '👪', of: 'a parent or self-paying adult' },
  email:        { fallback: '✉️', of: 'email' },
  link:         { fallback: '🔗', of: 'a shareable link' },
  key:          { fallback: '🔑', of: 'access and credentials' },
  student:      { fallback: '🎒', of: 'a student' },

  // ── state ──
  done:         { fallback: '✅', of: 'something completed' },
  check:        { fallback: '✓',  of: 'an inline confirmation' },
  warning:      { fallback: '⚠️', of: 'something needing attention' },
  add:          { fallback: '➕', of: 'creating a record' },
  close:        { fallback: '✕',  of: 'dismissing' },
  edit:         { fallback: '✏️', of: 'editing' },
  delete:       { fallback: '🗑️', of: 'removing a record' },

  // ── moments, larger and more illustrative than the rest ──
  greeting:     { fallback: '👋', of: 'greeting a student by name' },
  celebrate:    { fallback: '🎉', of: 'nothing left to do' },
  'day-one':    { fallback: '🚀', of: 'a board with no history yet' },
  trouble:      { fallback: '😕', of: 'an answer that could not be given' },
} as const;

export type IconName = keyof typeof ICONS;

/**
 * Branded SVGs, keyed by icon name. Populated purely by what is on disk:
 * drop `calendar.svg` into ./svg/ and the calendar icon becomes branded
 * everywhere it is used.
 *
 * The try/catch matters, and it must NOT be a `typeof import.meta.glob`
 * check. Vite rewrites the CALL at build time but leaves such a check as a
 * runtime test against a property that does not exist in the built output —
 * so the guard is always false in production, the ternary takes the empty
 * branch, and every icon silently falls back to its emoji while the SVGs sit
 * in the bundle as dead code. That failure looks exactly like "the artwork
 * has not landed yet", and a grep of the bundle finds the markup and calls
 * it working. Catching the TypeError instead is true in both worlds: Vite
 * replaces the call and the try succeeds; `node --test` has no
 * import.meta.glob, so calling it throws and we fall back to {}.
 *
 * tests/unit/icons.test.mjs covers the node side; the rendered-HTML
 * assertion in tests/characterization/icons.test.mjs is what would catch a
 * regression here, because only a real render distinguishes "bundled" from
 * "used".
 */
let files: Record<string, string> = {};
try {
  files = import.meta.glob('./svg/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
} catch {
  files = {};
}

const branded = new Map<string, string>(
  Object.entries(files).map(([path, svg]) => [path.replace(/^\.\/svg\/|\.svg$/g, ''), svg]),
);

export interface ResolvedIcon {
  /** Inline SVG markup, or null while the branded asset does not exist. */
  svg: string | null;
  /** The emoji to render meanwhile. */
  fallback: string;
}

export function iconFor(name: IconName): ResolvedIcon {
  const entry = ICONS[name];
  if (!entry) throw new Error(`unknown icon "${name}" — add it to ICONS in src/lib/icons/registry.ts`);
  return { svg: branded.get(name) ?? null, fallback: entry.fallback };
}

/** Which icons are still waiting on artwork. Used by the test that keeps
 *  this list honest, and handy for a progress check while the set is drawn. */
export function pendingIcons(): IconName[] {
  return (Object.keys(ICONS) as IconName[]).filter(n => !branded.has(n));
}
