import { test } from 'node:test';
import assert from 'node:assert/strict';

const { migrateEntry, migratePortalShape } = await import(
  '../../scripts/migrate-portal-shape.mjs'
);

test('migrateEntry converts a legacy homework url to {template,dataId}, dropping url', () => {
  const legacy = {
    task: 'משחק זיכרון — נוסחאות אינטגרלים',
    assigned: '2026-07-27',
    due: '2026-08-03',
    done: false,
    url: 'games/memory.html?d=noga-integrals-memory&s=נוגה',
  };
  const migrated = migrateEntry(legacy);
  assert.equal(migrated.template, 'memory');
  assert.equal(migrated.dataId, 'noga-integrals-memory');
  assert.equal('url' in migrated, false);
  // Everything else survives untouched.
  assert.equal(migrated.task, legacy.task);
  assert.equal(migrated.assigned, legacy.assigned);
  assert.equal(migrated.due, legacy.due);
  assert.equal(migrated.done, legacy.done);
});

test('migrateEntry converts a legacy games url the same way', () => {
  const legacy = {
    title: 'קרב מהירות — כללי גזירה',
    url: 'games/speed-drill.html?d=nikol-derivrules-speed&s=נוגה',
  };
  const migrated = migrateEntry(legacy);
  assert.deepEqual(migrated, {
    title: 'קרב מהירות — כללי גזירה',
    template: 'speed-drill',
    dataId: 'nikol-derivrules-speed',
  });
});

test('migrateEntry is idempotent — an already-migrated entry passes through unchanged', () => {
  const already = { title: 'משחק זיכרון', template: 'memory', dataId: 'noga-integrals-memory' };
  const migrated = migrateEntry(already);
  assert.deepEqual(migrated, already);
  assert.notEqual(migrated, already); // still a fresh object, never the same reference
});

test('migrateEntry leaves an entry with an unrecognized url shape untouched rather than guessing', () => {
  const weird = { title: 'external', url: 'https://example.com/not-a-game-link' };
  const migrated = migrateEntry(weird);
  assert.deepEqual(migrated, weird);
});

test('migratePortalShape converts a mixed-shape file end to end and leaves other fields alone', () => {
  const portal = {
    name: 'נוגה',
    homework: [
      {
        task: 'a',
        done: false,
        url: 'games/quiz.html?d=noga-integrals-quiz&s=נוגה',
      },
      { task: 'b', done: true, template: 'sort', dataId: 'noga-functions-sort' },
    ],
    games: [{ title: 'c', url: 'games/table.html?d=noga-derivatives-table&s=נוגה' }],
  };
  const migrated = migratePortalShape(portal);
  assert.equal(migrated.name, 'נוגה');
  assert.deepEqual(migrated.homework[0], {
    task: 'a',
    done: false,
    template: 'quiz',
    dataId: 'noga-integrals-quiz',
  });
  assert.deepEqual(migrated.homework[1], {
    task: 'b',
    done: true,
    template: 'sort',
    dataId: 'noga-functions-sort',
  });
  assert.deepEqual(migrated.games[0], { title: 'c', template: 'table', dataId: 'noga-derivatives-table' });
  // Original object is not mutated.
  assert.equal(portal.homework[0].url, 'games/quiz.html?d=noga-integrals-quiz&s=נוגה');
});

test('migratePortalShape is a no-op on a fully-migrated file', () => {
  const portal = {
    name: 'נוגה',
    homework: [{ task: 'a', template: 'quiz', dataId: 'noga-integrals-quiz' }],
    games: [],
  };
  assert.deepEqual(migratePortalShape(portal), portal);
});
