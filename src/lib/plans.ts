/**
 * The lesson ladder — the one place duration, name, and price agree.
 *
 * Three surfaces used to disagree about this. The landing page sold
 * "יחיד / כפול / משולש" with prices; the booking flow offered
 * "45 / 90 / 135 דקות" with no price anywhere in the file (a literal zero
 * occurrences of ₪); and a knowledgebase note (since folded into
 * `PRODUCT.md`) recorded a third, stale set of numbers. A parent chose a
 * named plan on one screen and then had to carry the mapping to minutes in
 * their head while committing to an amount no screen would name.
 *
 * Not server-only: the booking form, the confirmation email, and the
 * success summary all render from this, which is the point.
 *
 * Prices confirmed against the live landing page on 2026-09-03. Amounts are
 * whole shekels because that is how they are quoted and charged; the
 * payments table stores agorot for the same reason it always did (integer
 * money), and `agorot` here is what bridges the two without a float.
 */

/** The lesson kinds the payments table's CHECK constraint accepts. */
export type PlanKind = 'single' | 'double' | 'triple';

export interface Plan {
  /** Lesson length in minutes — the key every booking API already speaks. */
  minutes: number;
  /**
   * The same length as a person would say it. The landing page has always
   * sold "שעה וחצי" while booking shows "90 דקות"; carrying the phrasing as
   * data is what stops a third surface inventing a fourth wording. Booking
   * still renders minutes — that difference is now visible in one file
   * instead of spread across two templates.
   */
  duration: string;
  /** The product's own Hebrew name for this plan. */
  name: string;
  shekels: number;
  /** What the lesson is for, in the parent's terms. */
  description: string;
  icon: string;
  /** Carried as data rather than derived by a switch somewhere else, so a
   *  new plan cannot be priced here and left unrecordable in payments. */
  kind: PlanKind;
  /** How many content slides the generator is asked for (worked examples
   *  come on top). Decided by Lior, 2026-09-25: a 45-minute lesson and a
   *  135-minute one used to be asked for the same "6-10". */
  slides: number;
  /** The plan both selling pages highlight. Exactly one plan sets it. */
  recommended?: boolean;
}

export const PLANS: Plan[] = [
  { minutes: 45,  name: 'יחיד',  shekels: 120, icon: '⚡', kind: 'single', slides: 8,  duration: '45 דקות',      description: 'שיעור ממוקד על נושא אחד' },
  { minutes: 90,  name: 'כפול',  shekels: 215, icon: '📚', kind: 'double', slides: 11, duration: 'שעה וחצי',     description: 'שיעור מקיף עם זמן לתרגול', recommended: true },
  { minutes: 135, name: 'משולש', shekels: 300, icon: '🚀', kind: 'triple', slides: 14, duration: 'שעתיים ורבע', description: 'שיעור אינטנסיבי לקראת מבחן' },
];

/** The badge on the recommended plan, on the landing page and in booking. */
export const RECOMMENDED_BADGE = '⭐ הכי פופולרי';

export const planFor = (minutes: unknown): Plan | null =>
  PLANS.find(p => p.minutes === Number(minutes)) ?? null;

/** `₪215` — one formatter, so the symbol never lands on the wrong side of
 *  the number on one screen and not another in an RTL document. */
export const formatPrice = (shekels: number): string => `₪${shekels}`;

/** `כפול · 90 דקות · ₪215` — the full, unambiguous line for a summary row,
 *  an email, or a calendar description. */
export function planLabel(minutes: unknown): string {
  const plan = planFor(minutes);
  return plan
    ? `${plan.name} · ${plan.minutes} דקות · ${formatPrice(plan.shekels)}`
    : `${minutes} דקות`;
}

export const agorot = (shekels: number): number => Math.round(shekels * 100);

/** null for anything that is not a sold plan. Callers must not fall back to
 *  a default kind: an unrecognised duration is a bug worth seeing, not a
 *  'single' lesson charged at the wrong price. */
export const kindFor = (minutes: unknown): PlanKind | null =>
  planFor(minutes)?.kind ?? null;

/** The one place agorot become a string. Whole shekels print bare (₪215);
 *  agorot appear only when non-zero, so a normal balance never reads as an
 *  accountant's figure. */
export function formatAgorot(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const shekels = Math.floor(abs / 100);
  const rest = abs % 100;
  return rest === 0
    ? `${sign}₪${shekels}`
    : `${sign}₪${shekels}.${String(rest).padStart(2, '0')}`;
}
