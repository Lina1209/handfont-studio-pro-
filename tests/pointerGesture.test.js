import test from 'node:test';
import assert from 'node:assert/strict';
import { getPointerCancelRecovery } from '../lib/pointerGesture.js';

test('pointer cancellation restores the original viewport for a pan gesture', () => {
  const view = { xMin: -60, xMax: 940, yMin: -260, yMax: 840 };
  assert.deepEqual(getPointerCancelRecovery({ type: 'pan', v0: view }), {
    view,
    objects: null
  });
});

test('pointer cancellation restores the pre-gesture object snapshot', () => {
  const snapshot = [{ id: 'shape-1', contours: [{ nodes: [{ x: 1, y: 2 }] }] }];
  for (const type of ['erase', 'restore', 'shape', 'moveOrToggle', 'node', 'nodeGroupTransform', 'nodeTransform']) {
    assert.deepEqual(getPointerCancelRecovery({ type, snap: snapshot }), {
      view: null,
      objects: snapshot
    });
  }
});

test('pointer cancellation without an active transaction does not invent a rollback', () => {
  assert.deepEqual(getPointerCancelRecovery(null), { view: null, objects: null });
  assert.deepEqual(getPointerCancelRecovery({ type: 'pan' }), { view: null, objects: null });
  assert.deepEqual(getPointerCancelRecovery({ type: 'brush' }), { view: null, objects: null });
});
