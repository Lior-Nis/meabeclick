/**
 * Direct port of api/book.js, wired into the same race defense
 * server/app.mjs used to bolt on from outside: enrolment and
 * reserveBooking() both run SYNCHRONOUSLY, before any of book()'s async
 * calendar/email work starts — that (not this file) is what stops two
 * parents booking the same hour at once (see reserveBooking's doc comment
 * in src/lib/server/entities.ts). A taken hour returns 409 with the frozen
 * Hebrew message and book() is never called at all.
 *
 * The order is enrol → reserve → charge → book(). A booking row names a
 * student, so the family has to exist before the hour can be claimed, and
 * the charge has to be written while the request still owns the hour —
 * never after an await on Google or on SMTP.
 *
 * Express's version needed a `res.on('finish')` hook to observe book()'s
 * outcome from OUTSIDE the ported (req, res) handler, because that handler
 * owned res and nothing else could see what it decided. Owning the whole
 * request here, the outcome is just book()'s return value — the hook has
 * no equivalent and is not reproduced.
 *
 * Generation (triggerForBooking) is fire-and-forget and must never delay
 * or block the response — it is not awaited.
 */
import { json, type Cookies } from '@sveltejs/kit';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { flagCalendarFailure } from '$server/db.ts';
import { reserveBooking, slotTaken, cancelBooking, findAccountByEmail, type AccountRow } from '$server/entities.ts';
import { holdBooking, pendingById, claimPending, confirmLink } from '$server/pending-bookings.ts';
import { recordEvent, VISITOR_ID_RE } from '$server/marketing.ts';
import { HEARD_FROM_VALUES } from '$lib/marketing-labels.ts';
import { addPayment, lessonDateInIsrael, voidChargeForBooking } from '$server/payments.ts';
import { enrollFromBooking, EnrollError, type EnrollResult } from '$server/enroll.ts';
import { sendBookingEmail, sendFamilyBookingEmail, sendConfirmBookingEmail, type EnrolledForEmail } from '$server/email.ts';
import { accountLink } from '$server/family-auth.ts';
import { triggerForBooking, sendWhatsApp, type Booking } from '$server/lesson/queue.ts';
import { addLessonRequest } from '$server/requests.ts';
import { readJson } from '$server/http.ts';
import { planLabel, planFor, kindFor, agorot } from '$lib/plans.ts';
import { setFamilySession, verifyPendingToken } from '$server/family-auth.ts';
import type { RequestHandler } from './$types';
import { SUBJECT } from '$lib/subjects.ts';

const TZ = 'Asia/Jerusalem';

interface BookBody {
  name?: string;
  subject?: string;
  /** The parent's optional note toward this lesson — a request, never a
   *  diagnosis. `topic` is the pre-rename field name, accepted only so a
   *  booking page a parent already has open does not lose what they typed;
   *  see resolveRequest() below. */
  request?: string;
  /** @deprecated use `request` — kept as a fallback, see resolveRequest(). */
  topic?: string;
  phone?: string;
  email?: string;
  level?: string;
  start?: string;
  end?: string;
  durationMin?: number;
  code?: string;
  /** The person booking is the person learning — no parent in the loop. */
  isSelf?: boolean;
  /** First-touch UTM + visitor id, sent by src/lib/marketing.ts's
   *  attribution() — see sanitizeAttribution() below for how this
   *  unvalidated shape becomes the booking's `source_utm` column and the
   *  server-written `lesson_scheduled` event's UTM columns. */
  attribution?: {
    utm?: { source?: string; medium?: string; campaign?: string; content?: string };
    visitorId?: string;
  };
  /** The optional "איך שמעתם עלינו?" self-report — see HEARD_FROM_VALUES. */
  heardFrom?: string;
}

/**
 * A body carrying every field a booking cannot do without.
 *
 * Checked in POST rather than in book(), because the check now has to run
 * BEFORE enrolment: enrolling a family and then rejecting their request for
 * a missing field would leave an account behind for a booking that never
 * happened. Expressed as a type predicate so book() can read the fields as
 * the strings they are without re-asking the same question.
 */
