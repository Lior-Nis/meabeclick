import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idsForPanel } from '../../src/lib/payments-selection.ts';

const yuval = [{ id: 1 }, { id: 2 }];
const noa = [{ id: 7 }];

test('a selection spanning two panels submits only the pressed panel', () => {
  // The exact regression: charges ticked under both children, the button
  // pressed under Noa. Yuval's ids must not travel.
  assert.deepEqual(idsForPanel([1, 2, 7], noa), [7]);
  assert.deepEqual(idsForPanel([1, 2, 7], yuval), [1, 2]);
});

test('a selection with nothing in this panel submits nothing', () => {
  assert.deepEqual(idsForPanel([1, 2], noa), []);
});

test('an empty panel submits nothing', () => {
  assert.deepEqual(idsForPanel([1, 2], []), []);
});
