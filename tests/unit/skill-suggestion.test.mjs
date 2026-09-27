// tests/unit/skill-suggestion.test.mjs
//
// Evidence in, a DRAFT opinion out. Nothing here writes anything.
//
// Spec §3.2. The engine's job is to save the tutor from setting every skill
// by hand with no help from evidence the system already collects — not to
// decide anything. §7: "Any automatic change to a plan" is explicitly out
// of scope, and the approval gate is the feature.
//
// The thresholds are deliberately conservative, and the most important rule
// is the one that produces nothing: below the bar the engine is SILENT
// rather than hedging. A suggestion the tutor has to second-guess costs her
// more than no suggestion, and a wrong one shown beside a child's name is
// worse than both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { suggestStatus } from '../../src/lib/server/plans/suggest.ts';

const play = (at, score, total = 10) => ({ at, score, total });
const none = { plays: [], homework: [] };

test('no evidence suggests nothing', () => {
  assert.equal(suggestStatus(none), null);
});

test('one play suggests nothing, however good it was', () => {
  // A lucky quiz, a sibling on the tablet, a game replayed until it stuck.
  // One data point cannot tell those apart from learning.
  const ev = { plays: [play('2026-09-01', 10)], homework: [] };
  assert.equal(suggestStatus(ev), null);
});

test('two strong plays suggest with_help, not independent', () => {
  // A game is a supported context: the options are on the screen. That is
  // "did it with help" however high the score, and §3.2 keeps independent
  // deliberately hard to reach from activity alone.
  const ev = { plays: [play('2026-09-01', 9), play('2026-09-03', 10)], homework: [] };
  const s = suggestStatus(ev);
  assert.equal(s.status, 'with_help');
});

test('strong plays plus graded homework suggest independent', () => {
  // Two independent contexts agreeing: a supported one and an unsupported
  // one the tutor has judged.
  const ev = {
    plays: [play('2026-09-01', 9), play('2026-09-03', 10)],
    homework: [{ at: '2026-09-04', grade: 'ok', submitted: true }],
  };
  assert.equal(suggestStatus(ev).status, 'independent');
});

test('homework the student merely submitted does not reach independent', () => {
  // A submission is a claim; a grade is a judgement. independent is the
  // strongest thing the plan can say, so it rests on the judgement.
  const ev = {
    plays: [play('2026-09-01', 9), play('2026-09-03', 10)],
    homework: [{ at: '2026-09-04', grade: null, submitted: true }],
  };
  assert.equal(suggestStatus(ev).status, 'with_help');
});

test('homework graded redo does not reach independent', () => {
  const ev = {
    plays: [play('2026-09-01', 9), play('2026-09-03', 10)],
    homework: [{ at: '2026-09-04', grade: 'redo', submitted: true }],
  };
  assert.equal(suggestStatus(ev).status, 'with_help');
});

test('two weak plays suggest needs_review', () => {
  // The one direction worth flagging on weak evidence: being wrong about
  // "she is struggling" costs a revisit, being wrong the other way costs a
  // child moving on without the skill.
  const ev = { plays: [play('2026-09-01', 3), play('2026-09-03', 4)], homework: [] };
  assert.equal(suggestStatus(ev).status, 'needs_review');
});

test('middling plays suggest nothing', () => {
  // 50–79% is exactly where a human would say "I need to watch her do it".
  // So does this.
  const ev = { plays: [play('2026-09-01', 6), play('2026-09-03', 7)], homework: [] };
  assert.equal(suggestStatus(ev), null);
});

test('middling plays that are getting worse suggest needs_review', () => {
  const ev = {
    plays: [play('2026-09-01', 8), play('2026-09-03', 7), play('2026-09-05', 5)],
    homework: [],
  };
  assert.equal(suggestStatus(ev).status, 'needs_review');
});

test('a dip inside strong work is not a downward trend', () => {
  // 100, 100, 90 is a good week, not a warning. Flagging it would teach the
  // tutor to ignore the flag.
  const ev = {
    plays: [play('2026-09-01', 10), play('2026-09-03', 10), play('2026-09-05', 9)],
    homework: [],
  };
  assert.equal(suggestStatus(ev).status, 'with_help');
});

test('every suggestion carries checkable evidence, not a confidence score', () => {
  const ev = { plays: [play('2026-09-01', 9), play('2026-09-03', 10)], homework: [] };
  const s = suggestStatus(ev);
  assert.equal(s.plays, 2);
  assert.equal(s.accuracy, 95);
  assert.equal(s.lastAt, '2026-09-03');
  // "3 תרגולים, 85%, אחרון 19/09" is checkable against rows; "confidence
  // 0.7" is not, and a tutor cannot argue with it.
  assert.match(s.why, /2/);
  assert.match(s.why, /95%/);
  // A date a tutor reads, not an ISO timestamp. Found in a browser: the
  // line said "אחרון 2026-09-03T10:00:00.000Z", which is a machine's date.
  assert.match(s.why, /03\/09\/2026/);
  assert.doesNotMatch(s.why, /T\d{2}:\d{2}/, 'no ISO timestamps in tutor-facing text');
  assert.doesNotMatch(s.why, /confidence|ביטחון/i);
});

test('plays with no score are not counted as zeros', () => {
  // results_v2.score and .total are nullable. Treating a null as 0 would
  // manufacture a failing play out of a missing one and flag a child for
  // review over a logging gap.
  const ev = {
    plays: [{ at: '2026-09-01', score: null, total: null }, play('2026-09-03', 10)],
    homework: [],
  };
  assert.equal(suggestStatus(ev), null, 'one scored play is still one play');
});

test('a zero total is not a division by zero', () => {
  const ev = {
    plays: [{ at: '2026-09-01', score: 0, total: 0 }, play('2026-09-03', 10)],
    homework: [],
  };
  const s = suggestStatus(ev);
  assert.ok(s === null || Number.isFinite(s.accuracy), 'accuracy must never be NaN');
});

test('the engine writes nothing', () => {
  // Structural: it takes plain data and returns plain data. If it ever
  // needs a database handle, the approval gate has been routed around.
  const src = readFileSync(new URL('../../src/lib/server/plans/suggest.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\bhandle\(\)/, 'no database access');
  assert.doesNotMatch(src, /INSERT|UPDATE|DELETE/i, 'no writes');
});