type ConfirmedBookBody = BookBody & {
  name: string; subject: string; phone: string;
  level: string; start: string; end: string;
};

/* durationMin is checked through planFor, not for mere presence: it is what
   prices the lesson, and an unpriceable duration used to reserve the hour,
   answer 200 and then only console.error — a free lesson nothing on any
   screen would ever surface. Refusing here puts the rejection BEFORE the
   hour is claimed. */
const isComplete = (b: BookBody): b is ConfirmedBookBody =>
  !!(b.name && b.subject && b.phone && b.level && b.start && b.end)
  && planFor(b.durationMin) !== null;

// lesson_requests.text is unbounded TEXT and the booking textarea has no
// server-enforced limit of its own — see the matching maxlength on both
// textareas in +page.svelte. Keep this number in sync with those.
const MAX_REQUEST_LEN = 500;

// Same cap marketing.ts's recordEvent applies to every string it stores —
// keeping the two in sync means a UTM value that fits here always fits the
// marketing_events row the lesson_scheduled event (below) copies it into.
const ATTRIBUTION_MAX_LEN = 100;

function attributionString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s ? s.slice(0, ATTRIBUTION_MAX_LEN) : undefined;
}

interface Attribution {
  utm: { source?: string; medium?: string; campaign?: string; content?: string };
  visitorId?: string;
}

/**
 * Validates the client-claimed `attribution`: every UTM sub-field must be a
 * string (capped at 100 chars) or absent, and the visitor id must ALSO look
 * like what `initMarketing` mints — `marketing.ts`'s `VISITOR_ID_RE`, the
 * same check `/api/events` applies (task 4) — or absent; anything else (a
 * number, an object, an over-length string, a malformed visitor id) is
 * simply dropped rather than failing the whole request. Attribution is
 * measurement, never a required field: a malformed value here must never be
 * the reason a family cannot book a lesson. Returns null when nothing
 * usable survives, so callers can treat "no attribution" and "attribution
 * failed to parse" identically.
 */
function sanitizeAttribution(raw: unknown): Attribution | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const utm: Attribution['utm'] = {};
  if (r.utm && typeof r.utm === 'object') {
    const u = r.utm as Record<string, unknown>;
    const source = attributionString(u.source);
    const medium = attributionString(u.medium);
    const campaign = attributionString(u.campaign);
    const content = attributionString(u.content);
    if (source) utm.source = source;
    if (medium) utm.medium = medium;
    if (campaign) utm.campaign = campaign;
    if (content) utm.content = content;
  }

  const rawVisitorId = attributionString(r.visitorId);
  const visitorId = rawVisitorId && VISITOR_ID_RE.test(rawVisitorId) ? rawVisitorId : undefined;
  if (!Object.keys(utm).length && !visitorId) return null;
  return { utm, visitorId };
}

/** One of the five self-report choices, or null for anything else — a
 *  stale client or a tampered request becomes "no answer", never a
 *  rejected booking over what is explicitly an optional question. */
function sanitizeHeardFrom(raw: unknown): string | null {
  return typeof raw === 'string' && HEARD_FROM_VALUES.has(raw) ? raw : null;
}

/** `request` is the current field name; `topic` is a deprecated one-line
 *  fallback for a client that hasn't picked up the rename yet — see the
 *  comment on BookBody.topic.
 *
 *  Wrapped in String() before trimming: BookBody is only a compile-time
 *  shape over an unvalidated JSON body, and isComplete() never inspects
 *  `request`/`topic` — it's optional, so nothing else checks its runtime
 *  type either. A non-string value (e.g. `{"request": 5}`) used to reach
 *  `.trim()` directly and throw mid-booking, after the family was already
 *  enrolled and the hour claimed. String() wraps the RESULT of the `??`
 *  chain, not each operand — so an explicit `request: ''` (nullish-safe,
 *  since `''` isn't nullish) still short-circuits the fallback to a stale
 *  `topic` instead of being coerced away first. See enroll.ts's
 *  `String(x || '').trim()` for the same coercion pattern used elsewhere
 *  in this codebase. */
