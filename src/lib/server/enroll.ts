/**
 * First booking creates the account and the student.
 *
 * Everything a new family needs — the account, the student, the enrollment,
 * the personal page, and the link that opens it — is produced at the moment
 * they book, so nothing has to be set up by hand afterwards.
 *
 * ## What changed, and why the old identity model had to go
 *
 * This used to key identity on (name + password): the parent invented a
 * password during booking and re-typed it to be recognised next time. That
 * model had three failures this one does not have.
 *
 * 1. The password was globally unique across all families, so a returning
 *    parent could be told their own password already belonged to someone
 *    else.
 * 2. The "have you booked before?" toggle defaulted to "no", so the default
 *    path for a returning family was to silently create a second student
 *    record and split their child's history in two.
 * 3. Nothing ever gave the password back, so the only recovery was
 *    messaging the tutor.
 *
 * Identity is now the account's **email**. Matching an email proves nothing
 * on its own — it only decides which account a booking attaches to, and
 * reaching that account still requires receiving the link sent to that
 * address. That means there is no toggle to get wrong, no secret to
 * collide, and no password to forget: booking with the same address twice
 * is, by construction, the same family.
 *
 * Identity is still never inferred from the phone number. One parent can
 * have several students and one number can belong to either parent, which
 * is the bug that used to merge a same-phone, different-name booking into
 * the wrong existing student's record.
 */
import { randomBytes } from 'node:crypto';
import { lessonWhen } from '../dates.ts';
import { TUTOR_PHONE } from '../contact.ts';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  createAccount, findAccountByEmail, setAccountEmail, setAccountPhone,
  createStudent, getStudentByCode, findStudentInAccountByName,
  upsertEnrollment, defaultTeacher, normalizeEmail,
  type AccountRow, type StudentRow, type EnrollmentRow,
} from './entities.ts';
import { portalDir } from './paths.ts';
import { inTransaction } from './db.ts';

const PORTAL = portalDir();

/* Hebrew is written without vowels, so a letter-by-letter transliteration of
   "דנה" gives "dn". The booking form asks for the name in English for exactly
   this reason; this is only the fallback when the field is left empty. */
const LETTERS: Record<string, string> = {
  'א':'', 'ב':'b', 'ג':'g', 'ד':'d', 'ה':'h', 'ו':'o', 'ז':'z', 'ח':'ch', 'ט':'t',
  'י':'i', 'כ':'k', 'ך':'k', 'ל':'l', 'מ':'m', 'ם':'m', 'נ':'n', 'ן':'n', 'ס':'s',
  'ע':'', 'פ':'p', 'ף':'f', 'צ':'tz', 'ץ':'tz', 'ק':'k', 'ר':'r', 'ש':'sh', 'ת':'t',
};

export function transliterate(name: unknown): string {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  const out = [...first]
    .map((ch, i) => (i === first.length - 1 && ch === 'ה' ? '' : LETTERS[ch] ?? ''))
    .join('');
  return out.replace(/[^a-z]/g, '');
}

/**
 * The alphabet a generated address is drawn from.
 *
 * Crockford-ish base32 with the vowels removed, so a code cannot accidentally
 * spell a word and cannot collide with the /^[a-z0-9-]+$/ path-segment rule.
 * Identical in intent to newLessonSlug() in lessons.ts; the two are kept
 * apart for now because one names a lesson and one names a child, and
 * unifying them is a change to both callers rather than a rename.
 */
const CODE_ALPHABET = '0123456789bcdfghjkmnpqrstvwxyz';

/** A short address with no relationship to the child's name. */
function generatedCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/**
 * The address a child's page lives at.
 *
 * NOT transliterated from their name any more. That produced a code two
 * characters or shorter for five of fourteen common Israeli names — א ה ו ע
 * transliterate to nothing and a trailing ה is dropped deliberately — so
 * מאיה became `mi`, נועה became `no`, and אלה became `l`, fell below the
 * length floor, and was handed `student`: the code the Codex smoke-test
 * account already holds.
 *
 * Length was only the visible half. Deriving an address from a name also
 * collides two children whose names share a consonant skeleton, and puts the
 * child's name into a URL that a parent forwards over WhatsApp — which is
 * the child's name in someone else's chat history, for a page that is about
 * them.
 *
 * `requested` is still honoured, because a code the tutor typed is a choice
 * she made rather than a guess made on her behalf. It only has to survive
 * being a usable path segment and being free.
 */
