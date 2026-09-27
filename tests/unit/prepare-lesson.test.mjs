// scripts/prepare-lesson.mjs is a tutor-facing CLI, not covered by
// `npm run check` (it's a .mjs script) and not automatable end-to-end (it
// shells out to a headless agent). This pins the one thing that silently
// broke when the booking's optional note was renamed topic -> request
// (see LessonRequest.request in prep.ts): the operator's --topic must still
// reach the generator, as `request`, and saveLesson() must still get a real
// `topic` for the draft folder name.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parseArgs, buildMeta, draftsRoot } = await import('../../scripts/prepare-lesson.mjs');

test('parseArgs reads --flag value pairs off argv', () => {
  const args = parseArgs(['--topic', 'אינטגרלים', '--level', 'כיתה יא', '--student', 'נוגה']);
  assert.equal(args.topic, 'אינטגרלים');
  assert.equal(args.level, 'כיתה יא');
  assert.equal(args.student, 'נוגה');
});

test('buildMeta wires --topic through as the request the generator reads', () => {
  const meta = buildMeta({ topic: 'אינטגרלים', level: 'כיתה יא', student: 'נוגה' });
  assert.equal(meta.request, 'אינטגרלים', 'LessonRequest.request must receive the operator\'s topic');
  assert.equal(meta.subject, 'מתמטיקה', 'default subject when none given');
  assert.equal(meta.level, 'כיתה יא');
  assert.equal(meta.student, 'נוגה');
});

test('buildMeta still gives saveLesson a real `topic` for the draft folder name', () => {
  const meta = buildMeta({ topic: 'אינטגרלים', student: 'נוגה' });
  assert.equal(meta.topic, 'אינטגרלים', 'SaveLessonMeta.topic must not go missing once request exists');
});

test('--stuck is folded into the request rather than dropped or kept as its own field', () => {
  const meta = buildMeta({ topic: 'אינטגרלים', stuck: 'לא יודעת מה להציב' });
  assert.match(meta.request, /אינטגרלים/);
  assert.match(meta.request, /לא יודעת מה להציב/);
  assert.equal('notUnderstood' in meta, false, 'there is no notUnderstood field any more');
});

test('--stuck alone (no --topic) does not fabricate a request', () => {
  const meta = buildMeta({ stuck: 'לא יודעת מה להציב' });
  assert.equal(meta.request, 'תקוע/ה ב: לא יודעת מה להציב');
  // The CLI's own guard (main(), not buildMeta) still requires --topic
  // before this would ever run for real — this only pins buildMeta's own
  // behaviour in isolation.
});

/* A draft is minutes of model work that exists nowhere else. It used to be
   written beside the checkout, while server/backup-db.sh backs up
   data/drafts — so no backup, local or on Drive, ever contained one. */
test('a draft is written under DATA_DIR, which is what gets backed up', () => {
  assert.equal(draftsRoot({ DATA_DIR: '/srv/app/data' }), '/srv/app/data');
});

test('with no DATA_DIR a draft still lands beside the checkout, not beside the caller', () => {
  // Not content.ts's bare './data': the CLI is run by hand from wherever the
  // tutor is standing, and a draft must not move with cwd.
  const root = draftsRoot({});
  assert.ok(root.endsWith('/data'), `expected a .../data path, got ${root}`);
  assert.ok(root.startsWith('/'), 'must be absolute so cwd cannot move it');
});
