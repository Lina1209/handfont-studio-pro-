import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEraseRestoreMasks, buildBrushMask, buildRestorePatch, constrainRestorePatch, contoursToMultiPolygon, multiPolygonToContours } from '../lib/restoreGeometry.js';

const square = (x1, y1, x2, y2) => [
  { x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }
];
const area = ring => ring.reduce((sum, p, i) => {
  const q = ring[(i + 1) % ring.length];
  return sum + p.x * q.y - q.x * p.y;
}, 0) / 2;
const filledArea = contours => {
  const geometry = contoursToMultiPolygon(contours);
  return geometry.reduce((sum, polygon) => sum + polygon.reduce((part, ring) => {
    const points = ring.map(([x, y]) => ({ x, y }));
    return part + area(points);
  }, 0), 0);
};

test('converts a contour with a hole and nested island', () => {
  const geometry = contoursToMultiPolygon([
    square(0, 0, 100, 100),
    square(20, 20, 80, 80),
    square(40, 40, 60, 60)
  ]);
  assert.equal(geometry.length, 2);
  assert.equal(geometry[0].length, 2);
  assert.equal(geometry[1].length, 1);
});

test('erase mask removes only its intersection with the source', () => {
  const result = applyEraseRestoreMasks([square(0, 0, 100, 100)], [square(20, 20, 40, 40)]);
  assert.ok(Math.abs(filledArea(result) - 9600) < 1e-5);
});

test('restore mask restores only source area, not outside it', () => {
  const result = applyEraseRestoreMasks(
    [square(0, 0, 100, 100)],
    [square(20, 20, 80, 80)],
    [square(40, 40, 120, 120)]
  );
  assert.ok(Math.abs(filledArea(result) - 8000) < 1e-5);
});

test('restore patch contains only missing source area under the brush', () => {
  const source = [square(0, 0, 100, 100)];
  const current = [square(0, 0, 40, 100), square(60, 0, 100, 100)];
  const patch = buildRestorePatch(current, source, [square(30, 20, 70, 80)]);
  assert.ok(Math.abs(filledArea(patch) - 1200) < 1e-5);
});

test('smoothed restore preview is clipped to source and brush and excludes visible geometry', () => {
  const source = [square(0, 0, 100, 100)];
  const current = [square(0, 0, 40, 100)];
  const candidate = [square(-20, -20, 80, 120)];
  const mask = [square(20, 20, 70, 70)];
  const clipped = constrainRestorePatch(candidate, current, source, mask);
  assert.ok(Math.abs(filledArea(clipped) - 1500) < 1e-5);
});
 
test('restore patch does not duplicate geometry already present', () => {
  const source = [square(0, 0, 100, 100)];
  const patch = buildRestorePatch(source, source, [square(20, 20, 80, 80)]);
  assert.equal(patch.length, 0);
});

test('keeps original geometry when no masks are supplied', () => {
  const source = [square(0, 0, 100, 100)];
  const result = applyEraseRestoreMasks(source);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], source[0]);
});

test('builds a finite round-capped brush mask', () => {
  const mask = buildBrushMask([{ x: 0, y: 0 }, { x: 50, y: 0 }], 5);
  assert.equal(mask.length, 1);
  assert.ok(mask[0].length >= 10);
  assert.ok(mask[0].every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

test('converts clipping output back to open editor rings', () => {
  const geometry = contoursToMultiPolygon([square(0, 0, 10, 10)]);
  const contours = multiPolygonToContours(geometry);
  assert.equal(contours.length, 1);
  assert.equal(contours[0].length, 4);
});