export function makeCode(name: unknown, requested: unknown): string {
  void name;   // deliberately unused: see above
  const asked = String(requested || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');

  if (asked.length >= 3 && !getStudentByCode(asked)) return asked;

  /* Retry rather than suffix. A `${base}2` next to `${base}` tells anyone
     holding one link that the other exists; a fresh draw does not. Bounded,
     because an unbounded loop against a database is how a bad random source
     becomes a hang. */
  for (let i = 0; i < 20; i++) {
    const candidate = generatedCode();
    if (!getStudentByCode(candidate)) return candidate;
  }
  throw new Error('could not allocate a free student code in 20 attempts');
}


export interface BookingInput {
  /** The learner's name. For a self-paying adult this is also the account's. */
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  subject?: unknown;
  level?: unknown;
  start?: string;
  code?: unknown;
  /** The account holder is the learner — no parent in the loop. */
  isSelf?: unknown;
}

interface NextLesson {
  date: string;
  time: string;
  type: string;
}

/** { date, time } for the portal's "next lesson" line, from a booking's ISO
 *  start — or blank fields if there's no booking to show yet. */
function nextLessonFrom(booking: BookingInput): NextLesson {
  if (!booking?.start) return { date: '', time: '', type: '' };
  return { ...lessonWhen(booking.start), type: '' };
}

/** A returning student's portal file already exists, so writePortalFile()
 *  (below) never touches it again — meaning "next lesson" would otherwise
 *  stay frozen at whatever their very first booking was. Called for every
 *  booking that resolves to an existing student, not just the first. */
function updateNextLesson(code: string, booking: BookingInput): void {
  const file = join(PORTAL, `${code}.json`);
  let data: Record<string, unknown>;
  try { data = JSON.parse(readFileSync(file, 'utf8')); } catch { return; }
  data.nextLesson = nextLessonFrom(booking);
  writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * The page itself — empty until the first lesson summary is written into it.
 *
 * Exported because a student can be created two ways, and both need one.
 * A student added from the tutor's dashboard used to get database rows and
 * no file, so their family could follow a perfectly valid link and be told
 * they had no access: /api/portal cannot serve a page that does not exist.
 */
export function writePortalFile(student: StudentRow, booking: BookingInput, tutorName: string): void {
  mkdirSync(PORTAL, { recursive: true });
  const file = join(PORTAL, `${student.code}.json`);
  if (existsSync(file)) return;

  writeFileSync(file, JSON.stringify({
    $comment: 'Created automatically on the first booking. Reading it requires a '
            + 'family session (see src/lib/server/family-auth.ts), but the tutor '
            + 'and the family both read this file — keep payment details and '
            + 'private notes out of it.',
    name: student.name,
    emoji: student.emoji ?? '🎓',
    subject: String(booking.subject || ''),
    level: String(booking.level || ''),
    tutor: tutorName,
    tutorPhone: TUTOR_PHONE,
    updated: new Date().toISOString().slice(0, 10),
    nextLesson: nextLessonFrom(booking),
    progress: 0,
    progressNote: '',
    lessons: [],
    homework: [],
    games: [],
  }, null, 2), 'utf8');
}

export class EnrollError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

export interface EnrollResult {
  account: AccountRow;
  student: StudentRow;
  /** A student record was created by this booking. */
  created: boolean;
  /** The account itself is new — this family has never booked before. */
  accountCreated: boolean;
  /**
   * The (student, subject) enrollment this booking is for, or null when the
   * booking carried no subject to enroll in. bookings_v2.enrollment_id is
   * this id, set by the caller when it reserves the hour — a lesson report
   * later resolves its plan through that same column, so a booking that
   * never records which enrollment it belongs to can never be reported on.
   */
  enrollment: EnrollmentRow | null;
  /** The default teacher (`defaultTeacher()`), or null when there is no
   *  active teacher row — independent of whether this booking had a
   *  subject to enrol in. The booking confirmation email names this tutor
   *  rather than a hardcoded one. */
  teacherName: string | null;
}

/**
 * @returns the account, the student, and whether either was created.
 *
 * Throws an EnrollError with `.code`:
 *   'EMAIL_REQUIRED' — no usable address. The address is how the family
 *                      receives the link that opens their portal, so a
 *                      booking without one would enrol a family that can
 *                      never reach what was enrolled.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function enrollFromBooking(booking: BookingInput): EnrollResult {
  const email = normalizeEmail(booking.email);
  // The same rule the booking form applies client-side: one local part, one
  // @, a domain with a dot, no whitespace. "Contains an @" let "orit@",
  // "@example.com" and "a@b@c.com" enroll a family whose magic link could
  // never arrive — and the link is their only way back in.
  if (!EMAIL_SHAPE.test(email)) {
    throw new EnrollError('צריך כתובת מייל כדי לשלוח את הקישור לדף האישי', 'EMAIL_REQUIRED');
  }

  const name = String(booking.name || '').trim().replace(/\s+/g, ' ');
  const phone = booking.phone ? String(booking.phone) : null;
  const isSelf = !!booking.isSelf;

  /* All the DATABASE writes below — the account, the student, the
     enrollment — run as one transaction. Before this they ran as separate
     statements with no rollback: a throw after the account row landed (say,
     upsertEnrollment failing) left an orphan account with zero students
     while the caller's catch swallowed the error and told the family their
     booking was confirmed. inTransaction() makes "some of this happened"
     impossible — either all of it lands, or none of it does, and the throw
     still propagates to the caller exactly as before. */
  const { account, student, created, accountCreated, enrollment, teacherName, assignedTeacherName } = inTransaction(() => {
    let account = findAccountByEmail(email);
    const accountCreated = !account;

    if (!account) {
      account = createAccount({
        // No separate parent-name field: the account is named for the learner
        // until the family renames it. For a self-payer that is exactly right,
        // and for a parent it reads the way the tutor already thinks ("דנה's
        // family"). Asking for a second name would put another input on the
        // one screen where the parent is most likely to abandon.
        name: name || email,
        phone,
        // Retained because the column is NOT NULL and the dashboard still reads
        // it as a human-readable handle for the family. It is no longer a
        // credential: nothing authenticates against it any more.
        credential: email,
        isSelf,
        email,
      });
    } else if (phone && !account.phone) {
      // A backfilled account has whatever the legacy row had; a returning
      // family volunteering a number should not have it discarded.
      setAccountPhone(account.id, phone);
      account = { ...account, phone };
    }

    // A legacy family booking for the first time since the migration arrives
    // with no email on their account. Their first booking under the new flow
    // is what finally gives them one, and with it a way back in.
    if (!account.email) {
      setAccountEmail(account.id, email);
      account = { ...account, email };
    }

    const teacher = defaultTeacher();

    let student = findStudentInAccountByName(account.id, name);
    const created = !student;

    if (!student) {
      student = createStudent({
        code: makeCode(name, booking.code),
        name,
        accountId: account.id,
        // Same as the account: kept because the column is NOT NULL, no longer
        // a secret anyone types.
        credential: email,
      });
    }

    const subject = String(booking.subject || '').trim();
    let enrollment: EnrollmentRow | null = null;
    if (subject) {
      enrollment = upsertEnrollment({
        studentId: student.id,
        subject,
        level: String(booking.level || '') || null,
        teacherId: teacher?.id ?? null,
      });
    }

    // The portal file always needs something to print, even with no
    // default teacher configured; with no teacher assigned, that is a
    // neutral 'המורה' rather than one specific tutor's name. The
    // enrollment result carries the real assignment (or null, when none)
    // and leaves the fallback-to-a-named-tutor decision to the email step,
    // which uses the roster's contact tutor rather than a bare 'המורה'.
    return {
      account, student, created, accountCreated, enrollment,
      teacherName: teacher?.name ?? 'המורה',
      assignedTeacherName: teacher?.name ?? null,
    };
  });

  /* FILESYSTEM writes, moved to after the transaction commits. If they ran
     inside (or before) it, a rolled-back enrolment — the account and
     student never actually created — could still leave an orphan portal
     JSON file on disk with nothing in the database to match it. Only once
     the commit above has actually happened is there a real student to write
     a portal file for. */
  if (created) {
    writePortalFile(student, booking, teacherName);
  } else {
    updateNextLesson(student.code, booking);
  }

  return { account, student, created, accountCreated, enrollment, teacherName: assignedTeacherName };
}