const resolveRequest = (b: BookBody): string =>
  String(b.request ?? b.topic ?? '').trim().slice(0, MAX_REQUEST_LEN);

interface BookResult {
  status: number;
  responseBody: unknown;
  enrolledCode: string | null;
  /**
   * The account to sign in, or null to sign nobody in.
   *
   * Set ONLY when this booking created the account. Not a caution — a
   * necessity: enrollFromBooking matches an existing family by EMAIL ALONE
   * (findAccountByEmail), and this endpoint is unauthenticated and
   * CORS-open. Signing in whoever booked would mean anyone who knows a
   * family's email address can book a lesson and land inside that family's
   * portal, reading their children's homework and their outstanding
   * balance. A brand-new account has nothing to leak: the session grants
   * access to exactly the data the booker just created about themselves.
   *
   * Returning families are unaffected in practice. Their session already
   * lasts six months, so a device they have used before is still signed in;
   * a genuinely new device uses the link, which is now good for a year.
   */
  signInAccountId: number | null;
}

/**
 * What the success screen needs to hand the family their portal on the spot,
 * rather than telling them to wait for an email that may be slow, filtered,
 * or typo'd into someone else's inbox. The email is the durable copy; this
 * is the immediate one.
 */
interface PortalHandoff {
  link: string;
  code: string;
  studentName: string;
  isNewFamily: boolean;
}

/**
 * Service-account credentials.
 *
 * Preferred: GOOGLE_SERVICE_ACCOUNT_KEY_FILE, the path to the JSON Google
 * gives you. A PEM cannot survive a round trip through an env file —
 * systemd's EnvironmentFile eats the backslashes, so "\n" arrives as "n"
 * and the key no longer decodes. Reading the file keeps the newlines
 * intact.
 */
function serviceAccount(): { email: string; privateKey: string } | null {
  const file = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  if (file) {
    try {
      const j = JSON.parse(readFileSync(file, 'utf8'));
      if (j.client_email && j.private_key) {
        return { email: j.client_email, privateKey: j.private_key };
      }
      console.error('[book] key file is missing client_email/private_key');
    } catch (err) {
      console.error('[book] cannot read key file:', (err as Error).message);
    }
    return null;
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!email || !raw) return null;

  const privateKey = raw.replace(/\\n/g, '\n');
  if (!privateKey.includes('\n')) {
    console.error('[book] private key has no line breaks — set GOOGLE_SERVICE_ACCOUNT_KEY_FILE instead');
    return null;
  }
  return { email, privateKey };
}

function b64url(str: string): string {
  return Buffer.from(str).toString('base64url');
}

function buildJWT(email: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      iss: email,
      scope: 'https://www.googleapis.com/auth/calendar.events',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    }),
  );
  const data = `${header}.${payload}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(data);
  const signature = sign.sign(privateKey, 'base64url');
  return `${data}.${signature}`;
}

async function getAccessToken(email: string, privateKey: string): Promise<string> {
  const jwt = buildJWT(email, privateKey);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  /* Read as text first — Google doesn't always return JSON (a plain
     "Forbidden." body has been seen here). Parsing straight to JSON on a
     non-OK response crashed with an opaque "Unexpected token" instead of
     the actual reason the token request failed. */
  const raw = await r.text();
  if (!r.ok) throw new Error(`Token error ${r.status}: ${raw.slice(0, 300)}`);

  let data: { access_token?: string };
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Token response was not JSON: ${raw.slice(0, 300)}`);
  }
  return data.access_token ?? '';
}

/**
 * Ported from api/book.js's default export, minus the (req, res)/CORS/
 * OPTIONS/method-check plumbing SvelteKit's routing already handles.
 * Returns the outcome instead of writing to a response object, so the
 * caller (POST below) can decide what to do next — that's the whole reason
 * the res.on('finish') hook doesn't need porting.
 */
