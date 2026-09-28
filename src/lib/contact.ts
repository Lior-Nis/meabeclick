/**
 * The tutor's phone number, in the two forms every surface needs.
 *
 * `TUTOR_PHONE` (international digits, no `+` or separators) was a literal
 * duplicated across `src/routes/booking`, `src/routes/portal` and
 * `src/routes/app/parent`, each typing '972546969891' independently — it is
 * what `wa.me/...` and `tel:+...` links need. `TUTOR_PHONE_DISPLAY` is the
 * local form parents actually read, already hardcoded in
 * `src/lib/components/Header.svelte`'s sidebar.
 *
 * Every surface imports it from here — pages, the booking confirmation
 * email, enrollment's portal seed and the tutor's WhatsApp notifications.
 * tests/unit/tutor-roster-wiring.test.mjs fails if it is typed anywhere
 * else.
 */
export const TUTOR_PHONE = '972546969891';
export const TUTOR_PHONE_DISPLAY = '0546969891';

/** Where a family pays: the business's PayBox box (set up 2026-09-28). An
 *  app link — on a phone it opens PayBox. Said on the parent board, in the
 *  booking confirmation and in the after-lesson email; typed nowhere else
 *  (tests/unit/paybox.test.mjs). */
export const PAYBOX_LINK = 'https://links.payboxapp.com/k247i3oUN6b';
