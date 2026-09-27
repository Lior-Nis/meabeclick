/**
 * The single source for "איך שמעתם עלינו?" — the marketing funnel's
 * optional self-report question (migration 016, bookings_v2.heard_from).
 *
 * Three call sites used to each carry their own copy of the same five
 * value→label pairs: src/routes/api/book/+server.ts's HEARD_FROM_VALUES
 * (server-side validation), src/routes/booking/+page.svelte's <option>s
 * (what a family actually sees), and now src/routes/app/marketing's report
 * (what the tutor sees these answers labelled as). A fourth copy drifting
 * out of sync — a Hebrew label edited in one place but not the others, or a
 * sixth value added to the select without teaching the server about it —
 * would either silently drop an answer (sanitizeHeardFrom rejects anything
 * not in its own set) or show the tutor a raw value string ("school")
 * instead of a label. Hoisting to one array closes that gap: every reader
 * derives both its value set and its labels from the same five rows.
 *
 * Plain data, no imports — safe for a $server file (api/book), a Svelte
 * component (booking/+page.svelte) and a page that renders in the browser
 * (app/marketing) to all import identically.
 */
export interface HeardFromOption {
  value: string;
  label: string;
}

export const HEARD_FROM_OPTIONS: readonly HeardFromOption[] = [
  { value: 'friend', label: 'חבר/ה או משפחה' },
  { value: 'instagram', label: 'אינסטגרם' },
  { value: 'google', label: 'גוגל' },
  { value: 'school', label: 'בית ספר או מורה' },
  { value: 'other', label: 'אחר' },
];

/** Exactly the values api/book's isComplete-adjacent sanitizeHeardFrom
 *  checks a submitted answer against — see that file's HEARD_FROM_VALUES
 *  (now re-exported from here rather than declared locally). */
export const HEARD_FROM_VALUES: ReadonlySet<string> =
  new Set(HEARD_FROM_OPTIONS.map(o => o.value));

/** value → Hebrew label, for a reader (the report) that only has the raw
 *  string a booking was stored with and needs to show a human something. */
export const HEARD_FROM_LABELS: Readonly<Record<string, string>> =
  Object.fromEntries(HEARD_FROM_OPTIONS.map(o => [o.value, o.label]));