async function book(
  body: ConfirmedBookBody, enrolled: EnrollResult | null,
  /** The family account this request is signed in as, if any. */
  sessionAccountId: number | null,
): Promise<BookResult> {
  /* Takes the narrowed body: POST has already checked these with
     isComplete() and enrolled the family — see the comment on
     ConfirmedBookBody. Re-checking here would be a second answer to the
     question of what a booking needs. */
  const { name, subject, phone, email, level, start, end, durationMin } = body;
  const requestText = resolveRequest(body);

  /* No fallback. A default calendar is a personal address in disguise: with
     CALENDAR_ID unset — a fresh box, a typo, an .env that did not load —
     every booking in the system silently lands on ONE person's calendar.
     With a single tutor that is invisible; with two it is a misrouting bug
     that presents as "the calendar didn't sync", which is a long way from
     "the calendar id was missing".

     checkEnv() requires it at boot, so reaching here without one means the
     variable was removed after start; refusing is the honest answer. Which
     calendar a lesson belongs on becomes a per-teacher question once there
     is more than one tutor — enrollments.teacher_id already records who
     teaches each subject, so that lookup replaces this constant rather than
     working around it. */
  const calendarId = process.env.CALENDAR_ID;
  if (!calendarId) throw new Error('CALENDAR_ID is not set — refusing to guess which calendar a lesson belongs on');
  const sa = serviceAccount();

  const booking = { name, subject, request: requestText, phone, email, level, start, durationMin };

  /* Enrolment used to happen here. It now happens in POST, ahead of the
     reservation, because a booking row names a student — so the family has
     to exist before the hour can be claimed. What arrives here is its
     result, or null when enrolment failed for an unexpected reason: a
     booking that could not be enrolled is still a booking, and is never
     lost over it. */
  const enrolledCode = enrolled?.student?.code ?? null;

  /* The link is minted once and used three ways: the tutor's record, the
     family's email, and the success screen's copy button. Minting it here
     rather than in each sender is what guarantees all three are the same
     link. */
  const forEmail: EnrolledForEmail | null = enrolled ? {
    created: enrolled.created,
    accountCreated: enrolled.accountCreated,
    student: { code: enrolled.student.code, name: enrolled.student.name },
    portalLink: accountLink(enrolled.account.id),
    teacherName: enrolled.teacherName,
  } : null;

  /* Only a family this booking brought into existence. See BookResult. */
  const signInAccountId = enrolled?.accountCreated ? enrolled.account.id : null;

  /* Who may be handed this family's link and child code in the RESPONSE.
     Only the family this booking created, or the same family signed in.

     An existing family is found by the email typed into the form, and the
     link used to come back to whoever typed it — valid for a year — so
     anyone who knew a parent's email could book once and open their portal:
     children, lessons, balance (found in the pre-launch review, 2026-09-28).
     For everyone else the link goes only to the email on file, which the
     family email below already does, and the page says so (linkEmailed). */
  const mayHandOver = !!enrolled
    && (enrolled.accountCreated || enrolled.account.id === sessionAccountId);

  const handoff: PortalHandoff | null = forEmail && mayHandOver ? {
    link: forEmail.portalLink,
    code: forEmail.student.code,
    studentName: forEmail.student.name,
    isNewFamily: forEmail.accountCreated,
  } : null;

  /* Both messages, never one. A failure to reach the family must not cost
     the tutor her record, and vice versa — so they settle independently
     and neither can reject the other. */
  const notify = async (inCalendar: boolean) => {
    const [tutor, family] = await Promise.all([
      sendBookingEmail(booking, inCalendar, forEmail).catch(err => {
        console.error('[book] tutor email failed:', (err as Error).message);
        return false;
      }),
      forEmail
        ? sendFamilyBookingEmail(booking, forEmail).catch(err => {
            console.error('[book] family email failed:', (err as Error).message);
            return false;
          })
        : Promise.resolve(false),
    ]);
    return { emailed: tutor, familyEmailed: family };
  };

  // Without a service account there is no calendar write, but the booking
  // must not be lost — the email is the record, and the tutor adds it by
  // hand.
  if (!sa) {
    const sent = await notify(false);
    return { status: 200, responseBody: { ok: false, fallback: true, ...sent, portal: handoff, linkEmailed: !!forEmail && !mayHandOver }, enrolledCode, signInAccountId };
  }

  let created: { id: string };
  try {
    // ── Get access token via service account JWT ──────────────────────
    const token = await getAccessToken(sa.email, sa.privateKey);

    // ── Build event ─────────────────────────────────────────────────────
    const event = {
      summary: `שיעור — ${name} — ${subject}`,
      description: [
        `👤 שם: ${name}`,
        `📖 מקצוע: ${subject}`,
        `❓ בקשה לשיעור: ${requestText || '—'}`,
        `🎓 כיתה/רמה: ${level}`,
        `📱 טלפון: ${phone}`,
        `✉️ מייל: ${email || '—'}`,
        `💳 ${planLabel(durationMin)}`,
      ].join('\n'),
      start: { dateTime: start, timeZone: TZ },
      end: { dateTime: end, timeZone: TZ },
      colorId: '6', // tangerine — visible at a glance
    };

    const r = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      },
    );

    if (!r.ok) {
      const errBody = await r.text();
      throw new Error(`Calendar error ${r.status}: ${errBody.slice(0, 300)}`);
    }
    created = await r.json();
  } catch (err) {
    /* A service account that's *configured but broken* (expired creds, or
       the documented PEM-mangled-by-env-file bug) must fail exactly like
       no service account at all — never lose the booking, and never fail
       silently. flagCalendarFailure() gives the dashboard something to
       alert on, since the parent-facing email alone is easy to miss. */
    console.error('[book] calendar write failed:', (err as Error).message);
    flagCalendarFailure(booking, (err as Error).message);
    const sent = await notify(false);
    return { status: 200, responseBody: { ok: false, fallback: true, ...sent, portal: handoff, linkEmailed: !!forEmail && !mayHandOver }, enrolledCode, signInAccountId };
  }

  // Previously only the fallback path notified the tutor, so a successful
  // booking arrived silently in the calendar. Now every booking emails.
  const sent = await notify(true);

  return { status: 200, responseBody: { ok: true, eventId: created.id, ...sent, portal: handoff, linkEmailed: !!forEmail && !mayHandOver }, enrolledCode, signInAccountId };
}

