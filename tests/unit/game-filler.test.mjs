// Catalog examples are rows in game_filler. The ids in games/registry.json
// do not name a student; the old ids still resolve to the same body.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'game-filler-')), 'results.db');

const { readGameFiller, GAME_FILLER_ALIASES } = await import('../../src/lib/server/game-filler.ts');
const { handle } = await import('../../src/lib/server/db.ts');

const registry = JSON.parse(readFileSync(join(process.cwd(), 'games', 'registry.json'), 'utf8'));
const NAME = /noga|yonatan|נוגה|יונתן/;

test('migration 030 stores every catalog example except speed-drill', () => {
  const ids = handle().prepare(`SELECT id FROM game_filler ORDER BY id`).all().map(r => r.id);
  assert.deepEqual(ids, Object.values(GAME_FILLER_ALIASES).sort());
  for (const id of ids) {
    const body = readGameFiller(id);
    assert.equal(typeof body, 'string');
    JSON.parse(body);
    assert.doesNotMatch(body, NAME);
    assert.doesNotMatch(id, NAME);
  }
});

test('an old id and its generic id are the same exercise', () => {
  for (const [oldId, id] of Object.entries(GAME_FILLER_ALIASES)) {
    assert.match(oldId, /^(noga|yonatan)-/);
    assert.equal(readGameFiller(oldId), readGameFiller(id));
  }
  assert.equal(readGameFiller('not-a-catalog-example'), null);
});

test('registry example ids are the generic ones', () => {
  const canonical = new Set(Object.values(GAME_FILLER_ALIASES));
  for (const [key, template] of Object.entries(registry.templates)) {
    assert.ok(template.example, key);
    assert.doesNotMatch(template.example, NAME);
    if (key === 'speed-drill') {
      assert.equal(template.example, 'nikol-derivrules-speed');
      assert.equal(readGameFiller(template.example), null);
    } else {
      assert.ok(canonical.has(template.example), `${key} example ${template.example} is not in game_filler`);
      assert.equal(JSON.parse(readGameFiller(template.example)).title.length > 0, true);
    }
  }
});

test('the migration source does not name a student', () => {
  const src = readFileSync(new URL('../../src/lib/server/migrations/030_game_filler.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, NAME);
});
