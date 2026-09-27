---
target: user onboarding flow
total_score: 16
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 3
timestamp: 2026-09-03T06-53-10Z
slug: src-routes-booking-page-svelte
---
Method: dual-agent (A: design review · B: detector + browser evidence)

## Design Health Score — 16/40 (Poor)

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Step dots and spinner exist, but `activeDot` advances to 3 while step 2 still renders; a failed calendar write (`data.fallback`) reports as clean success; portal error has no `role="alert"`, and after a wrong password focus is dumped to `BODY`. |
| 2 | Match System / Real World | 2 | Landing sells "כפול · ₪215 · שעה וחצי"; booking says "90 דקות" with no ₪. One secret is called סיסמה, קוד, and pin across four screens. |
| 3 | User Control and Freedom | 2 | No Escape handler, no focus trap (142 of 152 focusable elements stay tabbable behind the modal), no close X, `body` overflow stays `visible` so the page scrolls behind. Android back destroys every typed field. |
| 4 | Consistency and Standards | 1 | Three password gates, three different error strings; `/app/student` enforces `צריך 4 ספרות`, a rule booking never applied. Booking's header drops the logo and three surfaces use a stale teal against the blue accent token. |
| 5 | Error Prevention | 1 | Five `alert()` calls. Zero `[required]`/`[aria-required]` on the page. Password uniqueness is global, so a valid password gets rejected. The returning toggle defaults to לא. A blank password loses the portal forever, with no warning. |
| 6 | Recognition Rather Than Recall | 1 | The password is invented once, never echoed, never sent, `autocomplete="off"`, and demanded by three later screens. The student code is never shown to the family at all. |
| 7 | Flexibility and Efficiency | 2 | Returning branch exists; `/portal` seeding both `student_pin_*` and `parent_pin_*` is genuinely efficient. No repeat-booking from inside the portal. |
| 8 | Aesthetic and Minimalist Design | 2 | Booking's desktop header leaves 1230px empty (`justify-content: normal`); hero mockup cards clip at both edges; 140 time chips across 3.2 mobile screens; duplicate booking CTA in header and sticky bar. |
| 9 | Error Recovery | 1 | `alert('שגיאה בשמירת ההזמנה: ' + e.message)` shows a raw JS error to a Hebrew-speaking parent. The `slotState === 'error'` retry UI is dead code. `.field-error` toggles `display:none` with no `aria-live`. |
| 10 | Help and Documentation | 2 | The FAQ explains signup; nothing anywhere explains the portal, the password, or the code. |
| **Total** | | **16/40** | **Poor — core experience broken** |

No heuristic scored n/a. This lands two points below Assessment A's unanchored 18 because the browser pass converted three suspicions into measurements: the confirm button is genuinely off-screen, the modal genuinely has no dialog semantics, and the primary CTA genuinely fails contrast.

## Design Specificity Verdict

**Split, and the split runs exactly along the seam that matters.**

`/` is authored: two named tutors with real photographs and tap-to-open bios, testimonials that name them, a pricing ladder in Hebrew idiom (יחיד / כפול / משולש) rather than Basic/Pro/Premium, Heebo, RTL-native, a real wordmark.

`/booking` is not. It never names a tutor, shows a face, quotes a price, or references the AI decks, parent portal, and games the hero just spent three panels selling. Change five Hebrew strings and it books dental cleanings. It builds its own `<header>` that drops the logo, and tints three surfaces `rgba(46,123,116,…)` — a dead teal against `--accent: #2563eb`. The "selected duration" badge is a teal fill inside a blue border.

`/portal` and the two app boards are generic dashboard furniture with Hebrew labels.

**The persuasion was authored for this business; the operation was ported and never re-authored.**

**Deterministic scan** — `detect.mjs` exit 2, 6 warnings: `layout-transition` ×4 (`+page.svelte:1463,1694`, `app/parent:552`, `app/student:359`), `bounce-easing` ×2 (`+page.svelte:993,1615`). `booking`, `portal`, `login`, `app/+layout`, `Header`, `Footer` scanned clean. The CLI scan was close to silent; the browser overlay was not.

**Visual overlays** — injection succeeded (title write + inline script, no CSP). `/` at 390×844 reported **57 anti-patterns**: `undersized-ui-text` ×17 (8.32–10.88px — "מצגות AI", "פורטל הורים", "התקדמות", the game chips), `low-contrast` ×15 (all `#fa8231`), `layout-transition` ×8, `kicker-above-heading` ×5, `icon-tile-stack` ×4, two infinite marquees, `skipped-heading` (h1 → h3). `/booking` step 3 at 1440×900: one finding — the **primary confirm button at 2.5:1**. `/portal?s=noga`: clean.