export const POST: RequestHandler = async ({ request, cookies, locals }) => {
  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;

  /* The family confirming, from their inbox, a booking held for them —
     see holdForConfirmation below. */
  const confirm = (parsed as { confirm?: unknown } | null)?.confirm;
  if (typeof confirm === 'string') return confirmHeld(confirm, cookies);

  /* The form no longer asks for a subject — every lesson is maths — so a
     booking that names none is a maths booking. One that names another
     is still recorded as it says. */
  const body = { ...(parsed as BookBody) };
  if (!String(body.subject ?? '').trim()) body.subject = SUBJECT;

  /* Moved up from book(): an incomplete request has to be refused BEFORE
     enrolment, or a request nobody can honour would still leave an account
     and a student behind. */
  if (!isComplete(body)) {
    return json({ error: 'חסרים פרטים' }, { status: 400 });
  }

  // Sanitized once, up front, and reused both for the booking row's own
  // source_utm/heard_from columns (reserveBooking, below) and for the
  // server-written lesson_scheduled event (near the bottom of this
  // handler) — so the two can never disagree about what this booking's
  // attribution was.
  const attribution = sanitizeAttribution(body.attribution);
  // A returning family's session already answers "how did you hear about
  // us?" by existing — the booking page hides the question for them
  // (`{#if !data.known}` in +page.svelte). This is the server-side
  // backstop: even a stale client or a forged request must not attach a
  // self-report answer to a family the tutor already knows how she reached.
  const heardFrom = locals.family ? null : sanitizeHeardFrom(body.heardFrom);

  /* A family we already know by the email typed in, and a visitor who is
     not signed in as them and is not the tutor booking for them. Anyone who
     knows a parent's email could otherwise put a child, a lesson and a
     charge on that family's page (pre-launch review, 2026-09-28). The hour
     is held and the address on file is asked; nothing is enrolled until
     they answer. docs/superpowers/specs/2026-09-28-confirm-known-email-booking-design.md */
  const signedInAs = locals.family?.kind === 'account' ? locals.family.id : null;
  const known = findAccountByEmail(body.email);
  if (known && known.id !== signedInAs && !locals.authenticated) {
    return holdForConfirmation(body, known, { attribution, heardFrom });
  }

  return completeBooking(body, {
    cookies, sessionAccountId: signedInAs, byTutor: !!locals.authenticated, attribution, heardFrom,
  });
};

