/**
 * The tutor roster — the one place a tutor's name, photo, and bio agree.
 *
 * "ניקול" used to be typed independently into the landing page's two tutor
 * cards, the header sidebar's contact line, the dashboard subtitle, two
 * server-side fallbacks, and the booking confirmation email. Adding a third
 * tutor meant hunting all of those down by hand, and PRODUCT.md's "ready
 * for a third tutor" pillar names exactly that: no tutor name hardcoded, a
 * third tutor addable as data.
 *
 * Modeled on `src/lib/plans.ts` — a public array plus small helpers,
 * imported by both server and UI code. The phone number stays in
 * `src/lib/contact.ts`, imported directly by the surfaces that need it
 * (Header, booking, portal) rather than through this file.
 */

/** A tutor as the landing page's cards, the header, and the dashboard
 *  subtitle all render it. */
export interface Tutor {
  /** Stable slug — used for DOM ids/classes, never shown to a family. */
  id: string;
  /** The name every surface prints. */
  name: string;
  photo: string;
  alt: string;
  /** The popup's heading — the name plus its emoji, exactly as the landing
   *  page has always shown it. */
  heading: string;
  /** The popup's bullet lines, in order. */
  bio: string[];
  /**
   * Whether this is the tutor named in "לפרטים נוספים - <name>" and in the
   * booking confirmation email when no specific teacher is known. Exactly
   * one tutor sets this — `contactTutor()` throws if that invariant breaks.
   */
  contact?: boolean;
}

export const TUTORS: Tutor[] = [
  {
    id: 'nikol',
    name: 'ניקול',
    photo: '/images/nikol-modified.png',
    alt: 'ניקול',
    heading: 'ניקול 👩‍🏫',
    bio: [
      '⭐ סיימה שירות משמעותי בתפקיד בכיר',
      '📚 סטודנטית לריפוי בעיסוק',
      '👩‍🏫 ניסיון רב בהוראה פרטית',
      '🎯 מתמחה בהוראת מתמטיקה',
    ],
    contact: true,
  },
  {
    id: 'lior',
    name: 'ליאור',
    photo: '/images/lior-modified.png',
    alt: 'ליאור',
    heading: 'ליאור 👨‍🏫',
    bio: [
      '🎓 בעל תואר שני בהנדסת נתונית',
      '💻 משרת בתפקיד בכיר בצבא',
      '👨‍🏫 מדריך בתכניות סטארטק ומגשימים',
      '🎯 מתמחה בהוראת מתמטיקה',
    ],
  },
];

/** The one tutor a family is told to contact when no specific teacher is
 *  known — currently ניקול (Lior's decision, 2026-09-25). Throws rather
 *  than silently picking one if the roster is ever misconfigured, since a
 *  wrong guess here reaches a family's inbox. */
export function contactTutor(): Tutor {
  const found = TUTORS.find(t => t.contact);
  if (!found) throw new Error('TUTORS: no tutor has contact: true');
  return found;
}

/**
 * The roster's names as a Hebrew list: `א` for one, `א וב` for two — the
 * dashboard subtitle's existing "ניקול וליאור", a space then the Hebrew
 * conjunction prefixed straight onto the last name, no comma — and
 * `א, ב וג` for three or more, comma-separating every name before the
 * last and reserving the conjunction for the final pair, the way Hebrew
 * (like English) actually lists three or more items. A plain `join(' ו')`
 * only reads correctly for exactly two names, which was fine while the
 * roster only ever held two tutors.
 *
 * Takes the tutor list as a parameter (defaulting to the real roster) so a
 * test can exercise the 1/2/3+ grammar without the roster actually holding
 * that many tutors.
 */
export function tutorNames(tutors: Tutor[] = TUTORS): string {
  const names = tutors.map(t => t.name);
  if (names.length <= 1) return names.join('');
  const last = names[names.length - 1];
  const rest = names.slice(0, -1);
  return `${rest.join(', ')} ו${last}`;
}