False positives, discarded: `body-text-viewport-edge` ×8 (off-screen marquee children, `scrollWidth === innerWidth`), `dark-glow` (element inside a dark mockup on a `#f8fafc` page), `em-dash-overuse` ×15 (— is standard Hebrew punctuation, not an LLM tell).

## Overall Impression

The landing page is the work of someone who knows this business. Everything after the CTA is a port that nobody has looked at as a *flow*.

And the flow has a hole in the middle: **the family never receives what booking created for them.** They invent a password, and it ships to the tutor's inbox. They are assigned a student code, and are never told it exists. `/portal` greets them with "כדי להיכנס צריך את הקישור שקיבלתם מניקול" — a link nobody sent. The parent portal is one of three things the hero sells, and it is unreachable by design.

The single biggest opportunity is the last 200ms of booking: the success screen already exists, is already well built, and is already the emotional peak. Put the link, the password, and the code on it — and send the same three by WhatsApp to the number you already collected.

## What's Working

**1. The success summary is authored for a real Israeli parent's record-keeping** (`booking:235-244`). Labelled rows, not a run-on sentence. `📱 הטלפון שלכם` deliberately disambiguated from the tutor's number below it, with a comment saying why. A print stylesheet (926-934) that strips everything except the summary. And `אפשר לצלם מסך של הפרטים כדי לשמור אותם` — someone thought about a camera roll, not a CRM.

**2. `openForgotPassword` (`booking:193-199`) is the best decision in the codebase.** It refuses self-service reset for a stated, correct reason, and routes recovery to a human over WhatsApp with the typed name pre-filled: `היי, שכחתי את הסיסמה לפורטל (השם שרשום: דנה)`. The tutor can act on the first message. That is a two-person business designing to its own shape instead of imitating enterprise auth.

**3. The flow never dead-ends.** `slotState === 'empty'` offers a pre-filled WhatsApp escape instead of an apology; `loadSlots()`'s catch falls back to a local generator so a server hiccup still shows real times; and server-side, a booking that fails its calendar write still emails the tutor and reports success. The booking is never lost.

## Priority Issues

### [P0] The family never receives the portal. The second half of onboarding does not exist.
**Why it matters.** The form collects a phone number and no email. `sendBookingEmail` goes to `BOOKING_EMAIL_TO` — the tutor. The portal link and the plaintext password ship only to her inbox (`email.ts:85-95, 116-128`). The success screen never mentions the portal, the link, the code, or that an account now exists. So the password field is pure cost with zero payoff, and every activation depends on the tutor manually WhatsApping a link — against the PRD's own north star of reducing her manual work. The PRD already names the gap: `אין תזכורת שיעור להורה/תלמיד, אין שחזור פין`.
**Fix.** Add a card to the success screen: the portal URL as a tappable link, a העתקת קישור button, the chosen password echoed once, and one line — `שמרו את הקישור: כאן תראו את השיעורים, שיעורי הבית והמצגות`. Send the same three by WhatsApp to the number already collected (`sendWhatsApp` exists in `lesson/queue.ts:252`; it currently only messages the tutor). Write `student_slug` to `localStorage` on success so `Header.svelte:21`'s `🎒 הדף שלי` lights up immediately.
**Suggested command:** `/impeccable onboard`

### [P0] The confirm button is not visible when the modal opens — at both viewports.
**Why it matters.** Measured: at 390×844 the modal's scroll panel ends at y=802 while the confirm button occupies y=813–864 — clipped by the panel *and* below the fold. Same at 1440×900 (panel bottom 855, button 816–867). On open, the user sees no way to submit. Compounding it: `role="presentation"` with zero `[role=dialog]`/`[aria-modal]` anywhere, no focus trap (140 time-slot buttons stay tabbable behind it), `body` overflow `visible` so the background scrolls, no close X, no Escape handler, and modal inputs at `0.95rem` = 15.2px, which makes iOS Safari zoom the viewport on all six fields. Validation is five native `alert()`s that steal focus and lose scroll position. Android back wipes the form.
**Fix.** Below 600px render the form full-screen with the confirm button in a fixed footer, not a card inside a `90vh` nested scroller. Bump modal inputs to `1rem`. Replace the five `alert()`s with inline `.field-error` + `aria-live="polite"`, and disable `.btn-confirm` until required fields validate. Add `role="dialog" aria-modal="true" aria-labelledby`, an Escape handler, a focus trap, and `body { overflow: hidden }` while open.
**Suggested command:** `/impeccable adapt`