interface CompleteCtx {
  cookies: Cookies;
  /** The family account this request is signed in as, if any. */
  sessionAccountId: number | null;
  /** The tutor booking for a family: not a step in anyone's funnel. */
  byTutor: boolean;
  attribution: Attribution | null;
  heardFrom: string | null;
}

/** Holds the hour for a known family and asks the address on file. Nothing
 *  is awaited between the check and the hold, as with reserveBooking. */
async function holdForConfirmation(
  body: ConfirmedBookBody, account: AccountRow,
  extra: { attribution: Attribution | null; heardFrom: string | null },
): Promise<Response> {
  if (slotTaken(body.start, body.end)) {
    return json({ error: 'השעה הזו כבר תפוסה' }, { status: 409 });
  }
  const id = holdBooking({ accountId: account.id, body: { ...body, attribution: extra.attribution, heardFrom: extra.heardFrom } });
  const held = pendingById(id);
  const emailed = held && account.email
    ? await sendConfirmBookingEmail({
        to: account.email, studentName: body.name, subject: body.subject,
        lessonStart: body.start, link: confirmLink(held),
      }).catch(err => {
        console.error('[book] confirmation email failed:', (err as Error).message);
        return false;
      })
    : false;
  return json({ ok: true, awaitingConfirmation: true, emailed });
}

/** The family's answer: the held booking, booked the ordinary way. The
 *  click proves the inbox — what /enter accepts as proof too — so this
 *  device is signed in to that family. */
async function confirmHeld(token: string, cookies: Cookies): Promise<Response> {
  const id = verifyPendingToken(token);
  const held = id === null ? null : claimPending(id);
  if (!held) {
    return json({ error: 'הקישור לאישור לא תקף — ייתכן שפג תוקפו או שהשיעור כבר אושר' }, { status: 410 });
  }
  const { attribution, heardFrom, ...booking } = held.body as unknown as ConfirmedBookBody & {
    attribution?: Attribution | null; heardFrom?: string | null;
  };
  const res = await completeBooking(booking as ConfirmedBookBody, {
    cookies, sessionAccountId: held.accountId, byTutor: false,
    attribution: attribution ?? null, heardFrom: heardFrom ?? null,
  });
  if (res.status === 200) setFamilySession(cookies, { kind: 'account', id: held.accountId });
  return res;
}

/** Everything after the decision to book: enrolment, the hour, the charge,
 *  calendar and email (book()), generation, and the response. */
