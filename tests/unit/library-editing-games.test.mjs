/**
 * A library master's games, beyond the quiz (#24): two truths and a lie
 * (in every master), error hunt, sequence and matching. Same rules as the
 * quiz — a master only, a game the plan already has, refused rather than
 * silently changed when a field is missing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = await mkdtemp(join(tmpdir(), 'library-editing-games-'));
process.env.DB_PATH = join(process.env.DATA_DIR, 'results.db');
const { normalizeEdit, applyEdit, editedPlan, formPlan } = await import('../../src/lib/server/lesson/editing.ts');
const M = await import('../../src/lib/server/materials.ts');

const core = () => ({ title: 'יחס', slides: [{ heading: 'h', bullets: ['b'] }], examples: [{ problem: 'p', steps: [], answer: 'a' }], teacherOnly: null });
const twoTruths = () => [
  { statements: [' 2+2=4 ', '3·3=6', '5−1=4'], lieIndex: 1, why: ' 3·3=9 ', hint: '' },
  { statements: ['א', 'ב', 'ג'], lieIndex: 2, why: '', hint: 'רמז' },
];
const errorHunt = () => [{ problem: ' 2x+3=11 ', steps: ['2x=8', 'x=6'], badStep: 1, why: '8:2=4', hint: '' }];
const sequence = () => [' מציבים x=0 ', 'מוצאים את y', 'מסמנים נקודה'];
const matching = () => [{ left: 'x²', right: 'פרבולה', hint: '' }, { left: '2x+1', right: 'ישר', hint: '' }, { left: '1/x', right: 'היפרבולה', hint: 'h' }];
const all = () => ({ ...core(), twoTruths: twoTruths(), errorHunt: errorHunt(), sequence: sequence(), matching: matching() });

test('each game is trimmed and kept in its own shape', () => {
  const r = normalizeEdit(all());
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.edit.twoTruths[0], { statements: ['2+2=4', '3·3=6', '5−1=4'], lieIndex: 1, why: '3·3=9', hint: '' });
  assert.deepEqual(r.edit.errorHunt[0], { problem: '2x+3=11', steps: ['2x=8', 'x=6'], badStep: 1, why: '8:2=4', hint: '' });
  assert.deepEqual(r.edit.sequence, ['מציבים x=0', 'מוצאים את y', 'מסמנים נקודה']);
  assert.deepEqual(r.edit.matching[2], { left: '1/x', right: 'היפרבולה', hint: 'h' });
});

const refuses = (mut, why) => test(`refused: ${why}`, () => {
  const e = all(); mut(e);
  const r = normalizeEdit(e);
  assert.equal(r.ok, false);
  assert.ok(r.error.length > 0);
});
refuses(e => { e.twoTruths[0].statements = ['א', 'ב']; }, 'two truths with two statements');
refuses(e => { e.twoTruths[0].statements[2] = ' '; }, 'an empty statement');
refuses(e => { e.twoTruths[0].lieIndex = 3; }, 'a lie that is not one of the statements');
refuses(e => { e.errorHunt[0].problem = ''; }, 'an error hunt with no problem');
refuses(e => { e.errorHunt[0].steps = ['2x=8']; }, 'an error hunt with one step');
refuses(e => { e.errorHunt[0].steps[0] = ''; }, 'an empty step (dropping it would move the marked one)');
refuses(e => { e.errorHunt[0].badStep = -1; }, 'no step marked wrong');
refuses(e => { e.sequence = ['א', 'ב']; }, 'a sequence of two');
refuses(e => { e.sequence[1] = ''; }, 'an empty sequence step');
refuses(e => { e.matching = e.matching.slice(0, 2); }, 'matching with two pairs');
refuses(e => { e.matching[0].right = ' '; }, 'a pair with an empty side');

test('applied, each replaces its own game and keeps its title', () => {
  const base = {
    title: 'old', gradeContext: 'כיתה ח', slides: [], examples: [], homework: [],
    games: {
      twoTruths: { title: 'שתיים', subject: 'm', rounds: [] }, errorHunt: { title: 'ציד', subject: 'm', rounds: [] },
      sequence: { title: 'סדר', subject: 'm', steps: [] }, matching: { title: 'התאמה', subject: 'm', pairs: [] },
      memory: { title: 'זיכרון', subject: 'm', pairs: [{ a: '1', b: '2' }] },
    },
  };
  const g = applyEdit(base, normalizeEdit(all()).edit).games;
  assert.equal(g.twoTruths.title, 'שתיים');
  assert.equal(g.twoTruths.rounds.length, 2);
  assert.equal(g.errorHunt.rounds[0].badStep, 1);
  assert.deepEqual(g.sequence.steps, ['מציבים x=0', 'מוצאים את y', 'מסמנים נקודה']);
  assert.equal(g.matching.pairs.length, 3);
  assert.deepEqual(g.memory, base.games.memory, 'a game the edit does not carry is kept');
});

const stored = (slug, games) => M.addMaterial({ slug, kind: 'plan', origin: 'generated', publish: true, content: JSON.stringify({
  title: 't', gradeContext: 'c', slides: [], examples: [], homework: [], games,
}) });

test("a master's games are editable; a student's lesson's are not; a game the lesson lacks is refused", () => {
  stored('lib-math-8-alg-eq-word-g', { twoTruths: { title: 't', subject: 'm', rounds: [] } });
  const ok = editedPlan('lib-math-8-alg-eq-word-g', { ...core(), twoTruths: twoTruths() });
  assert.equal(ok.error, undefined);
  assert.equal(ok.plan.games.twoTruths.rounds[0].lieIndex, 1);

  stored('noga-games', { twoTruths: { title: 't', subject: 'm', rounds: [] } });
  assert.equal(editedPlan('noga-games', { ...core(), twoTruths: twoTruths() }).status, 400);

  const lacking = editedPlan('lib-math-8-alg-eq-word-g', { ...core(), errorHunt: errorHunt() });
  assert.equal(lacking.status, 400);
  assert.match(lacking.error, /ציד טעויות/);
});

test('the form gets each game the plan has, and null for the ones it has not', () => {
  const f = formPlan({ games: {
    twoTruths: { rounds: [{ statements: ['א', 7], lieIndex: 0 }] },
    sequence: { steps: ['1', '2', '3'] },
  } });
  assert.deepEqual(f.twoTruths, [{ statements: ['א', ''], lieIndex: 0, why: '', hint: '' }]);
  assert.deepEqual(f.sequence, ['1', '2', '3']);
  assert.equal(f.errorHunt, null);
  assert.equal(f.matching, null);
});