### [P1] Global password uniqueness plus a wrongly-defaulted toggle traps returning families.
**Why it matters.** `enroll.ts:157-159` rejects any password already used by any other student: `הסיסמה הזו כבר תפוסה — נסו סיסמה אחרת`. The returning toggle (`booking:445-446`) renders **לא** pre-selected. A parent booking a second lesson — or a second child — leaves the default, types the password they set themselves, and is told their own password belongs to someone else. It is the most confusing message the system can produce, at the moment of a repeat purchase, to the most valuable customers. The alternative outcome is worse: a silent duplicate student record with its own portal, splitting the child's history in two.
**Fix.** Drop global uniqueness — identity is (name + password) and the code is already public in the URL, so it buys nothing. Make the toggle answer-required rather than defaulted: two equal cards, `🆕 שיעור ראשון אצלנו` / `↩️ כבר למדנו אצלכם`, and don't render the rest of the form until one is chosen.
**Suggested command:** `/impeccable harden`

### [P1] `/api/portal-students` publishes every enrolled child's name to anonymous visitors.
**Why it matters.** `app/parent` in `view === 'choose'` calls `/api/portal-students`, which returns `{code, name, subject}` for all students with no auth (`api/portal-students/+server.ts:9-10`) and renders them under `בחרו את שם התלמיד/ה`. A visitor who lands on `/app/parent` without `?s=` sees the full roster of other people's children. `enroll.ts`'s own `$comment` warns that the code is guessable — this endpoint then publishes every code. These are minors' names in a repo whose own CLAUDE.md treats student records as PII.
**Fix.** Require `?s=` on `/app/parent` and delete the chooser; the tutor dashboard is the only legitimate consumer of a full roster. If a chooser must stay, gate the endpoint behind a tutor session.
**Suggested command:** `/impeccable harden`

### [P1] The orange accent fails contrast everywhere, including the primary CTA.
**Why it matters.** Measured: white on `#fa8231` (the 📅 אשרו הזמנה confirm button) = **2.5:1** against a 4.5:1 requirement. `#fa8231` on white = 2.53:1, on `#f8fafc` = 2.42:1, on `#eff6ff` = 2.32:1 — that is the phone link, every section kicker, and the testimonial quote mark. Also `#94a3b8` footer copyright at 2.45:1 and `#64748b` pricing copy at 4.37:1. Separately, 17 elements on the mobile homepage render text at 8.32–10.88px, including the labels on the three feature preview cards. A parent reading in Israeli sunlight on a phone loses the CTA and the feature labels together.
**Fix.** Darken the accent for text and button fills to a variant that clears 4.5:1 on both `#ffffff` and `#f8fafc` — `tokens.css:31` already documents `--accent3` as failing and ships `--accent3-strong` for exactly this; apply the same discipline to `#fa8231`. Raise the 17 undersized labels to a 12px floor.
**Suggested command:** `/impeccable audit`

### Next tier, still real
- **[P1] No price appears anywhere in booking.** `grep -c "₪" src/routes/booking/+page.svelte` → **0**. `📅 אשרו הזמנה` commits to an amount the screen refuses to name. Landing prices (₪120/₪215/₪300) also contradict `Business Overview.md` (₪100/₪180/₪300).
- **[P2] One secret, four vocabularies.** סיסמה / קוד / pin across four screens, three different error strings, plus `/app/student`'s phantom `צריך 4 ספרות` left over from the PIN era — which locks out any parent whose password isn't four digits.
- **[P2] The portal password is `type="text"`** (`portal:82`) so it renders in plaintext on screen, and it is sent as a URL query param (`GET /api/portal/noga?pin=…`), landing in access logs, history, and referrers.
- **[P2] `/portal` has zero landmarks and zero headings** — `main:0, h1:0`; "כניסה לפורטל" is a plain `div`. `/login` has an h1 but no `main`, no `<form>`, no `<label>`.

## Persona Red Flags

**Jordan (confused first-timer)** — `בחרו סיסמה לכניסה בפעם הבאה` with placeholder **`לא חובה`**: "optional" *inside the field* reads like the expected value. He skips it, and the portal becomes permanently unreachable, with no error, ever. The hint says it opens "הלוח האישי" — never defined, never linked, never shown. He chose the site partly on ליאור's bio and is booking תכנות; no tutor was selectable, `enroll.ts:104` hardcodes `tutor: 'ניקול'`, and the success screen tells him ניקול will call. On his second booking he leaves the default לא and is told his own password is taken. If anything fails: `alert('שגיאה בשמירת ההזמנה: Unexpected token < in JSON at position 0')`.

