import * as martinez from 'martinez-polygon-clipping';
import { strokeToContours } from './geometry.js';

const EPSILON = 1e-8;

function signedArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function cleanRing(points) {
  if (!Array.isArray(points)) return [];
  const ring = [];
  for (const p of points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const last = ring[ring.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > EPSILON) {
      ring.push({ x: p.x, y: p.y });
    }
  }
  if (ring.length > 1 && Math.hypot(ring[0].x - ring.at(-1).x, ring[0].y - ring.at(-1).y) <= EPSILON) ring.pop();
  return ring.length >= 3 && Math.abs(signedArea(ring)) > EPSILON ? ring : [];
}

function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    const crosses = (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function toMultiPolygon(contours) {
  const rings = (Array.isArray(contours) ? contours : [])
    .map(cleanRing)
    .filter(ring => ring.length >= 3)
    .map(ring => ({ ring, area: Math.abs(signedArea(ring)), parent: -1, depth: 0 }))
    .sort((a, b) => b.area - a.area);

  for (let i = 0; i < rings.length; i++) {
    const item = rings[i];
    let parent = -1;
    let parentArea = Infinity;
    const probe = item.ring[0];
    for (let j = 0; j < i; j++) {
      const candidate = rings[j];
      if (candidate.area < parentArea && pointInRing(probe, candidate.ring)) {
        parent = j;
        parentArea = candidate.area;
      }
    }
    item.parent = parent;
    item.depth = parent < 0 ? 0 : rings[parent].depth + 1;
  }

  const polygons = [];
  const polygonByRing = new Map();
  for (let i = 0; i < rings.length; i++) {
    const item = rings[i];
    if (item.depth % 2 === 0) {
      const polygon = [item.ring.map(p => [p.x, p.y])];
      polygons.push(polygon);
      polygonByRing.set(i, polygon);
    } else {
      let ancestor = item.parent;
      while (ancestor >= 0 && rings[ancestor].depth % 2 !== 0) ancestor = rings[ancestor].parent;
      const polygon = polygonByRing.get(ancestor);
      if (polygon) polygon.push(item.ring.map(p => [p.x, p.y]));
    }
  }
  return polygons;
}

function fromMultiPolygon(result) {
  if (!Array.isArray(result)) return [];
  const contours = [];
  for (const polygon of result) {
    if (!Array.isArray(polygon)) continue;
    for (const ring of polygon) {
      const points = Array.isArray(ring) ? ring.map(pair => ({ x: Number(pair[0]), y: Number(pair[1]) })) : [];
      const clean = cleanRing(points);
      if (clean.length >= 3) contours.push(clean);
    }
  }
  return contours;
}

function unionAll(geometries) {
  let result = [];
  for (const geometry of geometries) {
    if (!geometry?.length) continue;
    result = result.length ? martinez.union(result, geometry) : geometry;
  }
  return result;
}

function safeDifference(subject, clip) {
  if (!subject?.length) return [];
  if (!clip?.length) return subject;
  return martinez.diff(subject, clip);
}

function safeIntersection(subject, clip) {
  if (!subject?.length || !clip?.length) return [];
  return martinez.intersection(subject, clip);
}

/**
 * Converts editor contours (including nested holes/islands) into GeoJSON MultiPolygon.
 * Coordinates are kept in editor units; rings are normalized by containment, not winding.
 */
export function contoursToMultiPolygon(contours) {
  return toMultiPolygon(contours);
}

/** Converts a Martinez MultiPolygon back into editor contour rings. */
export function multiPolygonToContours(geometry) {
  return fromMultiPolygon(geometry);
}

/** Builds a round-capped polygon mask swept along a brush path. */
export function buildBrushMask(points, radius) {
  const safeRadius = Number(radius);
  if (!Number.isFinite(safeRadius) || safeRadius <= 0) return [];
  return strokeToContours(points, safeRadius).map(cleanRing).filter(ring => ring.length >= 3);
}

/**
 * Applies non-destructive erase and restore masks to the original source contours.
 * Restore is clipped to the source geometry, so it can never paint outside the glyph.
 */
/**
 * Builds only the missing part of the original shape under a restore brush.
 * Existing visible geometry is subtracted from the patch, so it is never duplicated.
 * The caller can append these new rings while keeping untouched Bezier contours intact.
 */
export function buildRestorePatch(currentContours, sourceContours, restoreMaskContours = []) {
  const source = toMultiPolygon(sourceContours);
  const current = toMultiPolygon(currentContours);
  const masks = unionAll(restoreMaskContours.map(mask => toMultiPolygon([mask])).filter(x => x.length));
  if (!source.length || !masks.length) return [];
  const sourceUnderBrush = safeIntersection(source, masks);
  if (!sourceUnderBrush.length) return [];
  return fromMultiPolygon(safeDifference(sourceUnderBrush, current));
}

export function applyEraseRestoreMasks(sourceContours, eraseMaskContours = [], restoreMaskContours = []) {
  const source = toMultiPolygon(sourceContours);
  if (!source.length) return [];
  const erase = unionAll(eraseMaskContours.map(mask => toMultiPolygon([mask])).filter(x => x.length));
  const restore = unionAll(restoreMaskContours.map(mask => toMultiPolygon([mask])).filter(x => x.length));
  const remaining = safeDifference(source, erase);
  if (!restore.length) return fromMultiPolygon(remaining);
  const restoredSourceArea = safeIntersection(source, restore);
  return fromMultiPolygon(unionAll([remaining, restoredSourceArea]));
}
