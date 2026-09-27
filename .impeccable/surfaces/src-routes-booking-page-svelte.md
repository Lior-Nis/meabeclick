---
version: 1
slug: "src-routes-booking-page-svelte"
primary_target: "src/routes/booking/+page.svelte"
related_targets: ["src/routes/portal/+page.svelte","src/routes/app/parent/+page.svelte","src/routes/app/student/+page.svelte"]
---

## Scope and mode

The family onboarding flow, end to end: the landing CTA, `/booking`, the
confirmation handoff, `/portal`, and the first-run parent and student boards.
Mode: **Operate** throughout (the visitor completes a task), with the landing
CTA moment alone reading Persuade.

This is an extension inside an established world, not a new identity. The
landing page owns the world; booking and the portal drifted out of it (a stale
teal against the blue accent token, a header that drops the logo). Pulling them
back in IS the visual work. No concept tournament, no DESIGN.md change.

## Audience, job, task

A Hebrew-speaking parent on a phone, mid-errand, booking a lesson for a child
stuck on something this week — or an adult learner who is their own account
holder (`accounts.is_self`). Their task ends not at "booked" but at "standing
inside my own portal". The child's task is to find the homework and play it.

## Constraints

RTL Hebrew only. Phone-first: ≥16px inputs, 44px targets, thumb reach. WCAG AA
4.5:1 (the current `#fa8231` accent measures 2.5:1 and is on the primary CTA).
Email is the only channel that reaches customers; CallMeBot reaches only the
tutor. Live student PII migrates, never regenerates.

## Direction contract

**THESIS:** Onboarding ends inside the portal, not at a confirmation screen.
The flow refuses the category default where booking terminates in a receipt and
account access arrives later by separate message — here the receipt IS the door,
and the same screen that confirms the lesson opens the portal it created.

**OWN-WORLD:** The landing page's system, applied without dilution: `--accent`
blue as the single committed accent (the teal literals deleted), the wordmark
and logo present on every step, Heebo, the 22px card radius and 1.5px border of
the existing `.card`, `--bg-surface` on inset panels. Recognizable with all
content removed by its rounded-card rhythm on a light `#f8fafc` ground and one
blue action per screen.

**STORY:** "I picked a time and gave my details" → "I'm booked, and this is my
child's page" → "I sent my child their link." Belief: this is a real product
with a place for us in it, not a form that emails a stranger.

**FIRST VIEWPORT:** Booking step 3 as a full-screen sheet below 600px, not a
card in a 90vh scroller: fields in one column, the blue confirm button pinned in
a fixed footer, always visible, price on it. Above it, the chosen slot and
duration as a compact fixed summary. On confirm, the same surface becomes the
handoff: portal link, copy button, share-to-WhatsApp, and the child's join code.

**FORM:** Inherited surface extension; established world, no dealt form. New
states only: the handoff card, the magic-link landing, join-code entry, and the
day-one empty boards. Seed key: n/a — extension, no direction roll.

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the
finish review, the verdict, DESIGN.md, and every shipping raster carrying its
provenance.

## Memorable moment

The success screen growing a live portal link with the child's join code beside
it — the moment the family stops being a booking and becomes an account.

## Unresolved

- Whether the parent board shows an outstanding balance (PRD flags the gap;
  automatic collection stays rejected).
- Whether tutors become selectable at booking (landing sells two by name;
  `enroll.ts` hardcodes ניקול).
