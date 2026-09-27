#!/usr/bin/env node
/**
 * One-off import of the hand-maintained Markdown ledger into `payments`.
 *
 * DRY RUN BY DEFAULT. It prints the mapping it proposes and writes nothing
 * unless given --commit.
 *
 * The mapping is a human decision, not a migration's: the KB's Student
 * column is Latin ("Lior") and students carry Hebrew display names
 * ("נוגה"), so there is nothing to match on. Every row is proposed with an
 * explicit --map argument, and an unmapped row is skipped loudly rather
 * than guessed at. This attributes real money to a specific child.
 *
 *   node scripts/import-ledger.mjs --map "Lior=noga" --map "Dana=dana"
 *   node scripts/import-ledger.mjs --map "Lior=noga" --commit
 *
 * A --commit refuses to run against a non-empty `payments` table. The
 * operator sequence that actually happens is dry-run, commit, "did that
 * work?", commit — and this is a one-off import with no natural key, so the
 * second run would silently double every family's debt. --force is there for
 * the deliberate re-import, after the table has been cleared by hand.
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const commit = args.includes('--commit');
const force = args.includes('--force');
const map = new Map(
  args.flatMap((a, i) => (a === '--map' ? [args[i + 1]] : []))
      .filter(Boolean)
      .map(pair => pair.split('=').map(s => s.trim()))
);

const path = process.env.KB_PRICING_PATH
  ?? new URL('../mea-beclick-kb/pricing/Summary.md', import.meta.url).pathname;

/** Parses the "## All Payments" table: Date | Student | Session Type | Amount | Status */
function parsePayments(md) {
  const lines = md.split('\n');
  const start = lines.findIndex(l => l.trim() === '## All Payments');
  if (start === -1) return [];

  const out = [];
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    if (line.startsWith('##')) break;
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map(c => c.trim().replace(/\*\*/g, ''));
    if (cells.length < 5) continue;
    if (/^-+$/.test(cells[0].replace(/\s/g, '')) || cells[0] === 'Date') continue;
    out.push({ date: cells[0], student: cells[1], type: cells[2], amount: cells[3], status: cells[4] });
  }
  return out;
}

const KIND = { single: 'single', double: 'double', triple: 'triple' };
const kindOf = t => KIND[(t.match(/single|double|triple/i)?.[0] ?? '').toLowerCase()] ?? null;
/** Agorot from a ledger cell, or null when the cell is not an amount.
 *
 *  Deliberately strict. The previous version stripped everything that was
 *  not a digit or a dot, which turned an empty cell and a placeholder "-"
 *  into a valid ₪0 charge, and flipped "-₪215" — a refund — into a +₪215
 *  debt against a child. addPayment's integer guard cannot catch any of
 *  those, because 0 and 21500 are both perfectly good integers. A skipped
 *  row costs the operator one --map argument; a silently wrong one costs a
 *  family money. */
const agorotOf = a => {
  const raw = String(a ?? '').trim();
  const m = raw.match(/^₪?\s*(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;

  const [, sign, whole, frac = ''] = m;
  const agorot = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return sign === '-' ? -agorot : agorot;
};
const isoDate = d => {
  const m = String(d).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const [, y, mo, da] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(da)));
  const roundTrips = date.getUTCFullYear() === Number(y)
    && date.getUTCMonth() === Number(mo) - 1
    && date.getUTCDate() === Number(da);
  if (!roundTrips) return null;
  return `${y}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`;
};

const rows = parsePayments(readFileSync(path, 'utf8'));
if (!rows.length) {
  console.error(`No "## All Payments" rows found in ${path}`);
  process.exit(1);
}

const { getStudentByCode } = await import('../src/lib/server/entities.ts');
const { addPayment } = await import('../src/lib/server/payments.ts');

let ready = 0, skipped = 0;
const planned = [];

for (const row of rows) {
  const code = map.get(row.student);
  const problems = [];
  if (!code) problems.push(`no --map for "${row.student}"`);

  const student = code ? getStudentByCode(code) : null;
  if (code && !student) problems.push(`no student with code "${code}"`);

  const kind = kindOf(row.type);
  if (!kind) problems.push(`cannot read a lesson kind from "${row.type}"`);

  const amountAgorot = agorotOf(row.amount);
  if (amountAgorot == null) problems.push(`cannot read an amount from "${row.amount}"`);
  else if (amountAgorot <= 0) problems.push(`amount is not positive: "${row.amount}" — a refund or correction needs to be entered by hand`);

  const date = isoDate(row.date);
  if (!date) problems.push(`cannot read a date from "${row.date}"`);

  const status = /paid|✅/i.test(row.status) ? 'paid' : 'owed';

  if (problems.length) {
    skipped++;
    console.log(`SKIP  ${row.date} ${row.student} ${row.amount} — ${problems.join('; ')}`);
    continue;
  }

  ready++;
  // Marks the row as hand-imported history rather than something a booking
  // generated, so the tutor can tell the two apart in the payments table
  // long after this script is gone.
  planned.push({
    accountId: student.account_id, studentId: student.id, date, kind, amountAgorot, status,
    note: 'imported from Summary.md',
  });
  console.log(`OK    ${date}  ${row.student} → ${code}  ${kind}  ${row.amount} → ${amountAgorot} agorot  ${status}`);
}

console.log(`\n${ready} ready, ${skipped} skipped.`);

if (!commit) {
  console.log('Dry run. Re-run with --commit to write these rows.');
  process.exit(skipped ? 1 : 0);
}

const { handle } = await import('../src/lib/server/db.ts');
const db = handle();

const existing = db.prepare(`SELECT COUNT(*) AS n FROM payments`).get().n;
if (existing && !force) {
  console.error(
    `Refusing to import: the payments table already has ${existing} row(s). ` +
    'These rows carry no natural key, so re-running this import would write ' +
    'every one of them a second time and double what each family appears to ' +
    'owe. Clear the table by hand first, or pass --force if you are certain ' +
    'the duplicates are wanted.'
  );
  process.exit(1);
}

// One transaction for the whole batch: a throw halfway through used to leave
// the earlier rows written, which is precisely the state that makes the
// operator's natural re-run duplicate them.
db.exec('BEGIN');
try {
  for (const p of planned) addPayment(p);
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  console.error(`Import failed, nothing was written: ${err.message}`);
  process.exit(1);
}
console.log(`Wrote ${planned.length} rows.`);
