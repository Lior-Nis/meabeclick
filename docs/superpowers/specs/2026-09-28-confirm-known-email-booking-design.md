# A booking with a known family's email waits for that family to confirm

Todoist 6hfCvXjvFw5RJgmq. Decided by Lior, 2026-09-28: email confirmation
(not a pending family the tutor merges).

## The problem

Anyone who knows a family's email can book a lesson with it. #136 stopped
the sign-in link from coming back to them, but the booking still enrols
their child into that family's account: the real family finds a child they
do not know on their page, a lesson, and a charge.

## The rule

A booking is **held** instead of enrolled when all three hold:

1. its email belongs to an existing account;
2. the request is not signed in as that account (a child's session, another
   family's, or none);
3. it is not the tutor booking for them (`locals.authenticated`).

Everything else books exactly as today.

## Hold

- `pending_bookings` (migration 021) keeps the validated booking body, the
  account it names, the hour, and `expires_at`: 24 hours from now, or the
  lesson's start if sooner.
- The hour is taken while the hold is live: `OVERLAP_SOURCE` reads pending
  rows, so `slotTaken` and availability both see it. An expired hold stops
  matching and frees the hour. No sweeper is needed.
- The address on file gets «אשרו את השיעור», with a link to
  `/confirm-booking?t=…`. The booking page says a confirmation email was
  sent, and nothing else. No child is enrolled, and no lesson, charge,
  calendar event or tutor email exists yet.

## Confirm

- The link opens a page with the child's name, the time and the subject,
  and one button. **A GET never confirms**: mail scanners open links, and a
  confirm-on-GET would let the family's own scanner accept a stranger's
  booking.
- The button POSTs `{ confirm: token }` to `/api/book`. The hold is claimed
  atomically (`UPDATE … WHERE status = 'pending' AND expires_at > now`), so
  it is claimed once. Then the stored body runs the ordinary booking path:
  enrolment, the hour, the charge, calendar, both emails, generation.
- Clicking proves the inbox, which is what `/enter` accepts as proof too,
  so the confirming device is signed in to that family.
- Expired or already used: the page says so and offers to book again.

## Token

`p.<id>.<expMs>.<hmac>`, signed like family tokens (family-auth.ts).
`verifyFamilyToken` does not know the `p` kind, so a confirmation token can
never become a session. A family token is not a confirmation token either.

## Not in scope

- A dashboard view of pending holds. A hold lasts at most a day, and the
  tutor hears about the booking at the moment it becomes real.
- A tutor email at hold time. An hour held for a stranger who never
  confirms is not the tutor's business.