async function completeBooking(body: ConfirmedBookBody, ctx: CompleteCtx): Promise<Response> {
  const { attribution, heardFrom, cookies } = ctx;
  const sourceUtm = attribution ? JSON.stringify({ utm: attribution.utm, visitorId: attribution.visitorId ?? null }) : null;

  /* Enrolment moved AHEAD of the reservation so the booking row can name a
     student. Both are synchronous — enrollFromBooking uses the sync
     node:sqlite and fs APIs throughout — so the race defense is unchanged:
     the check-and-insert still completes before the event loop yields, and
     two concurrent requests still cannot both win the hour. Nothing may be
     awaited between here and reserveBooking's return.

     The cost: a request that loses the race has already created the account
     and student. That is benign, because enrolment is idempotent — the same
     email resolves to the same account, the same name to the same student —
     so the family's retry reuses the record instead of duplicating it.

     EMAIL_REQUIRED is still a 400: without an address the family can never
     be handed what was just created for them. Any other enrolment failure
     is logged, flagged for the tutor the same way a broken calendar write
     is (flagCalendarFailure — it already feeds /api/calendar-failures and
     the dashboard banner), and the booking continues without one — but
     `enrollmentFailed` below is what stops the response from telling the
     family they're confirmed when nothing was actually recorded for them. */
  let enrolled: EnrollResult | null = null;
  let enrollmentFailed = false;
  try {
    enrolled = enrollFromBooking(body);
  } catch (err) {
    if (err instanceof EnrollError && err.code === 'EMAIL_REQUIRED') {
      return json({ error: err.message }, { status: 400 });
    }
    const message = (err as Error).message;
    console.error('[book] enrolment failed:', message);
    enrollmentFailed = true;
    /* Guarded: flagCalendarFailure does its own unguarded INSERT (see the
       comment on the book() catch below), and the fault that just broke
       enrollFromBooking — disk full, SQLITE_BUSY, SQLITE_IOERR — is exactly
       the kind of fault likely to break this INSERT too. Without this guard
       that throw would escape POST as a 500, and the tutor would get no
       dashboard flag, no email and no calendar event — the very
       notification path this branch exists to guarantee. */
    try {
      flagCalendarFailure(
        { name: body.name, start: body.start },
        `רישום המשפחה נכשל — ההזמנה צריכה השלמה ידנית: ${message}`,
      );
    } catch (flagErr) {
      console.error('[book] flagCalendarFailure failed:', flagErr);
    }
  }

  /* Reserve the hour synchronously, before any of book()'s async calendar/
     email work starts — that's what stops two parents booking the same
     hour at once. If it's already taken, never even call book().

     The CHECK is unconditional; only the INSERT is gated on `enrolled`.
     Folding both into `if (enrolled)` meant a failed enrolment never asked
     whether the hour was free, so the request went on to a 200, a calendar
     event and two emails on top of an hour another family already held.
     Still no `await` between the check and the insert — that gap is the
     race this whole ordering exists to close. */
  if (slotTaken(body.start, body.end)) {
    return json({ error: 'השעה הזו כבר תפוסה' }, { status: 409 });
  }

  let bookingId: number | null = null;
  if (enrolled) {
    bookingId = reserveBooking({
      studentId: enrolled.student.id,
      // Without this the row never says which enrollment it was for, and a
      // lesson report (which resolves its plan through this same column)
      // could never be filed against it.
      enrollmentId: enrolled.enrollment?.id ?? null,
      start: body.start,
      end: body.end,
      durationMin: body.durationMin ?? null,
      sourceUtm,
      heardFrom,
    });
    if (bookingId == null) {
      return json({ error: 'השעה הזו כבר תפוסה' }, { status: 409 });
    }
  }

  /* The debt is created here, not inside book(): book() does async calendar
     and email work that must never sit between claiming the hour and
     recording what it costs.

     A failure to charge must not lose the booking — the same rule enrolment
     already follows. A booking with no charge is a bookkeeping gap the tutor
     can fix; a lost booking is a family who thinks they have a lesson. */
  if (enrolled && bookingId != null) {
    try {
      const plan = planFor(body.durationMin);
      const kind = kindFor(body.durationMin);
      if (plan && kind) {
        addPayment({
          accountId: enrolled.account.id,
          studentId: enrolled.student.id,
          bookingId,
          date: lessonDateInIsrael(body.start),
          kind,
          amountAgorot: agorot(plan.shekels),
          status: 'owed',
        });
      } else {
        console.error('[book] no plan for duration, no charge written:', body.durationMin);
      }
    } catch (e) {
      console.error('[book] charge failed:', (e as Error).message);
    }
  }

  let result: BookResult;
  try {
    result = await book(body, enrolled, ctx.sessionAccountId);
  } catch (e) {
    /* book() can throw synchronously — flagCalendarFailure does an unguarded
       INSERT from inside the calendar-failure catch. Without this, the throw
       escapes as a 500 while the hour stays confirmed and its charge stays
       owed: a debt with no lesson behind it. */
    if (bookingId != null) {
      try {
        cancelBooking(bookingId);
        voidChargeForBooking(bookingId);
      } catch (releaseErr) {
        console.error('booking release', releaseErr);
      }
    }
    throw e;
  }

  /* No name/subject re-check: isComplete() above already guarantees both.
     The only question left is whether book() succeeded. */
  if (result.status === 200) {
    const requestText = resolveRequest(body);
    try {
      triggerForBooking(
        { ...body, request: requestText } as Booking,
        { notify: sendWhatsApp, enrolledCode: result.enrolledCode, bookingId },
      );
    } catch (e) {
      console.error('trigger', e);
    }

    /* Guarded like flagCalendarFailure above: a failure to record the
       parent's note must never retroactively fail a booking that already
       succeeded, and an unguarded INSERT inside this route is a known
       hazard in this file (see the comment on flagCalendarFailure's other
       callers). Only written when there is actually something to write and
       the booking enrolled a real student — see lesson_requests's `text`
       and `student_id` columns, both NOT NULL. */
    if (enrolled && bookingId != null && requestText) {
      try {
        addLessonRequest({
          bookingId, studentId: enrolled.student.id, source: 'parent', text: requestText,
        });
      } catch (e) {
        console.error('[book] addLessonRequest failed:', e);
      }
    }

    /* The funnel's booking-count event (marketing.ts's funnel(), migration
       016) — written for EVERY successful booking, not only ones carrying
       attribution, so an organic/untagged booking still counts under the
       "direct / untagged" bucket funnel() reports (a NULL utm_source is
       its own GROUP BY key, see marketing.ts's funnel() doc comment).

       Not wrapped in the same SQL transaction as reserveBooking()'s own
       INSERT: reserveBooking() is a single atomic statement on its own
       (see its doc comment) — there was never a BEGIN left open to join —
       and book()'s async calendar/email work runs between reserving the
       hour and here. Guarded exactly like addLessonRequest just above
       instead: a failure to record this event must never retroactively
       fail a booking that has already succeeded and already been emailed
       to the family — measurement can never break the site.

       Skipped when the tutor is the one booking (`locals.authenticated`):
       this is Nicole booking for a family herself (phone/in person), not a
       visitor's own funnel step, and counting it would inflate `bookings`/
       `lessonsHeld` with lessons that were never "scheduled" through any
       marketing surface at all — the same reason /api/events (task 2)
       already drops every beacon from her admin session. */
    if (bookingId != null && !ctx.byTutor) {
      try {
        recordEvent({
          event: 'lesson_scheduled',
          bookingId,
          visitorId: attribution?.visitorId,
          utm: attribution?.utm,
        });
      } catch (e) {
        console.error('[book] recordEvent(lesson_scheduled) failed:', e);
      }
    }
  } else if (bookingId != null) {
    /* Calendar/email step failed downstream — release the hour, and the
       debt with it. The booking row is only marked cancelled (its charge
       points at it), and a voided charge keeps the history without being
       owed. */
    try {
      cancelBooking(bookingId);
      voidChargeForBooking(bookingId);
    } catch (e) {
      console.error('booking release', e);
    }
  }

  /* Sign the family in here rather than making them click the link they are
     holding. Whoever just completed this booking typed the name, phone and
     email the account was created FROM, seconds ago, on this device — asking
     them to prove that again through an inbox was the single step every new
     family met, and the reason signing up felt like work.

     Only when this booking created the account; see BookResult for why that
     restriction is load-bearing rather than cautious. */
  if (result.signInAccountId !== null) {
    setFamilySession(cookies, { kind: 'account', id: result.signInAccountId });
  }

  /* enrollmentFailed means enrollFromBooking threw. Its DB writes (account,
     student, enrollment) are all-or-nothing — inTransaction guarantees that,
     see db.ts — but the portal-file write happens after that commit, outside
     the transaction (enroll.ts:264-271), so a filesystem failure there
     (EACCES, ENOSPC) can still throw with a fully committed enrolment
     already in the database and no booking row to go with it. Either way —
     nothing recorded, or a committed enrolment with no booking — the
     response must not look like the normal success shape, or the client
     shows the "your lesson is booked" screen for a family Nicole still has
     to sort out by hand. Only added here, never on the ordinary success
     path. */
  const responseBody = enrollmentFailed
    ? { ...(result.responseBody as Record<string, unknown>), pending: true }
    : result.responseBody;

  return json(responseBody, { status: result.status });
};