**Casey (distracted mobile user)** — On a 390px screen `Header.svelte:285` hides `.nav-cta` below 480px, so the sticky top bar has no booking action. Tapping any of six modal fields zooms the viewport (15.2px inputs). Five `alert()`s cost him his scroll position each time. The confirm button is measured off-screen at y=813 against an 844px viewport. Android back wipes every field. Step 2 hands him 140 undifferentiated time chips over 2733px — 3.2 screens — with no מחר/השבוע filter. Touch targets: back link 84×21, החלף משך שיעור 145×35, sidebar close 32×32, scroll-top 42×42.

**אורית, אמא של יובל (כיתה ט), booking from her phone while waiting at a חוג** — Arrives from Instagram to a hero with no CTA above the fold and a hidden nav CTA at her width. She picks כפול ₪215; booking offers `90 דקות` with no ₪, so she carries the mapping herself. Step 2's `.day-label` has `text-transform: uppercase` and `letter-spacing: 0.06em` — meaningless for Hebrew and a dead giveaway of an LTR template — and `.slots-row { direction: ltr }` reverses chip reading order inside an RTL page. She fills six fields, invents `orit1985`, screenshots the summary as instructed. **Then nothing.** No SMS, no WhatsApp, no email. `orit1985` exists in her head and in ניקול's inbox. Opening the hamburger later, `🎒 הדף שלי` is hidden because `student_slug` was never written.

## Minor Observations

- **Hebrew typo in a credential, in the hero:** `+page.svelte:193` — `בהנדסת נתונית` should be `נתונים`. It is inside the bullet selling ליאור's degree.
- **RTL arrows point the wrong way** in three places: `← חזרה לאתר` (`booking:307`, `login:57`) and `← החלף משך שיעור` (`booking:362`). In an RTL document, back points right.
- **Booking's desktop header is broken** — `justify-content: normal` (`booking:515-522`) bunches both children at the inline start, leaving 1230px of empty header at 1440px.
- **Hero mockup cards clip at both edges** at both viewports; at 1440×900 the sticky CTA covers the bottom of the פורטל הורים preview, and at 390×844 it overlaps the מה תקבלו kicker. "🗓️ הזמנת שיעור" also appears twice simultaneously on desktop.
- `errorMsg` (`booking:24`) and the `slotState === 'error'` branch (370-374) are unreachable — `loadSlots()`'s catch always falls back. Dead retry UI.
- `autocomplete="off"` on all three password inputs blocks the one mechanism that could rescue this flow. Chrome also warns *"Password field is not contained in a form"* on `/booking`, blocking password-manager save on the account-creation field.
- `checkReturningAccount` fires on blur and swallows every failure (line 218), so a returning parent with a typo gets no feedback until submit.
- The parent board's `hwPending === 0` subtitle reads `הכל הוגש ✓` — false on day one. The student board celebrates `אין שיעורי בית כרגע 🎉` to a child who just enrolled. Day one is six zero-states and a `0%` bar, with no orientation and no link back to booking.
- `writePortalFile` sets `emoji: '🎓'` for every student, so every child's board opens with the identical graduation cap.
- `bk-contact` uses `var(--accent2-dim, rgba(250,130,49,0.10))` — a literal fallback for a token that exists at `tokens.css:27`. Pre-token leftover.

## Questions to Consider

1. **Why does the parent choose a password at all?** Nothing in the flow ever gives it back. A magic link sent to the phone number you already collect — the number the business already runs on via WhatsApp — deletes the password field, the recovery path, the global-uniqueness collision, the `צריך 4 ספרות` mismatch, and three inconsistent gate screens in one move.
2. **What is the day-one portal for?** The hero sells AI decks, a parent portal, and games. `enroll.ts` writes `lessons: []`, `homework: []`, `games: []`, `progress: 0`. Should that screen be a promise instead — "המצגת של השיעור שלך נבנית עכשיו, היא תופיע כאן עד יום רביעי" — given that `triggerForBooking` is already running?
3. **Two tutors are the entire brand of the landing page, and neither is choosable or mentionable downstream.** Is the ניקול-only copy a decision or drift? A parent booking תכנות is told in writing that the wrong person will call.
4. **If the tutor must manually WhatsApp every new family their portal link, is the portal currently a net time loss** by the PRD's own stated criterion?
