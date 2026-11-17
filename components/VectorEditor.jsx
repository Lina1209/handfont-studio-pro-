import { Fragment, useEffect, useRef, useState, useCallback } from 'react';
import * as opentypeModule from 'opentype.js';
import { METRICS } from '../lib/project.js';
import { strokeToContours } from '../lib/geometry.js';

const opentype = opentypeModule.default ?? opentypeModule;

/* ===== Геометрия (координаты шрифта: y вверх, базовая линия y=0) ===== */
const VIEW0 = { xMin: -60, xMax: 940, yMin: -260, yMax: 840 };
const F = n => Math.round(n * 10) / 10;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const clone = o => JSON.parse(JSON.stringify(o));
let uidCounter = 1;
const uid = () => 'o' + (uidCounter++) + '_' + Date.now().toString(36);

function cubicAt(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: u*u*u*p0.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*p3.x,
    y: u*u*u*p0.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*p3.y
  };
}
function segCtrl(a, b) {
  if (!a.hOut && !b.hIn) return null;
  return [a.hOut || { x: a.x, y: a.y }, b.hIn || { x: b.x, y: b.y }];
}
function flattenContour(c, step = 6) {
  const ns = c.nodes, n = ns.length, pts = [];
  if (n < 2) return pts;
  pts.push({ x: ns[0].x, y: ns[0].y, seg: 0, t: 0 });
  for (let i = 0; i < n; i++) {
    const a = ns[i], b = ns[(i + 1) % n];
    const A = { x: a.x, y: a.y }, B = { x: b.x, y: b.y };
    const cv = segCtrl(a, b);
    if (cv) {
      const L = dist(A, cv[0]) + dist(cv[0], cv[1]) + dist(cv[1], B);
      const k = Math.max(4, Math.min(48, Math.ceil(L / step)));
      for (let j = 1; j <= k; j++) {
        const p = cubicAt(A, cv[0], cv[1], B, j / k);
        pts.push({ x: p.x, y: p.y, seg: i, t: j / k });
      }
    } else pts.push({ x: B.x, y: B.y, seg: (i + 1) % n, t: 0 });
  }
  pts.pop();
  return pts;
}
function areaStd(pts) {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  return s / 2;
}
function pointInPoly(p, pts) {
  let ins = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) ins = !ins;
  }
  return ins;
}
function windingAt(p, pts) {
  let w = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[j], b = pts[i];
    const cr = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (a.y <= p.y) { if (b.y > p.y && cr > 0) w++; }
    else { if (b.y <= p.y && cr < 0) w--; }
  }
  return w;
}
function reverseContour(c) {
  c.nodes.reverse();
  for (const n of c.nodes) { const t = n.hIn; n.hIn = n.hOut; n.hOut = t; }
}
// Внешний контур TTF (y вверх): по часовой => площадь < 0. Дырки — наоборот.
function normalizeObject(obj) {
  const flats = obj.contours.map(c => flattenContour(c, 8));
  for (let i = 0; i < obj.contours.length; i++) {
    if (flats[i].length < 3) continue;
    let depth = 0;
    for (let j = 0; j < obj.contours.length; j++)
      if (j !== i && flats[j].length > 2 && pointInPoly(flats[i][0], flats[j])) depth++;
    const want = depth % 2 === 0 ? -1 : 1;
    const a = areaStd(flats[i]);
    if (a !== 0 && Math.sign(a) !== want) reverseContour(obj.contours[i]);
  }
}
function bboxOfContours(cs) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const c of cs) for (const p of flattenContour(c, 6)) {
    if (p.x < x1) x1 = p.x;
    if (p.x > x2) x2 = p.x;
    if (p.y < y1) y1 = p.y;
    if (p.y > y2) y2 = p.y;
  }
  if (x1 > x2) return null;
  return { x: x1, y: y1, x2, y2, w: Math.max(x2 - x1, .001), h: Math.max(y2 - y1, .001), cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 };
}
function mapNode(n, f) {
  const p = f({ x: n.x, y: n.y });
  return { x: p.x, y: p.y, smooth: n.smooth, hIn: n.hIn ? f(n.hIn) : null, hOut: n.hOut ? f(n.hOut) : null };
}
const mapContours = (cs, f) => cs.map(c => ({ nodes: c.nodes.map(n => mapNode(n, f)) }));
const mT = (tx, ty) => [1, 0, 0, 1, tx, ty];
const mR = a => [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
function mMul(A, B) {
  return [A[0]*B[0]+A[2]*B[1], A[1]*B[0]+A[3]*B[1], A[0]*B[2]+A[2]*B[3], A[1]*B[2]+A[3]*B[3], A[0]*B[4]+A[2]*B[5]+A[4], A[1]*B[4]+A[3]*B[5]+A[5]];
}
const mApply = (m, p) => ({ x: m[0]*p.x + m[2]*p.y + m[4], y: m[1]*p.x + m[3]*p.y + m[5] });
const around = (c, M) => mMul(mT(c.x, c.y), mMul(M, mT(-c.x, -c.y)));

function perpDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  if (L < 1e-9) return dist(p, a);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / L;
}
function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  let dmax = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax > eps) {
    const l = rdp(pts.slice(0, idx + 1), eps), r = rdp(pts.slice(idx), eps);
    return l.slice(0, -1).concat(r);
  }
  return [pts[0], pts[pts.length - 1]];
}
function simplifyClosed(pts, eps) {
  if (pts.length < 5) return pts;
  let far = 1, fd = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i], pts[0]);
    if (d > fd) { fd = d; far = i; }
  }
  const s1 = rdp(pts.slice(0, far + 1), eps);
  const s2 = rdp(pts.slice(far).concat([pts[0]]), eps);
  return s1.slice(0, -1).concat(s2.slice(0, -1));
}
function smoothNodes(pts, f) {
  const n = pts.length, k = f / 4;
  return pts.map((p, i) => {
    const prev = pts[(i - 1 + n) % n], next = pts[(i + 1) % n];
    if (f <= 0 || n < 3) return { x: F(p.x), y: F(p.y), hIn: null, hOut: null, smooth: false };
    const tx = (next.x - prev.x) * k, ty = (next.y - prev.y) * k;
    return { x: F(p.x), y: F(p.y), smooth: true, hIn: { x: F(p.x - tx), y: F(p.y - ty) }, hOut: { x: F(p.x + tx), y: F(p.y + ty) } };
  });
}

/* ===== Трассировка растра (marching squares) ===== */
function traceBinary(v, w, h) {
  const segs = new Map();
  const key = (x, y) => x + '_' + y;
  const add = (a, b) => {
    const k = key(a[0], a[1]);
    if (!segs.has(k)) segs.set(k, []);
    segs.get(k).push(b);
  };
  const V = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : v[y * w + x];
  for (let y = -1; y < h; y++) for (let x = -1; x < w; x++) {
    const idx = V(x, y) * 8 + V(x + 1, y) * 4 + V(x + 1, y + 1) * 2 + V(x, y + 1);
    if (idx === 0 || idx === 15) continue;
    const N = [x + .5, y], E = [x + 1, y + .5], S = [x + .5, y + 1], W = [x, y + .5];
    switch (idx) {
      case 1: add(S, W); break;
      case 2: add(E, S); break;
      case 3: add(E, W); break;
      case 4: add(N, E); break;
      case 5: add(N, E); add(S, W); break;
      case 6: add(N, S); break;
      case 7: add(N, W); break;
      case 8: add(W, N); break;
      case 9: add(S, N); break;
      case 10: add(W, N); add(E, S); break;
      case 11: add(E, N); break;
      case 12: add(W, E); break;
      case 13: add(S, E); break;
      case 14: add(W, S); break;
    }
  }
  const loops = [];
  segs.forEach((list, k) => {
    while (list.length) {
      const start = k.split('_').map(Number);
      const loop = [start];
      let next = list.pop(), guard = 2000000, ok = false;
      while (guard--) {
        loop.push(next);
        const nk = key(next[0], next[1]);
        if (nk === k) { ok = true; break; }
        const l2 = segs.get(nk);
        if (!l2 || !l2.length) break;
        next = l2.pop();
      }
      if (ok && loop.length > 3) { loop.pop(); loops.push(loop.map(p => ({ x: p[0], y: p[1] }))); }
    }
  });
  return loops;
}
function bitmapLoops(data, w, h, thr, invert) {
  const v = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3];
    const lum = .299 * data[i * 4] + .587 * data[i * 4 + 1] + .114 * data[i * 4 + 2];
    let ink = a >= 128 && lum < thr;
    if (invert) ink = a >= 128 && lum >= thr;
    v[i] = ink ? 1 : 0;
  }
  return traceBinary(v, w, h);
}
function loopsToContours(loops, tol, smoothF) {
  const cs = [];
  for (const lp of loops) {
    const simp = simplifyClosed(lp, tol);
    if (simp.length < 3) continue;
    const c = { nodes: smoothNodes(simp, smoothF) };
    if (Math.abs(areaStd(flattenContour(c, 6))) < 30) continue;
    cs.push(c);
  }
  return cs;
}
function fitContoursToGlyph(cs, isLower) {
  const bb = bboxOfContours(cs);
  if (!bb) return cs;
  const targetH = isLower ? METRICS.xHeight : METRICS.capHeight;
  const s = targetH / bb.h;
  return mapContours(cs, p => ({ x: 450 + (p.x - bb.cx) * s, y: (p.y - bb.y) * s }));
}

/* ===== Импорт: символ из системного шрифта ===== */
function symbolFromSystem(ch, family, weight, italic) {
  const isLower = ch.toLowerCase() === ch && ch.toUpperCase() !== ch;
  const cv = document.createElement('canvas');
  cv.width = 480; cv.height = 480;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 480, 480);
  ctx.fillStyle = '#000';
  ctx.font = `${italic ? 'italic ' : ''}${weight} 300px "${family}"`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  const capAsc = ctx.measureText('H').actualBoundingBoxAscent || 210;
  const xAsc = ctx.measureText('x').actualBoundingBoxAscent || 150;
  const target = isLower ? METRICS.xHeight : METRICS.capHeight;
  const s = target / (isLower ? xAsc : capAsc);
  ctx.fillText(ch, 240, 330);
  const loops = bitmapLoops(ctx.getImageData(0, 0, 480, 480).data, 480, 480, 128, false);
  if (!loops.length) throw new Error('Символ не отрисовался.');
  const mapped = loops.map(lp => lp.map(p => ({ x: 450 + (p.x - 240) * s, y: (330 - p.y) * s })));
  return loopsToContours(mapped, 1.2, .6);
}

/* ===== Импорт: точный контур из TTF/OTF ===== */
function otPathToContours(path, map) {
  const cs = [];
  let cur = null, prev = null;
  for (const c of path.commands) {
    if (c.type === 'M') {
      cur = { nodes: [] }; cs.push(cur);
      const p = map(c.x, c.y);
      cur.nodes.push({ x: F(p.x), y: F(p.y), hIn: null, hOut: null, smooth: false });
      prev = p;
    } else if (c.type === 'L' && cur) {
      const p = map(c.x, c.y);
      cur.nodes.push({ x: F(p.x), y: F(p.y), hIn: null, hOut: null, smooth: false });
      prev = p;
    } else if (c.type === 'Q' && cur) {
      const q = map(c.x1, c.y1), p = map(c.x, c.y);
      const last = cur.nodes[cur.nodes.length - 1];
      last.hOut = { x: F(prev.x + (q.x - prev.x) * 2 / 3), y: F(prev.y + (q.y - prev.y) * 2 / 3) };
      last.smooth = true;
      cur.nodes.push({ x: F(p.x), y: F(p.y), smooth: true, hOut: null, hIn: { x: F(p.x + (q.x - p.x) * 2 / 3), y: F(p.y + (q.y - p.y) * 2 / 3) } });
      prev = p;
    } else if (c.type === 'C' && cur) {
      const c1 = map(c.x1, c.y1), c2 = map(c.x2, c.y2), p = map(c.x, c.y);
      const last = cur.nodes[cur.nodes.length - 1];
      last.hOut = { x: F(c1.x), y: F(c1.y) };
      last.smooth = true;
      cur.nodes.push({ x: F(p.x), y: F(p.y), smooth: true, hOut: null, hIn: { x: F(c2.x), y: F(c2.y) } });
      prev = p;
    } else if (c.type === 'Z' && cur) {
      if (cur.nodes.length > 1) {
        const fN = cur.nodes[0], lN = cur.nodes[cur.nodes.length - 1];
        if (Math.hypot(fN.x - lN.x, fN.y - lN.y) < .05) { fN.hIn = lN.hIn; cur.nodes.pop(); }
      }
      cur = null;
    }
  }
  return cs.filter(c => c.nodes.length >= 3);
}
function symbolFromFontFile(font, ch) {
  const isLower = ch.toLowerCase() === ch && ch.toUpperCase() !== ch;
  const glyph = font.charToGlyph(ch);
  if (!glyph || glyph.index === 0) throw new Error(`В этом шрифте нет символа «${ch}».`);
  const gb = glyph.path.getBoundingBox();
  if (!isFinite(gb.x1)) throw new Error('Пустой контур символа.');
  const upm = font.unitsPerEm || 1000;
  const os2 = font.tables && font.tables.os2;
  const capH = (os2 && os2.sCapHeight) || font.ascender * .9 || upm * .7;
  const xH = (os2 && os2.sxHeight) || upm * .5;
  const s = (isLower ? METRICS.xHeight : METRICS.capHeight) / (isLower ? xH : capH);
  const cx = (gb.x1 + gb.x2) / 2;
  return otPathToContours(glyph.path, (x, y) => ({ x: 450 + (x - cx) * s, y: y * s }));
}

/* ===== Импорт: PNG/JPG ===== */
function contoursFromImage(source, threshold, invert, simplify, smoothF, isLower) {
  const loops = bitmapLoops(source.data, source.w, source.h, threshold, invert);
  if (!loops.length) return [];
  const flipped = loops.map(lp => lp.map(p => ({ x: p.x, y: source.h - p.y })));
  const cs = loopsToContours(flipped, simplify, smoothF);
  return fitContoursToGlyph(cs, isLower);
}

/* ===== Импорт: SVG ===== */
function shapeToD(elm) {
  const g = n => Number(elm.getAttribute(n) || 0);
  const tag = elm.tagName.toLowerCase();
  if (tag === 'path') return elm.getAttribute('d') || '';
  if (tag === 'rect') {
    const x = g('x'), y = g('y'), w = g('width'), h = g('height');
    let rx = g('rx') || g('ry'), ry = g('ry') || g('rx');
    rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
    if (rx > 0) return `M ${x + rx} ${y} H ${x + w - rx} A ${rx} ${ry} 0 0 1 ${x + w} ${y + ry} V ${y + h - ry} A ${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h} H ${x + rx} A ${rx} ${ry} 0 0 1 ${x} ${y + h - ry} V ${y + ry} A ${rx} ${ry} 0 0 1 ${x + rx} ${y} Z`;
    return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
  }
  if (tag === 'circle') {
    const cx = g('cx'), cy = g('cy'), r = g('r');
    return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
  }
  if (tag === 'ellipse') {
    const cx = g('cx'), cy = g('cy'), rx = g('rx'), ry = g('ry');
    return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
  }
  if (tag === 'line') return `M ${g('x1')} ${g('y1')} L ${g('x2')} ${g('y2')}`;
  if (tag === 'polyline' || tag === 'polygon') {
    const nums = (elm.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
    let d = '';
    for (let i = 0; i + 1 < nums.length; i += 2) d += (i ? ' L ' : 'M ') + nums[i] + ' ' + nums[i + 1];
    return d + (tag === 'polygon' ? ' Z' : '');
  }
  return '';
}
function ribbonPoly(pts, w) {
  const n = pts.length;
  if (n < 2) return [];
  const L = [], R = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let dx = b.x - a.x, dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l * w / 2, ny = dx / l * w / 2;
    L.push({ x: pts[i].x + nx, y: pts[i].y + ny });
    R.push({ x: pts[i].x - nx, y: pts[i].y - ny });
  }
  return L.concat(R.reverse());
}
function createShapeObject(tool, start, end, width, sides = 6) {
  const left = Math.min(start.x, end.x), right = Math.max(start.x, end.x);
  const bottom = Math.min(start.y, end.y), top = Math.max(start.y, end.y);
  const w = right - left, h = top - bottom;
  if (tool !== 'line' && (w < 2 || h < 2)) return null;
  let points;
  if (tool === 'rect') points = [{x:left,y:bottom},{x:right,y:bottom},{x:right,y:top},{x:left,y:top}];
  else if (tool === 'ellipse') points = Array.from({length:64}, (_,i) => { const a=i/64*Math.PI*2; return {x:(left+right)/2+Math.cos(a)*w/2,y:(bottom+top)/2+Math.sin(a)*h/2}; });
  else if (tool === 'polygon') points = Array.from({length:Math.max(3,Math.min(12,Math.round(sides)))}, (_,i) => { const a=-Math.PI/2+i/Math.max(3,Math.min(12,Math.round(sides)))*Math.PI*2; return {x:(left+right)/2+Math.cos(a)*w/2,y:(bottom+top)/2+Math.sin(a)*h/2}; });
  else if (tool === 'line') {
    if (Math.hypot(end.x-start.x,end.y-start.y) < 2) return null;
    points = ribbonPoly([start,end], Math.max(8, width));
  } else return null;
  if (!points || points.length < 3) return null;
  return { id: uid(), contours: [{ nodes: points.map(p => ({x:F(p.x),y:F(p.y),hIn:null,hOut:null,smooth:false})) }] };
}
function contoursFromSvg(text, tol, smoothF, isLower) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) throw new Error('Не удалось разобрать SVG.');
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-99999px;top:0;width:10px;height:10px;overflow:hidden;visibility:hidden;';
  const svgClone = document.importNode(root, true);
  svgClone.removeAttribute('viewBox');
  svgClone.setAttribute('width', '10000');
  svgClone.setAttribute('height', '10000');
  holder.appendChild(svgClone);
  document.body.appendChild(holder);
  const raw = [];
  try {
    const shapes = svgClone.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon');
    for (const sh of shapes) {
      const d = shapeToD(sh);
      if (!d) continue;
      let pEl = sh;
      if (sh.tagName.toLowerCase() !== 'path') {
        const pe = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        for (let ai = 0; ai < sh.attributes.length; ai++) { const at = sh.attributes[ai]; pe.setAttribute(at.name, at.value); }
        pe.setAttribute('d', d);
        sh.replaceWith(pe);
        pEl = pe;
      }
      const L = pEl.getTotalLength();
      if (!isFinite(L) || L < .5) continue;
      const ctm = pEl.getCTM() || { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
      const sc = Math.sqrt(Math.abs(ctm.a * ctm.d - ctm.b * ctm.c)) || 1;
      const nSamp = Math.min(2500, Math.max(24, Math.ceil(L / 1.5)));
      const step = L / nSamp;
      const sty = getComputedStyle(pEl);
      const fillNone = sty.fill === 'none' || sty.fillOpacity === '0';
      const strokeOn = sty.stroke && sty.stroke !== 'none' && parseFloat(sty.strokeWidth) > 0;
      const sw = strokeOn ? parseFloat(sty.strokeWidth) : 0;
      let cur = [], prev = null;
      const parts = [];
      for (let j = 0; j <= nSamp; j++) {
        const pt = pEl.getPointAtLength(j * step);
        const mp = { x: ctm.a * pt.x + ctm.c * pt.y + ctm.e, y: ctm.b * pt.x + ctm.d * pt.y + ctm.f };
        if (prev && dist(mp, prev) > step * sc * 6) { if (cur.length > 1) parts.push(cur); cur = []; }
        cur.push(mp); prev = mp;
      }
      if (cur.length > 1) parts.push(cur);
      for (const pts of parts) {
        const closed = dist(pts[0], pts[pts.length - 1]) < step * sc * 2.5;
        if (!fillNone || closed || !strokeOn) raw.push({ pts, open: false, sw: 0 });
        else raw.push({ pts, open: true, sw: sw * sc });
      }
    }
  } finally { holder.remove(); }
  if (!raw.length) throw new Error('В SVG не найдено контуров.');
  const flip = p => ({ x: p.x, y: -p.y });
  const cs = [];
  for (const r of raw) {
    const pts = r.pts.map(flip);
    if (r.open) {
      const rib = ribbonPoly(pts, Math.max(1, r.sw));
      if (rib.length < 3) continue;
      cs.push({ nodes: smoothNodes(rib, Math.min(smoothF, .4)) });
    } else {
      const simp = simplifyClosed(pts, tol);
      if (simp.length < 3) continue;
      cs.push({ nodes: smoothNodes(simp, smoothF) });
    }
  }
  const filtered = cs.filter(c => Math.abs(areaStd(flattenContour(c, 6))) > 20);
  return fitContoursToGlyph(filtered, isLower);
}

/* ===== Узоры ===== */
function patternContours(kind, size) {
  const S = size || 500, cx = 450, cy = 350;
  const poly = pts => ({ nodes: pts.map(p => ({ x: F(p.x), y: F(p.y), hIn: null, hOut: null, smooth: false })) });
  const circle = (r, n = 48) => Array.from({ length: n }, (_, i) => { const a = i / n * Math.PI * 2; return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }; });
  const star = (rO, rI, spikes) => Array.from({ length: spikes * 2 }, (_, i) => { const a = i / (spikes * 2) * Math.PI * 2 - Math.PI / 2; const r = i % 2 ? rI : rO; return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }; });
  if (kind === 'star5') return [poly(star(S / 2, S / 4.6, 5))];
  if (kind === 'star8') return [poly(star(S / 2, S / 3.4, 8))];
  if (kind === 'ring') return [poly(circle(S / 2)), poly(circle(S / 3.1))];
  if (kind === 'flower') {
    const pts = Array.from({ length: 120 }, (_, i) => { const a = i / 120 * Math.PI * 2; const r = S / 2 * (0.62 + 0.38 * Math.cos(a * 6)); return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }; });
    return [{ nodes: smoothNodes(pts, .8) }];
  }
  if (kind === 'heart') {
    const pts = Array.from({ length: 100 }, (_, i) => {
      const t = i / 100 * Math.PI * 2;
      const x = 16 * Math.pow(Math.sin(t), 3);
      const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      return { x: cx + x * S / 34, y: cy + y * S / 34 };
    });
    return [{ nodes: smoothNodes(pts, .8) }];
  }
  if (kind === 'diamond') return [poly([{ x: cx, y: cy + S / 2 }, { x: cx + S / 3, y: cy }, { x: cx, y: cy - S / 2 }, { x: cx - S / 3, y: cy }])];
  if (kind === 'wave') {
    const top = Array.from({ length: 60 }, (_, i) => ({ x: 100 + i * 12, y: cy + 90 + Math.sin(i / 60 * Math.PI * 4) * 70 }));
    const bottom = top.map(p => ({ x: p.x, y: p.y - 130 })).reverse();
    return [{ nodes: smoothNodes(top.concat(bottom), .6) }];
  }
  if (kind === 'zigzag') {
    const top = Array.from({ length: 13 }, (_, i) => ({ x: 90 + i * 60, y: cy + 100 + (i % 2 ? -80 : 80) }));
    const bottom = top.map(p => ({ x: p.x, y: p.y - 150 })).reverse();
    return [poly(top.concat(bottom))];
  }
  return [];
}

const FAMILIES = ['Georgia', 'Times New Roman', 'Arial', 'Verdana', 'Courier New', 'Impact', 'Comic Sans MS', 'Trebuchet MS', 'Palatino Linotype', 'Segoe Script', 'Brush Script MT', 'cursive', 'serif', 'sans-serif', 'monospace'];
const PATTERNS = [['star5', '★ Звезда 5'], ['star8', '✦ Звезда 8'], ['ring', '◎ Кольцо'], ['flower', '✿ Цветок'], ['heart', '♥ Сердце'], ['diamond', '◆ Ромб'], ['wave', '〜 Волна'], ['zigzag', '⩘ Зигзаг']];
const TOOL_DEFS = [
  ['select', 'V', 'Выбор / трансформация'],
  ['line', 'L', 'Прямая линия'],
  ['rect', 'R', 'Прямоугольник'],
  ['ellipse', 'O', 'Овал / эллипс'],
  ['polygon', 'G', 'Многоугольник'],
  ['node', 'N', 'Узлы и кривые'],
  ['pen', 'P', 'Перо Безье'],
  ['brush', 'B', 'Кисть (штрих)'],
  ['eraser', 'E', 'Ластик'],
  ['hand', 'H', 'Рука (панорама)']
];

export default function VectorEditor({ char, glyph, onApply, onClose }) {
  const canvasRef = useRef(null);
  const activePointerId = useRef(null);
  const pointersRef = useRef(new Map());
  const [objects, setObjects] = useState(() => {
    const list = [];
    for (const stroke of Array.isArray(glyph.strokes) ? glyph.strokes : []) {
      if (!stroke || !Array.isArray(stroke.points)) continue;
      const contours = strokeToContours(stroke.points, (Number(stroke.width) || 70) / 2);
      const valid = contours.map(contour => contour
        .filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))
        .map(p => ({ x: p.x, y: p.y, hIn: null, hOut: null, smooth: false })))
        .filter(nodes => nodes.length >= 3);
      if (valid.length) list.push({ id: uid(), contours: valid.map(nodes => ({ nodes })) });
    }
    for (const contour of Array.isArray(glyph.outlines) ? glyph.outlines : []) {
      if (Array.isArray(contour) && contour.length >= 3 &&
          contour.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))) {
        list.push({ id: uid(), contours: [{ nodes: contour.map(p => ({ x: p.x, y: p.y, hIn: null, hOut: null, smooth: false })) }] });
      }
    }
    return list;
  });
  const [tool, setToolState] = useState('select');
  const [sel, setSel] = useState(null);
  const [selMode, setSelMode] = useState('scale');
  const [selNode, setSelNode] = useState(null);
  const [selectedNodes, setSelectedNodes] = useState([]);
  const [nodeMultiSelect, setNodeMultiSelect] = useState(false);
  const [cornerRadius, setCornerRadius] = useState(60);
  const [view, setView] = useState({ ...VIEW0 });
  const [brushWidth, setBrushWidth] = useState(60);
  const [polygonSides, setPolygonSides] = useState(6);
  const [showGuides, setShowGuides] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [eraserR, setEraserR] = useState(45);
  const [message, setMessage] = useState('Вставьте узор, букву, знак или картинку — всё привяжется к направляющим шрифта.');
  const [importOpen, setImportOpen] = useState(false);
  const [importTab, setImportTab] = useState('pattern');
  const [symChar, setSymChar] = useState(char === ' ' ? 'A' : char);
  const [symFamily, setSymFamily] = useState('Georgia');
  const [symWeight, setSymWeight] = useState('400');
  const [symItalic, setSymItalic] = useState(false);
  const [loadedFont, setLoadedFont] = useState(null);
  const [loadedFontName, setLoadedFontName] = useState('');
  const [pngSource, setPngSource] = useState(null);
  const [pngThr, setPngThr] = useState(128);
  const [pngInvert, setPngInvert] = useState(false);
  const [pngSimplify, setPngSimplify] = useState(1.6);
  const [pngSmooth, setPngSmooth] = useState(0.7);
  const [svgText, setSvgText] = useState('');
  const [svgTol, setSvgTol] = useState(1.2);
  const [svgSmooth, setSvgSmooth] = useState(0.5);
  const [patternKind, setPatternKind] = useState('star5');
  const [patternSize, setPatternSize] = useState(520);
  const [previewContours, setPreviewContours] = useState(null);
  const [, forceRender] = useState(0);

  const stateRef = useRef({});
  stateRef.current = { objects, tool, sel, selMode, selNode, selectedNodes, nodeMultiSelect, view, brushWidth, eraserR, polygonSides, showGuides, showGrid, snapToGrid };
  const gestureRef = useRef(null);
  const penRef = useRef({ nodes: [], cursor: null, dragging: false, dragNode: null });
  const brushRef = useRef(null);
  const historyRef = useRef({ u: [], r: [] });
  const appearanceEditRef = useRef(null);
  const spaceRef = useRef(false);
  const lastTapRef = useRef({ t: 0, x: 0, y: 0 });
  const eraserPosRef = useRef(null);
  const importOpenRef = useRef(false);
  importOpenRef.current = importOpen;

  const isLower = char.toLowerCase() === char && char.toUpperCase() !== char;
  const snap = () => clone(stateRef.current.objects);
  const pushHistory = s => { historyRef.current.u.push(s); if (historyRef.current.u.length > 60) historyRef.current.u.shift(); historyRef.current.r = []; };
  const rerender = () => forceRender(v => v + 1);

  const commit = useCallback((mutator, snapshot) => {
    const s = snapshot || clone(stateRef.current.objects);
    let next = clone(stateRef.current.objects);
    if (mutator) next = mutator(next) || next;
    for (const o of next) normalizeObject(o);
    pushHistory(s);
    setObjects(next);
    setMessage('Изменено. «Применить» запишет результат в букву ' + (char === ' ' ? '(пробел)' : char) + '.');
  }, [char]);

  const undo = () => {
    const h = historyRef.current;
    if (!h.u.length) return;
    h.r.push(clone(stateRef.current.objects));
    setObjects(h.u.pop());
    setSel(null); setSelNode(null);
    rerender();
  };
  const redo = () => {
    const h = historyRef.current;
    if (!h.r.length) return;
    h.u.push(clone(stateRef.current.objects));
    setObjects(h.r.pop());
    setSel(null); setSelNode(null);
    rerender();
  };

  const getObj = list => (list || stateRef.current.objects).find(o => o.id === stateRef.current.sel) || null;
  const beginAppearanceEdit = () => {
    if (!appearanceEditRef.current) appearanceEditRef.current = clone(stateRef.current.objects);
  };
  const changeAppearance = (key, value) => {
    const so = getObj();
    if (!so) return;
    beginAppearanceEdit();
    const next = clone(stateRef.current.objects);
    const ob = next.find(o => o.id === so.id);
    if (!ob) return;
    ob.appearance = { opacity: 1, edgeOpacity: 0.95, centerOpacity: 0.18, ...(ob.appearance || {}), [key]: Number(value) / 100 };
    setObjects(next);
  };
  const endAppearanceEdit = () => {
    if (!appearanceEditRef.current) return;
    pushHistory(appearanceEditRef.current);
    appearanceEditRef.current = null;
    setMessage('Внешний вид символа изменён. При экспорте шрифта сохраняется геометрия контура.');
  };

  const posFromEvent = e => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const v = stateRef.current.view;
    const scale = rect.height / (v.yMax - v.yMin);
    return { x: (e.clientX - rect.left) / scale + v.xMin, y: v.yMax - (e.clientY - rect.top) / scale };
  };

  /* ===== Отрисовка ===== */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const v = stateRef.current.view;
      const scale = rect.height / (v.yMax - v.yMin);
      const X = x => (x - v.xMin) * scale, Y = y => (v.yMax - y) * scale;
      ctx.fillStyle = '#111318'; ctx.fillRect(0, 0, rect.width, rect.height);
      ctx.fillStyle = '#171a21';
      ctx.fillRect(X(0), Y(METRICS.ascender), 900 * scale, (METRICS.ascender - METRICS.descender) * scale);
      const st = stateRef.current;
      if (st.showGrid) {
        ctx.save(); ctx.strokeStyle = '#343a46'; ctx.globalAlpha = .42; ctx.lineWidth = 1;
        for (let x = Math.ceil(v.xMin / 100) * 100; x <= v.xMax; x += 100) { ctx.beginPath(); ctx.moveTo(X(x), 0); ctx.lineTo(X(x), rect.height); ctx.stroke(); }
        for (let y = Math.ceil(v.yMin / 100) * 100; y <= v.yMax; y += 100) { ctx.beginPath(); ctx.moveTo(0, Y(y)); ctx.lineTo(rect.width, Y(y)); ctx.stroke(); }
        ctx.restore();
      }
      if (st.showGuides) {
        for (const [y, color, label] of [[METRICS.ascender, '#3b82f6', 'верхняя (800)'], [METRICS.capHeight, '#6366f1', 'прописные (700)'], [METRICS.xHeight, '#8b5cf6', 'строчные (500)'], [0, '#22c55e', 'БАЗОВАЯ ЛИНИЯ (0)'], [METRICS.descender, '#ef4444', 'нижняя (-200)']]) {
          ctx.strokeStyle = color; ctx.lineWidth = y === 0 ? 1.6 : 1;
          ctx.beginPath(); ctx.moveTo(0, Y(y)); ctx.lineTo(rect.width, Y(y)); ctx.stroke();
          ctx.fillStyle = color; ctx.font = '10px sans-serif'; ctx.fillText(label, 8, Y(y) - 4);
        }
        ctx.strokeStyle = '#3a3f4b'; ctx.setLineDash([5, 5]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(X(0), 0); ctx.lineTo(X(0), rect.height); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(X(glyph.advanceWidth || 600), 0); ctx.lineTo(X(glyph.advanceWidth || 600), rect.height); ctx.stroke();
        ctx.setLineDash([]);
      }
      const g = gestureRef.current;
      const displayContours = o => {
        if (!g || g.objId !== o.id) return o.contours;
        if (g.type === 'transform' && g.map) return mapContours(o.contours, g.map);
        if (g.type === 'nodeTransform' && g.transformed) {
          const transformed = new Map(g.transformed.map(item => [item.ci + ':' + item.ni, item.node]));
          return o.contours.map((c, ci) => ({ nodes: c.nodes.map((n, ni) => {
            const item = transformed.get(ci + ':' + ni);
            return item ? { ...clone(item) } : n;
          }) }));
        }
        if (g.type === 'nodeGroupTransform' && g.transformed) {
          const transformed = new Map(g.transformed.map(item => [item.ci + ':' + item.ni, item.node]));
          return o.contours.map((c, ci) => ({ nodes: c.nodes.map((n, ni) => {
            const item = transformed.get(ci + ':' + ni);
            return item ? { ...clone(item) } : n;
          }) }));
        }
        if (g.type === 'node' && g.moved) {
          const d = g.delta;
          const selected = new Set((g.nodes || [{ ci: g.ci, ni: g.ni }]).map(q => q.ci + ':' + q.ni));
          return o.contours.map((c, ci) => ({ nodes: c.nodes.map((n, ni) => selected.has(ci + ':' + ni) ? { x: n.x + d.x, y: n.y + d.y, smooth: n.smooth, hIn: n.hIn ? { x: n.hIn.x + d.x, y: n.hIn.y + d.y } : null, hOut: n.hOut ? { x: n.hOut.x + d.x, y: n.hOut.y + d.y } : null } : n) }));
        }
        if (g.type === 'handle' && g.pos) {
          return o.contours.map((c, ci) => ({ nodes: c.nodes.map((n, ni) => { if (ci !== g.ci || ni !== g.ni) return n; const cp = clone(n); cp[g.which] = { x: g.pos.x, y: g.pos.y }; return cp; }) }));
        }
        return o.contours;
      };
      const tracePath = c => {
        const ns = c.nodes, n = ns.length;
        if (n < 2) return;
        ctx.moveTo(X(ns[0].x), Y(ns[0].y));
        for (let i = 0; i < n; i++) {
          const a = ns[i], b = ns[(i + 1) % n];
          const cv = segCtrl(a, b);
          if (cv) ctx.bezierCurveTo(X(cv[0].x), Y(cv[0].y), X(cv[1].x), Y(cv[1].y), X(b.x), Y(b.y));
          else ctx.lineTo(X(b.x), Y(b.y));
        }
        ctx.closePath();
      };
      for (const o of st.objects) {
        const contours = displayContours(o);
        const appearance = o.appearance || { opacity: 1, edgeOpacity: 0.95, centerOpacity: 0.18 };
        const bb = bboxOfContours(contours);
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, appearance.opacity ?? 1));
        ctx.beginPath();
        for (const c of contours) tracePath(c);
        if (bb) {
          const radius = Math.max(1, Math.hypot(bb.w, bb.h) * scale * 0.72);
          const gradient = ctx.createRadialGradient(X(bb.cx), Y(bb.cy), 0, X(bb.cx), Y(bb.cy), radius);
          const centerA = Math.max(0, Math.min(1, appearance.centerOpacity ?? 0.18));
          const edgeA = Math.max(0, Math.min(1, appearance.edgeOpacity ?? 0.95));
          gradient.addColorStop(0, 'rgba(239,233,220,' + centerA + ')');
          gradient.addColorStop(1, 'rgba(105,98,87,' + edgeA + ')');
          ctx.fillStyle = gradient;
        } else ctx.fillStyle = o.id === st.sel ? '#efe9dc' : '#d9d4c8';
        ctx.fill('nonzero');
        ctx.restore();
      }
      if (g && g.type === 'shape' && g.preview) {
        ctx.save(); ctx.globalAlpha = 0.58; ctx.fillStyle = '#8ea2ff'; ctx.strokeStyle = '#aab8ff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); for (const c of g.preview.contours) tracePath(c); ctx.fill('evenodd'); ctx.stroke(); ctx.restore();
      }
      if (brushRef.current && brushRef.current.length) {
        ctx.strokeStyle = '#8ea2ff'; ctx.lineWidth = Math.max(1, st.brushWidth * scale); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(X(brushRef.current[0].x), Y(brushRef.current[0].y));
        for (const p of brushRef.current.slice(1)) ctx.lineTo(X(p.x), Y(p.y));
        ctx.stroke();
      }
      const pen = penRef.current;
      if (st.tool === 'pen' && pen.nodes.length) {
        ctx.strokeStyle = '#8ea2ff'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(X(pen.nodes[0].x), Y(pen.nodes[0].y));
        for (let i = 1; i < pen.nodes.length; i++) {
          const a = pen.nodes[i - 1], b = pen.nodes[i], cv = segCtrl(a, b);
          if (cv) ctx.bezierCurveTo(X(cv[0].x), Y(cv[0].y), X(cv[1].x), Y(cv[1].y), X(b.x), Y(b.y));
          else ctx.lineTo(X(b.x), Y(b.y));
        }
        if (pen.cursor && !pen.dragging) ctx.lineTo(X(pen.cursor.x), Y(pen.cursor.y));
        ctx.stroke();
        pen.nodes.forEach((n, i) => {
          ctx.fillStyle = i === 0 ? '#8ea2ff' : '#fff';
          ctx.fillRect(X(n.x) - 4, Y(n.y) - 4, 8, 8);
          ctx.strokeStyle = '#4f46e5'; ctx.strokeRect(X(n.x) - 4, Y(n.y) - 4, 8, 8);
        });
      }
      const so = st.objects.find(o => o.id === st.sel);
      if (st.tool === 'select' && so) {
        const bb = bboxOfContours(displayContours(so));
        if (bb) {
          ctx.strokeStyle = '#8ea2ff'; ctx.lineWidth = 1.2; ctx.setLineDash([6, 4]);
          ctx.strokeRect(X(bb.x), Y(bb.y2), bb.w * scale, bb.h * scale);
          ctx.setLineDash([]);
          for (const [name, hx, hy] of handlePts(bb)) {
            const sx = X(hx), sy = Y(hy);
            ctx.fillStyle = '#fff'; ctx.strokeStyle = '#4f46e5'; ctx.lineWidth = 1.4;
            if (st.selMode === 'scale') { ctx.fillRect(sx - 4.5, sy - 4.5, 9, 9); ctx.strokeRect(sx - 4.5, sy - 4.5, 9, 9); }
            else if (name.length === 2) { ctx.beginPath(); ctx.arc(sx, sy, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
            else { ctx.beginPath(); ctx.moveTo(sx, sy - 5.5); ctx.lineTo(sx + 5.5, sy); ctx.lineTo(sx, sy + 5.5); ctx.lineTo(sx - 5.5, sy); ctx.closePath(); ctx.fill(); ctx.stroke(); }
          }
          if (st.selMode === 'rotate') {
            ctx.fillStyle = '#4f46e5';
            ctx.beginPath(); ctx.arc(X(bb.cx), Y(bb.cy), 3, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
      if (st.tool === 'node' && so) {
        const cs = displayContours(so);
        ctx.strokeStyle = '#8ea2ff'; ctx.lineWidth = 1;
        cs.forEach((c, ci) => {
          ctx.beginPath(); tracePath(c); ctx.stroke();
          c.nodes.forEach((n, ni) => {
            const active = st.selNode && st.selNode.ci === ci && st.selNode.ni === ni;
            const multi = (st.selectedNodes || []).some(q => q.ci === ci && q.ni === ni);
            if (active) {
              for (const w of ['hIn', 'hOut']) if (n[w]) {
                ctx.strokeStyle = '#9aa3b5'; ctx.beginPath(); ctx.moveTo(X(n.x), Y(n.y)); ctx.lineTo(X(n[w].x), Y(n[w].y)); ctx.stroke();
                ctx.fillStyle = '#fff'; ctx.strokeStyle = '#4f46e5';
                ctx.beginPath(); ctx.arc(X(n[w].x), Y(n[w].y), 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
              }
            }
            ctx.fillStyle = active ? '#4f46e5' : multi ? '#0f9d8a' : '#fff';
            ctx.strokeStyle = multi ? '#0f9d8a' : '#4f46e5'; ctx.lineWidth = 1.1;
            ctx.fillRect(X(n.x) - 3.4, Y(n.y) - 3.4, 6.8, 6.8);
            ctx.strokeRect(X(n.x) - 3.4, Y(n.y) - 3.4, 6.8, 6.8);
          });
        });
        const refs=(st.selectedNodes||[]).filter(q=>so.contours[q.ci]?.nodes[q.ni]);
        const groupBB=selectedNodeBounds(so,refs);
        if (groupBB && refs.length>=2) {
          const pad=7*scale, top=groupBB.y2+28*screenK();
          ctx.save(); ctx.strokeStyle='#0f9d8a'; ctx.fillStyle='#fff'; ctx.lineWidth=1.5; ctx.setLineDash([5,4]);
          ctx.strokeRect(X(groupBB.x)-pad,Y(groupBB.y2)-pad,groupBB.w*scale+2*pad,groupBB.h*scale+2*pad);
          ctx.setLineDash([]);
          const marks=[['nw',groupBB.x,groupBB.y2],['n',groupBB.cx,groupBB.y2],['ne',groupBB.x2,groupBB.y2],['e',groupBB.x2,groupBB.cy],['se',groupBB.x2,groupBB.y],['s',groupBB.cx,groupBB.y],['sw',groupBB.x,groupBB.y],['w',groupBB.x,groupBB.cy]];
          for(const [,hx,hy] of marks){ctx.beginPath();ctx.arc(X(hx),Y(hy),5.5,0,Math.PI*2);ctx.fill();ctx.stroke();}
          ctx.beginPath();ctx.moveTo(X(groupBB.cx),Y(groupBB.y2));ctx.lineTo(X(groupBB.cx),Y(top));ctx.stroke();
          ctx.beginPath();ctx.arc(X(groupBB.cx),Y(top),6.5,0,Math.PI*2);ctx.fill();ctx.stroke();
          ctx.restore();
        }
      }
      if (st.tool === 'eraser' && eraserPosRef.current) {
        ctx.strokeStyle = '#ff8585'; ctx.fillStyle = 'rgba(255,133,133,.08)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(X(eraserPosRef.current.x), Y(eraserPosRef.current.y), st.eraserR * scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  });

  /* ===== Попадания ===== */
  function handlePts(bb) {
    return [['nw', bb.x, bb.y2], ['n', bb.cx, bb.y2], ['ne', bb.x2, bb.y2], ['e', bb.x2, bb.cy], ['se', bb.x2, bb.y], ['s', bb.cx, bb.y], ['sw', bb.x, bb.y], ['w', bb.x, bb.cy]];
  }
  const screenK = () => {
    const rect = canvasRef.current.getBoundingClientRect();
    return (stateRef.current.view.yMax - stateRef.current.view.yMin) / Math.max(1, rect.height);
  };
  function hitHandle(p, bb, k) {
    for (const [name, hx, hy] of handlePts(bb)) if (Math.abs(p.x - hx) < 9 * k && Math.abs(p.y - hy) < 9 * k) return name;
    return null;
  }
  function hitObject(p, k) {
    const list = stateRef.current.objects;
    for (let i = list.length - 1; i >= 0; i--) {
      let w = 0, near = false;
      for (const c of list[i].contours) {
        const f = flattenContour(c, 8);
        w += windingAt(p, f);
        if (!near) for (const q of f) { const dx = q.x - p.x, dy = q.y - p.y; if (dx * dx + dy * dy < 16 * k * k) { near = true; break; } }
      }
      if (w !== 0 || near) return list[i];
    }
    return null;
  }
  function hitNode(o, p, r) {
    for (let ci = 0; ci < o.contours.length; ci++) {
      const ns = o.contours[ci].nodes;
      for (let ni = 0; ni < ns.length; ni++) if (Math.abs(p.x - ns[ni].x) < r && Math.abs(p.y - ns[ni].y) < r) return { ci, ni };
    }
    return null;
  }
  function hitSegment(o, p, tol) {
    let best = null, bd = tol * tol;
    o.contours.forEach((c, ci) => {
      for (const q of flattenContour(c, 5)) {
        const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
        if (d < bd) { bd = d; best = { ci, seg: q.seg, t: q.t }; }
      }
    });
    return best;
  }
  function insertNodeAt(o, at) {
    const c = o.contours[at.ci], ns = c.nodes, len = ns.length;
    const a = ns[at.seg], b = ns[(at.seg + 1) % len], t = at.t;
    const cv = segCtrl(a, b);
    let nn;
    if (cv) {
      const p0 = { x: a.x, y: a.y }, p3 = { x: b.x, y: b.y };
      const p01 = lerp(p0, cv[0], t), p12 = lerp(cv[0], cv[1], t), p23 = lerp(cv[1], p3, t);
      const p012 = lerp(p01, p12, t), p123 = lerp(p12, p23, t), m = lerp(p012, p123, t);
      a.hOut = { x: F(p01.x), y: F(p01.y) };
      b.hIn = { x: F(p23.x), y: F(p23.y) };
      nn = { x: F(m.x), y: F(m.y), smooth: true, hIn: { x: F(p012.x), y: F(p012.y) }, hOut: { x: F(p123.x), y: F(p123.y) } };
    } else {
      const m = lerp(a, b, t);
      nn = { x: F(m.x), y: F(m.y), smooth: false, hIn: null, hOut: null };
    }
    ns.splice(at.seg + 1, 0, nn);
    return { ci: at.ci, ni: at.seg + 1 };
  }

  /* ===== Жесты ===== */
  const clampAbs = (v, m) => Math.abs(v) < m ? (v < 0 ? -m : m) : v;
  function bakeGesture(g) {
    if (!g.moved) return;
    commit(list => {
      const ob = list.find(x => x.id === g.objId);
      if (!ob) return list;
      if (g.type === 'transform' && g.map) ob.contours = mapContours(ob.contours, g.map);
      if (g.type === 'nodeTransform' && g.transformed) {
        for (const item of g.transformed) {
          const nn = ob.contours[item.ci]?.nodes[item.ni];
          if (!nn) continue;
          nn.x = F(item.node.x); nn.y = F(item.node.y);
          nn.hIn = item.node.hIn ? { x: F(item.node.hIn.x), y: F(item.node.hIn.y) } : null;
          nn.hOut = item.node.hOut ? { x: F(item.node.hOut.x), y: F(item.node.hOut.y) } : null;
          nn.smooth = item.node.smooth;
        }
      }
      if (g.type === 'nodeGroupTransform' && g.transformed) {
        for (const item of g.transformed) {
          const nn = ob.contours[item.ci]?.nodes[item.ni];
          if (!nn) continue;
          nn.x = F(item.node.x); nn.y = F(item.node.y);
          nn.hIn = item.node.hIn ? { x: F(item.node.hIn.x), y: F(item.node.hIn.y) } : null;
          nn.hOut = item.node.hOut ? { x: F(item.node.hOut.x), y: F(item.node.hOut.y) } : null;
          nn.smooth = item.node.smooth;
        }
      }
      if (g.type === 'node') {
        const targets = g.nodes || [{ ci: g.ci, ni: g.ni }];
        for (const target of targets) {
          const nn = ob.contours[target.ci] && ob.contours[target.ci].nodes[target.ni];
          if (!nn) continue;
          nn.x = F(nn.x + g.delta.x); nn.y = F(nn.y + g.delta.y);
          if (nn.hIn) { nn.hIn.x = F(nn.hIn.x + g.delta.x); nn.hIn.y = F(nn.hIn.y + g.delta.y); }
          if (nn.hOut) { nn.hOut.x = F(nn.hOut.x + g.delta.x); nn.hOut.y = F(nn.hOut.y + g.delta.y); }
        }
      }
      if (g.type === 'handle' && g.pos) {
        const nn = ob.contours[g.ci] && ob.contours[g.ci].nodes[g.ni];
        if (nn) {
          nn[g.which] = { x: F(g.pos.x), y: F(g.pos.y) };
          if (nn.smooth && !g.alt) {
            const other = g.which === 'hIn' ? 'hOut' : 'hIn';
            const dx = nn.x - g.pos.x, dy = nn.y - g.pos.y;
            const L = Math.hypot(dx, dy) || 1;
            const len = nn[other] ? Math.hypot(nn[other].x - nn.x, nn[other].y - nn.y) : L;
            nn[other] = { x: F(nn.x + dx / L * len), y: F(nn.y + dy / L * len) };
          }
        }
      }
      return list;
    }, g.snap);
  }
  function startTransform(o, fn) {
    gestureRef.current = { type: 'transform', snap: snap(), objId: o.id, map: null, moved: false,
      upd(p, e) { this.map = fn(p, e); this.moved = true; } };
  }
  function makeScaleFn(bb, h, p0) {
    const ax = h.includes('w') ? bb.x2 : h.includes('e') ? bb.x : bb.cx;
    const ay = h.includes('n') ? bb.y : h.includes('s') ? bb.y2 : bb.cy;
    const axisX = h.length === 2 || h === 'e' || h === 'w';
    const axisY = h.length === 2 || h === 'n' || h === 's';
    const s0x = (p0.x - ax) || .001, s0y = (p0.y - ay) || .001;
    return (p, e) => {
      let sx = axisX ? (p.x - ax) / s0x : 1;
      let sy = axisY ? (p.y - ay) / s0y : 1;
      if (e.shiftKey && axisX && axisY) { const m = Math.max(Math.abs(sx), Math.abs(sy)); sx = m * (sx < 0 ? -1 : 1); sy = m * (sy < 0 ? -1 : 1); }
      sx = clampAbs(sx, .02); sy = clampAbs(sy, .02);
      return q => ({ x: ax + (q.x - ax) * sx, y: ay + (q.y - ay) * sy });
    };
  }
  function selectDown(p, e) {
    const k = screenK();
    const so = getObj();
    if (so) {
      const bb = bboxOfContours(so.contours);
      if (bb) {
        const h = hitHandle(p, bb, k);
        if (h) {
          const st = stateRef.current;
          if (st.selMode === 'scale') startTransform(so, makeScaleFn(bb, h, p));
          else if (h.length === 2) {
            if (e.altKey) {
              const corners = [{ x: bb.x, y: bb.y2 }, { x: bb.x2, y: bb.y2 }, { x: bb.x2, y: bb.y }, { x: bb.x, y: bb.y }];
              const idx = { nw: 0, ne: 1, se: 2, sw: 3 }[h];
              startTransform(so, pp => {
                const cs = corners.slice(); cs[idx] = { x: pp.x, y: pp.y };
                return q => {
                  const u = (q.x - bb.x) / bb.w, v = (q.y - bb.y) / bb.h;
                  return {
                    x: (1-u)*v*cs[0].x + u*v*cs[1].x + u*(1-v)*cs[2].x + (1-u)*(1-v)*cs[3].x,
                    y: (1-u)*v*cs[0].y + u*v*cs[1].y + u*(1-v)*cs[2].y + (1-u)*(1-v)*cs[3].y
                  };
                };
              });
            } else {
              const c = { x: bb.cx, y: bb.cy }, a0 = Math.atan2(p.y - c.y, p.x - c.x);
              startTransform(so, (pp, ev) => {
                let d = Math.atan2(pp.y - c.y, pp.x - c.x) - a0;
                if (ev.shiftKey) d = Math.round(d / (Math.PI / 12)) * (Math.PI / 12);
                const M = around(c, mR(d));
                return q => mApply(M, q);
              });
            }
          } else {
            const c = { x: bb.cx, y: bb.cy };
            const horiz = h === 'n' || h === 's';
            startTransform(so, pp => {
              let kx = 0, ky = 0;
              if (horiz) kx = Math.max(-2.5, Math.min(2.5, (pp.x - p.x) / (bb.h / 2)));
              else ky = Math.max(-2.5, Math.min(2.5, (pp.y - p.y) / (bb.w / 2)));
              const M = around(c, [1, ky, kx, 1, 0, 0]);
              return q => mApply(M, q);
            });
          }
          return;
        }
      }
    }
    const hit = hitObject(p, k);
    if (hit) {
      const wasSel = stateRef.current.sel === hit.id;
      if (!wasSel) { setSel(hit.id); setSelMode('scale'); setSelNode(null); }
      gestureRef.current = { type: 'moveOrToggle', snap: snap(), objId: hit.id, start: p, moved: false, map: null, toggle: wasSel,
        upd(pp) {
          if (dist(pp, this.start) > 3 * k) this.moved = true;
          if (this.moved) { const dx = pp.x - this.start.x, dy = pp.y - this.start.y; this.map = q => ({ x: q.x + dx, y: q.y + dy }); }
        } };
      rerender();
    } else { setSel(null); setSelNode(null); rerender(); }
  }
  function selectedNodeBounds(o, refs) {
    const pts = [];
    for (const q of refs || []) {
      const n = o.contours[q.ci]?.nodes[q.ni];
      if (!n) continue;
      pts.push({x:n.x,y:n.y});
      if (n.hIn) pts.push(n.hIn);
      if (n.hOut) pts.push(n.hOut);
    }
    if (!pts.length) return null;
    const xs=pts.map(p=>p.x), ys=pts.map(p=>p.y);
    const x=Math.min(...xs), x2=Math.max(...xs), y=Math.min(...ys), y2=Math.max(...ys);
    return {x,x2,y,y2,w:Math.max(.001,x2-x),h:Math.max(.001,y2-y),cx:(x+x2)/2,cy:(y+y2)/2};
  }
  function nodeGroupBoxDown(p, e, o) {
    const st=stateRef.current, refs=(st.selectedNodes||[]).filter(q=>o.contours[q.ci]?.nodes[q.ni]);
    if (refs.length<2) return false;
    const bb=selectedNodeBounds(o,refs);
    if (!bb) return false;
    const k=screenK(), tol=22*k, rotate={x:bb.cx,y:bb.y2+28*k};
    // Прямое редактирование узлов и ручек всегда важнее рамки.
    if (hitNode(o,p,9*k)) return false;
    const active=st.selNode && o.contours[st.selNode.ci]?.nodes[st.selNode.ni];
    if (active && (active.hIn && dist(p,active.hIn)<16*k || active.hOut && dist(p,active.hOut)<16*k)) return false;
    const handles=[['nw',bb.x,bb.y2],['n',bb.cx,bb.y2],['ne',bb.x2,bb.y2],['e',bb.x2,bb.cy],['se',bb.x2,bb.y],['s',bb.cx,bb.y],['sw',bb.x,bb.y],['w',bb.x,bb.cy]];
    let mode=null, anchor=null;
    // Увеличенные невидимые зоны касания: удобно на телефоне, сами маркеры не растут.
    if (dist(p,rotate)<tol*1.15) mode='rotate';
    if (!mode) {
      let nearest=null, nearestD=tol;
      for (const item of handles) {
        const d=dist(p,{x:item[1],y:item[2]});
        if (d<nearestD) { nearest=item; nearestD=d; }
      }
      if (nearest) {
        const name=nearest[0];
        mode='scale';
        anchor={x:name.includes('w')?bb.x2:name.includes('e')?bb.x:bb.cx,y:name.includes('n')?bb.y:name.includes('s')?bb.y2:bb.cy};
      }
    }
    if (!mode && p.x>=bb.x-tol && p.x<=bb.x2+tol && p.y>=bb.y-tol && p.y<=bb.y2+tol) mode='move';
    if (!mode) return false;
    const source=refs.map(q=>({ci:q.ci,ni:q.ni,node:clone(o.contours[q.ci].nodes[q.ni])}));
    const start={x:p.x,y:p.y}, startAngle=Math.atan2(p.y-bb.cy,p.x-bb.cx);
    gestureRef.current={type:'nodeGroupTransform',snap:snap(),objId:o.id,source,transformed:[],moved:false,
      upd(pp) {
        let fn;
        if(mode==='move') { const dx=pp.x-start.x,dy=pp.y-start.y; fn=q=>({x:q.x+dx,y:q.y+dy}); this.moved=Math.hypot(dx,dy)>.5; }
        else if(mode==='rotate') { const a=Math.atan2(pp.y-bb.cy,pp.x-bb.cx)-startAngle,cs=Math.cos(a),sn=Math.sin(a); fn=q=>{const dx=q.x-bb.cx,dy=q.y-bb.cy;return{x:bb.cx+dx*cs-dy*sn,y:bb.cy+dx*sn+dy*cs};}; this.moved=Math.abs(a)>.002; }
        else {
          const sx=Math.max(.02,Math.min(50,(pp.x-anchor.x)/(start.x-anchor.x||.001)));
          const sy=Math.max(.02,Math.min(50,(pp.y-anchor.y)/(start.y-anchor.y||.001)));
          const useX=Math.abs(start.x-anchor.x)>tol*.1, useY=Math.abs(start.y-anchor.y)>tol*.1;
          const ax=useX?sx:1, ay=useY?sy:1;
          fn=q=>({x:anchor.x+(q.x-anchor.x)*ax,y:anchor.y+(q.y-anchor.y)*ay});
          this.moved=Math.abs(ax-1)>.002||Math.abs(ay-1)>.002;
        }
        this.transformed=this.source.map(item=>{const mapPoint=q=>q?(()=>{const z=fn(q);return{x:F(z.x),y:F(z.y)};})():null;const n=item.node;return{ci:item.ci,ni:item.ni,node:{...n,...mapPoint(n),hIn:mapPoint(n.hIn),hOut:mapPoint(n.hOut)}};});
      }
    };
    return true;
  }
  function nodeDown(p, e, dbl) {
    const k = screenK();
    const so = getObj();
    if (so && nodeGroupBoxDown(p,e,so)) { rerender(); return; }
    if (so) {
      const st = stateRef.current;
      if (st.selNode && so.contours[st.selNode.ci] && so.contours[st.selNode.ci].nodes[st.selNode.ni]) {
        const sn = so.contours[st.selNode.ci].nodes[st.selNode.ni];
        let handleHit = null;
        // Увеличенная зона захвата ручек удобнее для пальца на сенсорном экране.
        for (const w of ['hIn', 'hOut']) if (!handleHit && sn[w] && dist(p, sn[w]) < 16 * k) handleHit = w;
        if (handleHit) {
          gestureRef.current = { type: 'handle', snap: snap(), objId: so.id, ci: st.selNode.ci, ni: st.selNode.ni, which: handleHit, pos: null, alt: false, moved: false,
            upd(pp, ev) { this.pos = pp; this.alt = ev.altKey; this.moved = true; } };
          return;
        }
      }
      const nh = hitNode(so, p, 9 * k);
      if (nh) {
        if (dbl && st.selNode && st.selNode.ci === nh.ci && st.selNode.ni === nh.ni) {
          commit(list => {
            const ob = list.find(x => x.id === so.id);
            const ns = ob.contours[nh.ci].nodes, n = ns[nh.ni], len = ns.length;
            n.smooth = !n.smooth;
            if (n.smooth) {
              const prev = ns[(nh.ni - 1 + len) % len], next = ns[(nh.ni + 1) % len];
              const tx = (next.x - prev.x) / 5, ty = (next.y - prev.y) / 5;
              n.hOut = { x: F(n.x + tx), y: F(n.y + ty) };
              n.hIn = { x: F(n.x - tx), y: F(n.y - ty) };
            }
            return list;
          });
          return;
        }
        const multiMode = e.shiftKey || st.nodeMultiSelect;
        let chosen = (st.selectedNodes || []).map(q => ({ ci: q.ci, ni: q.ni }));
        if (multiMode) {
          const exists = chosen.some(q => q.ci === nh.ci && q.ni === nh.ni);
          chosen = exists ? chosen.filter(q => q.ci !== nh.ci || q.ni !== nh.ni) : chosen.concat([nh]);
          setSelectedNodes(chosen);
          // Если сняли выделение с активного узла, переключаем активность
          // на последний оставшийся узел группы, а не оставляем «чужую» точку.
          const nextActive = exists
            ? (chosen[chosen.length - 1] || null)
            : nh;
          setSelNode(nextActive);
          rerender();
          return;
        }
        if (!chosen.some(q => q.ci === nh.ci && q.ni === nh.ni)) chosen = [nh];
        setSelectedNodes(chosen);
        setSelNode(nh);
        gestureRef.current = { type: 'node', snap: snap(), objId: so.id, nodes: chosen, start: p, delta: { x: 0, y: 0 }, moved: false,
          upd(pp) { this.delta = { x: pp.x - this.start.x, y: pp.y - this.start.y }; this.moved = Math.hypot(this.delta.x, this.delta.y) > .5; } };
        rerender();
        return;
      }
      const sh = hitSegment(so, p, 7 * k);
      if (sh) {
        if (sh.t < .1 || sh.t > .9) {
          const len = so.contours[sh.ci].nodes.length;
          setSelNode({ ci: sh.ci, ni: (sh.seg + (sh.t > .5 ? 1 : 0)) % len });
          rerender();
          return;
        }
        let inserted = null;
        commit(list => {
          const ob = list.find(x => x.id === so.id);
          inserted = insertNodeAt(ob, sh);
          return list;
        });
        setSelNode(inserted);
        gestureRef.current = { type: 'node', snap: snap(), objId: so.id, ci: inserted.ci, ni: inserted.ni, start: p, delta: { x: 0, y: 0 }, moved: false,
          upd(pp) { this.delta = { x: pp.x - this.start.x, y: pp.y - this.start.y }; this.moved = Math.hypot(this.delta.x, this.delta.y) > .5; } };
        return;
      }
    }
    const hit = hitObject(p, k);
    if (hit) { setSel(hit.id); setSelNode(null); rerender(); }
  }

  /* ===== Перо / кисть / ластик ===== */
  function finishPen() {
    const pen = penRef.current;
    if (pen.nodes.length >= 3) {
      const nodes = pen.nodes;
      commit(list => {
        const target = list.find(o => o.id === stateRef.current.sel);
        if (target) target.contours.push({ nodes });
        else { const no = { id: uid(), contours: [{ nodes }] }; list.push(no); setSel(no.id); }
        return list;
      });
    }
    pen.nodes = []; pen.dragging = false; pen.dragNode = null;
    rerender();
  }
  function penDown(p, dbl) {
    const k = screenK();
    const pen = penRef.current;
    if (dbl) { finishPen(); return; }
    if (pen.nodes.length >= 3 && dist(p, pen.nodes[0]) < 12 * k) { finishPen(); return; }
    const n = { x: F(p.x), y: F(p.y), hIn: null, hOut: null, smooth: false };
    pen.nodes.push(n); pen.dragging = true; pen.dragNode = n;
    rerender();
  }
  function endBrush() {
    const pts = brushRef.current;
    brushRef.current = null;
    if (pts && pts.length > 1) {
      const contours = strokeToContours(pts, stateRef.current.brushWidth / 2);
      commit(list => {
        const cs = contours.map(c => ({ nodes: c.map(p => ({ x: F(p.x), y: F(p.y), hIn: null, hOut: null, smooth: false })) }));
        const target = list.find(o => o.id === stateRef.current.sel);
        if (target) target.contours.push(...cs);
        else { const no = { id: uid(), contours: cs }; list.push(no); setSel(no.id); }
        return list;
      });
    }
    rerender();
  }
  function eraseAt(p) {
    const r2 = stateRef.current.eraserR ** 2;
    let changed = false;
    const list = stateRef.current.objects;
    for (let oi = list.length - 1; oi >= 0; oi--) {
      const o = list[oi], keep = [];
      let touched = false;
      for (const c of o.contours) {
        const pts = flattenContour(c, 5);
        if (pts.length < 3) { keep.push(c); continue; }
        const inside = pts.map(q => (q.x - p.x) ** 2 + (q.y - p.y) ** 2 < r2);
        const any = inside.some(Boolean);
        if (!any) { keep.push(c); continue; }
        touched = true;
        if (inside.every(Boolean)) continue;
        const start = inside.indexOf(true);
        let run = [];
        for (let j = 1; j <= pts.length; j++) {
          const idx = (start + j) % pts.length;
          if (!inside[idx]) run.push({ x: pts[idx].x, y: pts[idx].y });
          if (inside[idx] || j === pts.length) {
            if (run.length >= 3) {
              const nodes = smoothNodes(run, .5);
              nodes[0].hIn = null; nodes[0].smooth = false;
              nodes[nodes.length - 1].hOut = null; nodes[nodes.length - 1].smooth = false;
              const cc = { nodes };
              if (Math.abs(areaStd(flattenContour(cc, 8))) > 40) keep.push(cc);
            }
            run = [];
          }
        }
      }
      if (touched) {
        changed = true;
        o.contours = keep;
        if (!keep.length) { list.splice(oi, 1); if (stateRef.current.sel === o.id) { setSel(null); setSelNode(null); } }
      }
    }
    return changed;
  }

  /* ===== События указателя ===== */
  const onPointerDown = e => {
    if (importOpenRef.current) return;
    e.preventDefault();
    const raw = posFromEvent(e);
    if (activePointerId.current !== null) {
      const currentGesture = gestureRef.current;
      const stNow = stateRef.current;
      const refs = (stNow.selectedNodes || []).filter(q => Number.isInteger(q.ci) && Number.isInteger(q.ni));
      const so = getObj();
      if (stNow.tool === 'node' && currentGesture?.type === 'node' && refs.length >= 2 && so && so.id === currentGesture.objId && pointersRef.current.size === 1) {
        e.currentTarget.setPointerCapture(e.pointerId);
        pointersRef.current.set(e.pointerId, raw);
        const firstId = pointersRef.current.keys().next().value;
        const first = pointersRef.current.get(firstId);
        const initialCenter = { x: (first.x + raw.x) / 2, y: (first.y + raw.y) / 2 };
        const initialDistance = Math.max(0.001, dist(first, raw));
        const initialAngle = Math.atan2(raw.y - first.y, raw.x - first.x);
        const source = refs.map(q => {
          const node = so.contours[q.ci]?.nodes[q.ni];
          return node ? { ci: q.ci, ni: q.ni, node: clone(node) } : null;
        }).filter(Boolean);
        if (source.length >= 2) {
          gestureRef.current = {
            type: 'nodeTransform', snap: currentGesture.snap, objId: so.id, refs,
            initialCenter, initialDistance, initialAngle, source, transformed: [], moved: false,
            updTransform() {
              const pts = Array.from(pointersRef.current.values());
              if (pts.length < 2) return;
              const center = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
              const scale = Math.max(0.02, Math.min(50, dist(pts[0], pts[1]) / this.initialDistance));
              const angle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) - this.initialAngle;
              const cs = Math.cos(angle), sn = Math.sin(angle);
              this.transformed = this.source.map(item => {
                const transformPoint = p => {
                  if (!p) return null;
                  const dx = (p.x - this.initialCenter.x) * scale;
                  const dy = (p.y - this.initialCenter.y) * scale;
                  return { x: F(center.x + dx * cs - dy * sn), y: F(center.y + dx * sn + dy * cs) };
                };
                const node = item.node;
                return { ci: item.ci, ni: item.ni, node: {
                  ...node, ...transformPoint(node),
                  hIn: transformPoint(node.hIn), hOut: transformPoint(node.hOut)
                } };
              });
              this.moved = true;
            }
          };
          gestureRef.current.updTransform();
          rerender();
        }
      }
      return;
    }
    activePointerId.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointersRef.current.clear();
    pointersRef.current.set(e.pointerId, raw);
    const st = stateRef.current;
    const p = st.snapToGrid ? { x: Math.round(raw.x / 100) * 100, y: Math.round(raw.y / 100) * 100 } : raw;
    const now = performance.now();
    const lt = lastTapRef.current;
    const dbl = now - lt.t < 350 && Math.hypot(p.x - lt.x, p.y - lt.y) < 14 * screenK();
    lastTapRef.current = { t: now, x: p.x, y: p.y };
    if (st.tool === 'hand' || spaceRef.current || e.button === 1) {
      const rect = canvasRef.current.getBoundingClientRect();
      gestureRef.current = { type: 'pan', v0: { ...st.view }, sx: e.clientX, sy: e.clientY, rectH: rect.height,
        upd(pp, ev) {
          const scale = this.rectH / (this.v0.yMax - this.v0.yMin);
          setView({ ...this.v0, xMin: this.v0.xMin - (ev.clientX - this.sx) / scale, yMin: this.v0.yMin + (ev.clientY - this.sy) / scale, xMax: this.v0.xMax - (ev.clientX - this.sx) / scale, yMax: this.v0.yMax + (ev.clientY - this.sy) / scale });
        } };
      return;
    }
    if (e.button === 2) return;
    if (['line','rect','ellipse','polygon'].includes(st.tool)) {
      gestureRef.current = { type: 'shape', tool: st.tool, snap: snap(), start: p, end: p, preview: null,
        upd(pp) { this.end = pp; this.preview = createShapeObject(this.tool, this.start, this.end, stateRef.current.brushWidth, stateRef.current.polygonSides); } };
      rerender();
    }
    else if (st.tool === 'brush') { brushRef.current = [p]; rerender(); }
    else if (st.tool === 'eraser') {
      gestureRef.current = { type: 'erase', snap: snap(), last: p, changed: false,
        upd(pp) {
          const d = dist(pp, this.last), steps = Math.max(1, Math.ceil(d / (stateRef.current.eraserR * .4)));
          for (let i = 1; i <= steps; i++) {
            if (eraseAt({ x: this.last.x + (pp.x - this.last.x) * i / steps, y: this.last.y + (pp.y - this.last.y) * i / steps })) this.changed = true;
          }
          this.last = pp;
        } };
      if (eraseAt(p)) gestureRef.current.changed = true;
      rerender();
    }
    else if (st.tool === 'pen') penDown(p, dbl);
    else if (st.tool === 'select') selectDown(p, e);
    else if (st.tool === 'node') nodeDown(p, e, dbl);
  };
  const onPointerMove = e => {
    if (importOpenRef.current) return;
    if (pointersRef.current.has(e.pointerId)) {
      const rawPointer = posFromEvent(e);
      pointersRef.current.set(e.pointerId, rawPointer);
      const multiGesture = gestureRef.current;
      if (multiGesture?.type === 'nodeTransform') {
        e.preventDefault();
        multiGesture.updTransform();
        rerender();
        return;
      }
      if (activePointerId.current !== e.pointerId) return;
    } else if (activePointerId.current !== e.pointerId) return;
    const raw = posFromEvent(e);
    const st = stateRef.current;
    const p = st.snapToGrid ? { x: Math.round(raw.x / 100) * 100, y: Math.round(raw.y / 100) * 100 } : raw;
    if (st.tool === 'eraser') eraserPosRef.current = p;
    const g = gestureRef.current;
    if (g) { e.preventDefault(); g.upd(p, e); rerender(); return; }
    if (brushRef.current) {
      e.preventDefault();
      const pts = brushRef.current, last = pts[pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) > 3) pts.push(p);
      rerender();
      return;
    }
    if (st.tool === 'pen') {
      const pen = penRef.current;
      if (pen.dragging && pen.dragNode) {
        const n = pen.dragNode;
        if (Math.hypot(p.x - n.x, p.y - n.y) > 3) {
          n.hOut = { x: F(p.x), y: F(p.y) };
          n.hIn = { x: F(2 * n.x - p.x), y: F(2 * n.y - p.y) };
          n.smooth = true;
        }
      } else pen.cursor = p;
    }
    rerender();
  };
  const onPointerUp = e => {
    const multiGesture = gestureRef.current;
    if (multiGesture?.type === 'nodeTransform' && pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, posFromEvent(e));
      if (pointersRef.current.size >= 2) multiGesture.updTransform();
      pointersRef.current.delete(e.pointerId);
      if (pointersRef.current.size > 0) { rerender(); return; }
      gestureRef.current = null;
      activePointerId.current = null;
      bakeGesture(multiGesture);
      setMessage('Группа узлов масштабирована и повёрнута двумя пальцами.');
      rerender();
      return;
    }
    if (activePointerId.current !== e.pointerId) return;
    // Учитываем последнюю координату pointerup: палец может сдвинуться
    // между последним pointermove и отпусканием.
    const rawEnd = posFromEvent(e);
    const endState = stateRef.current;
    const endPoint = endState.snapToGrid
      ? { x: Math.round(rawEnd.x / 100) * 100, y: Math.round(rawEnd.y / 100) * 100 }
      : rawEnd;
    const g = gestureRef.current;
    if (g && typeof g.upd === 'function') g.upd(endPoint, e);
    if (brushRef.current) {
      const pts = brushRef.current;
      const last = pts[pts.length - 1];
      if (!last || dist(last, endPoint) > 1) pts.push(endPoint);
    }
    activePointerId.current = null;
    pointersRef.current.delete(e.pointerId);
    gestureRef.current = null;
    if (g) {
      if (g.type === 'shape') {
        if (g.preview) {
          pushHistory(g.snap);
          const next = [...stateRef.current.objects, g.preview];
          setObjects(next); setSel(g.preview.id); setSelNode(null);
          setMessage('Фигура добавлена. Её можно перемещать, масштабировать и редактировать по узлам.');
        }
      }
      else if (g.type === 'erase') { if (g.changed) { pushHistory(g.snap); setObjects(clone(stateRef.current.objects)); setMessage('Ластик применён.'); } }
      else if (g.type === 'moveOrToggle') {
        if (g.moved && g.map) bakeGesture({ ...g, type: 'transform' });
        else if (g.toggle) setSelMode(m => m === 'scale' ? 'rotate' : 'scale');
      }
      else if (g.type !== 'pan') bakeGesture(g);
    }
    if (brushRef.current) endBrush();
    const pen = penRef.current;
    if (pen.dragging) { pen.dragging = false; pen.dragNode = null; }
    rerender();
  };
  const onWheel = e => {
    e.preventDefault();
    const p = posFromEvent(e);
    const v = stateRef.current.view;
    const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    const span = (v.yMax - v.yMin) * factor;
    if (span < 150 || span > 6000) return;
    const f = span / (v.yMax - v.yMin);
    setView({
      xMin: p.x - (p.x - v.xMin) * f, xMax: p.x + (v.xMax - p.x) * f,
      yMin: p.y - (p.y - v.yMin) * f, yMax: p.y + (v.yMax - p.y) * f
    });
  };

  /* ===== Действия панели свойств ===== */
  const transformSel = fn => {
    const so = getObj();
    if (!so) return;
    commit(list => {
      const ob = list.find(x => x.id === so.id);
      ob.contours = mapContours(ob.contours, fn);
      return list;
    });
  };
  const selBBox = () => { const so = getObj(); return so ? bboxOfContours(so.contours) : null; };
  const duplicateSel = () => {
    const so = getObj();
    if (!so) return;
    commit(list => {
      const cp = clone(so);
      cp.id = uid();
      cp.contours = mapContours(cp.contours, q => ({ x: q.x + 40, y: q.y - 40 }));
      list.push(cp);
      setSel(cp.id);
      return list;
    });
  };
  const deleteSel = () => {
    const so = getObj();
    if (!so) return;
    commit(list => {
      const i = list.findIndex(x => x.id === so.id);
      if (i >= 0) list.splice(i, 1);
      setSel(null); setSelNode(null);
      return list;
    });
  };
  const flipSel = horiz => {
    const bb = selBBox();
    if (!bb) return;
    transformSel(q => horiz ? { x: 2 * bb.cx - q.x, y: q.y } : { x: q.x, y: 2 * bb.cy - q.y });
  };
  const orderSel = front => {
    const so = getObj();
    if (!so) return;
    commit(list => {
      const i = list.findIndex(x => x.id === so.id);
      list.splice(i, 1);
      if (front) list.push(so); else list.unshift(so);
      return list;
    });
  };
  const rotateSel = deg => {
    const bb = selBBox();
    if (!bb || !deg) return;
    const M = around({ x: bb.cx, y: bb.cy }, mR(deg * Math.PI / 180));
    transformSel(q => mApply(M, q));
  };
  const alignBaseline = () => {
    const bb = selBBox();
    if (!bb) return;
    const dy = -bb.y;
    transformSel(q => ({ x: q.x, y: q.y + dy }));
    setMessage('Низ объекта поставлен на базовую линию.');
  };
  const centerGlyph = () => {
    const bb = selBBox();
    if (!bb) return;
    const dx = 450 - bb.cx;
    transformSel(q => ({ x: q.x + dx, y: q.y }));
  };
  const fitHeight = target => {
    const bb = selBBox();
    if (!bb) return;
    const s = target / bb.h;
    transformSel(q => ({ x: bb.x + (q.x - bb.x) * s, y: bb.y + (q.y - bb.y) * s }));
    setMessage(`Высота подогнана под ${target} единиц.`);
  };
  const roundSelectedCorner = () => {
    const so = getObj();
    const st = stateRef.current;
    if (!so || !st.selNode) return;
    const { ci, ni } = st.selNode;
    const contour = so.contours[ci];
    const nodes = contour?.nodes || [];
    const count = nodes.length;
    if (count < 3 || ni < 0 || ni >= count) return;
    const prev = nodes[(ni - 1 + count) % count];
    const corner = nodes[ni];
    const next = nodes[(ni + 1) % count];
    if (prev.hOut || corner.hIn || corner.hOut || next.hIn) {
      setMessage('Для точного скругления выберите острый угол на прямых сегментах без кривых.');
      return;
    }
    const requested = Math.max(0, Number(cornerRadius) || 0);
    const incoming = dist(prev, corner), outgoing = dist(corner, next);
    const radius = Math.min(requested, incoming * 0.45, outgoing * 0.45);
    if (radius < 0.5) {
      setMessage('Радиус слишком мал или рядом недостаточно места.');
      return;
    }
    const tIn = { x: F(corner.x + (prev.x - corner.x) * radius / incoming), y: F(corner.y + (prev.y - corner.y) * radius / incoming) };
    const tOut = { x: F(corner.x + (next.x - corner.x) * radius / outgoing), y: F(corner.y + (next.y - corner.y) * radius / outgoing) };
    const c1 = { x: F(tIn.x + (corner.x - tIn.x) * 2 / 3), y: F(tIn.y + (corner.y - tIn.y) * 2 / 3) };
    const c2 = { x: F(tOut.x + (corner.x - tOut.x) * 2 / 3), y: F(tOut.y + (corner.y - tOut.y) * 2 / 3) };
    commit(list => {
      const ob = list.find(x => x.id === so.id);
      const ns = ob?.contours[ci]?.nodes;
      if (!ns || !ns[ni]) return list;
      const a = ns[(ni - 1 + ns.length) % ns.length];
      a.hOut = { ...c1 };
      const first = { x: tIn.x, y: tIn.y, smooth: false, hIn: null, hOut: null };
      const second = { x: tOut.x, y: tOut.y, smooth: false, hIn: { ...c2 }, hOut: null };
      ns.splice(ni, 1, first, second);
      return list;
    });
    setSelNode({ ci, ni: ni + 1 });
    setSelectedNodes([]);
    setMessage('Угол скруглён. Радиус ограничен свободным местом рядом с вершиной.');
  };

  const addNodeAfter = () => {
    const so = getObj();
    const st = stateRef.current;
    if (!so || !st.selNode) return;
    let inserted = null;
    commit(list => {
      const ob = list.find(x => x.id === so.id);
      inserted = insertNodeAt(ob, { ci: st.selNode.ci, seg: st.selNode.ni, t: .5 });
      return list;
    });
    setSelNode(inserted);
  };
  const deleteNode = () => {
    const so = getObj();
    const st = stateRef.current;
    if (!so || !st.selNode) return;
    commit(list => {
      const ob = list.find(x => x.id === so.id);
      const c = ob.contours[st.selNode.ci];
      if (!c) return list;
      c.nodes.splice(st.selNode.ni, 1);
      if (c.nodes.length < 3) ob.contours.splice(st.selNode.ci, 1);
      if (!ob.contours.length) { const i = list.findIndex(x => x.id === ob.id); list.splice(i, 1); setSel(null); }
      setSelNode(null);
      return list;
    });
  };
  const deleteSelectedNodes = () => {
    const so = getObj();
    const st = stateRef.current;
    const refs = (st.selectedNodes || []).filter(p =>
      Number.isInteger(p.ci) && Number.isInteger(p.ni)
    );
    if (!so || !refs.length) return;
    commit(list => {
      const ob = list.find(x => x.id === so.id);
      if (!ob) return list;
      const byContour = new Map();
      for (const p of refs) {
        if (!byContour.has(p.ci)) byContour.set(p.ci, new Set());
        byContour.get(p.ci).add(p.ni);
      }
      // Удаляем с конца, чтобы индексы оставшихся узлов не смещались.
      for (const [ci, indices] of [...byContour.entries()].sort((a, b) => b[0] - a[0])) {
        const contour = ob.contours[ci];
        if (!contour) continue;
        for (const ni of [...indices].sort((a, b) => b - a)) {
          if (ni >= 0 && ni < contour.nodes.length) contour.nodes.splice(ni, 1);
        }
        if (contour.nodes.length < 3) ob.contours.splice(ci, 1);
      }
      if (!ob.contours.length) {
        const index = list.findIndex(x => x.id === ob.id);
        if (index >= 0) list.splice(index, 1);
        setSel(null);
      }
      setSelectedNodes([]);
      setSelNode(null);
      return list;
    });
    setMessage('Выделенные узлы удалены.');
  };
  const setSelectedNodeCoord = (axis, value) => {
    const st = stateRef.current;
    const so = getObj();
    if (String(value).trim() === '') return;
    const v = Number(value);
    if (!so || !st.selNode || !Number.isFinite(v)) return;
    commit(list => {
      const ob = list.find(x => x.id === so.id);
      const n = ob && ob.contours[st.selNode.ci]?.nodes[st.selNode.ni];
      if (!n) return list;
      const delta = v - n[axis];
      n[axis] = F(v);
      for (const h of ['hIn', 'hOut']) if (n[h]) n[h][axis] = F(n[h][axis] + delta);
      return list;
    });
  };
  const toggleSmoothSel = () => {
    const so = getObj();
    const st = stateRef.current;
    if (!so || !st.selNode) return;
    commit(list => {
      const ob = list.find(x => x.id === so.id);
      const ns = ob.contours[st.selNode.ci].nodes, n = ns[st.selNode.ni], len = ns.length;
      n.smooth = !n.smooth;
      if (n.smooth) {
        const prev = ns[(st.selNode.ni - 1 + len) % len], next = ns[(st.selNode.ni + 1) % len];
        const tx = (next.x - prev.x) / 5, ty = (next.y - prev.y) / 5;
        n.hOut = { x: F(n.x + tx), y: F(n.y + ty) };
        n.hIn = { x: F(n.x - tx), y: F(n.y - ty) };
      }
      return list;
    });
  };
  const setSelectedNodesSmooth = mode => {
    const so=getObj(), st=stateRef.current;
    if (!so) return;
    const refs=(st.selectedNodes||[]).length ? st.selectedNodes : st.selNode ? [st.selNode] : [];
    if (!refs.length) return;
    commit(list => {
      const ob=list.find(x=>x.id===so.id);
      if (!ob) return list;
      const targets=new Map();
      for (const ref of refs) {
        if (!ob.contours[ref.ci]?.nodes[ref.ni]) continue;
        if (!targets.has(ref.ci)) targets.set(ref.ci,new Set());
        targets.get(ref.ci).add(ref.ni);
      }
      // Авто: обрабатываем весь контур, но сохраняем выраженные углы.
      if (mode==='auto') for (const ci of targets.keys()) {
        const ns=ob.contours[ci]?.nodes||[];
        targets.set(ci,new Set(ns.map((_,i)=>i)));
      }
      for (const [ci,indices] of targets) {
        const ns=ob.contours[ci]?.nodes||[], len=ns.length;
        if (len<3) continue;
        for (const ni of indices) {
          const n=ns[ni], prev=ns[(ni-1+len)%len], next=ns[(ni+1)%len];
          if (!n || !prev || !next) continue;
          if (mode==='sharp') { n.smooth=false; n.hIn=null; n.hOut=null; continue; }
          const ax=prev.x-n.x, ay=prev.y-n.y, bx=next.x-n.x, by=next.y-n.y;
          const la=Math.hypot(ax,ay)||1, lb=Math.hypot(bx,by)||1;
          const cosine=(ax*bx+ay*by)/(la*lb);
          if (mode==='auto' && cosine>-0.35) {
            n.smooth=false; n.hIn=null; n.hOut=null; continue;
          }
          const dx=next.x-prev.x, dy=next.y-prev.y, tangent=Math.hypot(dx,dy)||1;
          const factor=mode==='soft'?.12:mode==='curve'?.34:.22;
          const handle=Math.min(la,lb)*factor, ux=dx/tangent, uy=dy/tangent;
          n.smooth=true;
          n.hIn={x:F(n.x-ux*handle),y:F(n.y-uy*handle)};
          n.hOut={x:F(n.x+ux*handle),y:F(n.y+uy*handle)};
        }
      }
      return list;
    });
  };
  const makeNodeSymmetric = () => {
    const so = getObj();
    const st = stateRef.current;
    if (!so || !st.selNode) return;
    commit(list => {
      const ob = list.find(x => x.id === so.id);
      const contour = ob?.contours[st.selNode.ci];
      const n = contour?.nodes[st.selNode.ni];
      if (!n || contour.nodes.length < 2) return list;
      const prev = contour.nodes[(st.selNode.ni - 1 + contour.nodes.length) % contour.nodes.length];
      const next = contour.nodes[(st.selNode.ni + 1) % contour.nodes.length];
      let dx = 0, dy = 0, len = 0;
      if (n.hOut && Math.hypot(n.hOut.x - n.x, n.hOut.y - n.y) > 0.001) {
        dx = n.hOut.x - n.x; dy = n.hOut.y - n.y;
        len = Math.hypot(dx, dy);
      } else if (n.hIn && Math.hypot(n.hIn.x - n.x, n.hIn.y - n.y) > 0.001) {
        dx = n.x - n.hIn.x; dy = n.y - n.hIn.y;
        len = Math.hypot(dx, dy);
      } else {
        dx = next.x - prev.x; dy = next.y - prev.y;
        len = Math.hypot(dx, dy) / 5;
      }
      const mag = Math.hypot(dx, dy);
      if (mag < 0.001 || len < 0.001) return list;
      const ux = dx / mag, uy = dy / mag;
      n.hOut = { x: F(n.x + ux * len), y: F(n.y + uy * len) };
      n.hIn = { x: F(n.x - ux * len), y: F(n.y - uy * len) };
      n.smooth = true;
      return list;
    });
    setMessage('Ручки узла выровнены по одной касательной и сделаны симметричными.');
  };
  const centerNodeBetweenNeighbors = () => {
    const so = getObj();
    const st = stateRef.current;
    if (!so || !st.selNode) return;
    commit(list => {
      const ob = list.find(x => x.id === so.id);
      const contour = ob?.contours[st.selNode.ci];
      const nodes = contour?.nodes;
      const n = nodes?.[st.selNode.ni];
      if (!n || nodes.length < 3) return list;
      const prev = nodes[(st.selNode.ni - 1 + nodes.length) % nodes.length];
      const next = nodes[(st.selNode.ni + 1) % nodes.length];
      const x = (prev.x + next.x) / 2, y = (prev.y + next.y) / 2;
      const dx = x - n.x, dy = y - n.y;
      n.x = F(x); n.y = F(y);
      for (const h of ['hIn', 'hOut']) if (n[h]) {
        n[h].x = F(n[h].x + dx); n[h].y = F(n[h].y + dy);
      }
      return list;
    });
    setMessage('Узел помещён ровно посередине между соседними узлами.');
  };
  const alignNodeAxisToPrevious = axis => {
    const so = getObj();
    const st = stateRef.current;
    if (!so || !st.selNode) return;
    commit(list => {
      const ob = list.find(x => x.id === so.id);
      const nodes = ob?.contours[st.selNode.ci]?.nodes;
      const n = nodes?.[st.selNode.ni];
      if (!n || nodes.length < 2) return list;
      const prev = nodes[(st.selNode.ni - 1 + nodes.length) % nodes.length];
      const delta = prev[axis] - n[axis];
      n[axis] = F(prev[axis]);
      for (const h of ['hIn', 'hOut']) if (n[h]) n[h][axis] = F(n[h][axis] + delta);
      return list;
    });
    setMessage(axis === 'x'
      ? 'Узел выровнен по горизонтали с предыдущим; ручки сохранены.'
      : 'Узел выровнен по вертикали с предыдущим; ручки сохранены.');
  };
  const alignSelectedNodes = axis => {
    const st = stateRef.current;
    const so = getObj();
    const refs = (st.selectedNodes || []).filter(p => Number.isInteger(p.ci) && Number.isInteger(p.ni));
    if (!so || refs.length < 2) return;
    commit(list => {
      const ob = list.find(x => x.id === so.id);
      const points = refs.map(p => ({ ref: p, node: ob?.contours[p.ci]?.nodes[p.ni] })).filter(p => p.node);
      if (points.length < 2) return list;
      const target = points.reduce((sum, p) => sum + p.node[axis], 0) / points.length;
      for (const { node } of points) {
        const delta = target - node[axis];
        node[axis] = F(target);
        for (const h of ['hIn', 'hOut']) if (node[h]) node[h][axis] = F(node[h][axis] + delta);
      }
      return list;
    });
    setMessage(axis === 'x' ? 'Выбранные узлы выровнены по общей вертикали.' : 'Выбранные узлы выровнены по общей горизонтали.');
  };
  const distributeSelectedNodes = axis => {
    const st = stateRef.current;
    const so = getObj();
    const refs = (st.selectedNodes || []).filter(p => Number.isInteger(p.ci) && Number.isInteger(p.ni));
    if (!so || refs.length < 3 || refs.some(p => p.ci !== refs[0].ci)) {
      setMessage('Для распределения выбери минимум три узла одного контура.');
      return;
    }
    commit(list => {
      const ob = list.find(x => x.id === so.id);
      const contour = ob?.contours[refs[0].ci];
      if (!contour || refs.some(p => !contour.nodes[p.ni])) return list;
      const points = refs.map(p => ({ ni: p.ni, node: contour.nodes[p.ni] }))
        .sort((a, b) => a.node[axis] - b.node[axis]);
      const first = points[0].node[axis], last = points[points.length - 1].node[axis];
      const step = (last - first) / (points.length - 1);
      points.forEach((p, i) => {
        const target = first + step * i, delta = target - p.node[axis];
        p.node[axis] = F(target);
        for (const h of ['hIn', 'hOut']) if (p.node[h]) p.node[h][axis] = F(p.node[h][axis] + delta);
      });
      return list;
    });
    setMessage(axis === 'x' ? 'Узлы распределены с равными промежутками по X.' : 'Узлы распределены с равными промежутками по Y.');
  };
  const transformSelectedNodes = (mode, value = 1) => {
    const so = getObj();
    const refs = (stateRef.current.selectedNodes || []).filter(p => Number.isInteger(p.ci) && Number.isInteger(p.ni));
    if (!so || refs.length < 2) return;
    const current = refs.map(p => so.contours[p.ci]?.nodes[p.ni]).filter(Boolean);
    if (current.length < 2) return;
    const xs = current.map(n => n.x), ys = current.map(n => n.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    commit(list => {
      const ob = list.find(x => x.id === so.id);
      if (!ob) return list;
      for (const p of refs) {
        const n = ob.contours[p.ci]?.nodes[p.ni];
        if (!n) continue;
        let dx = 0, dy = 0;
        if (mode === 'scale') { dx = (n.x - cx) * (value - 1); dy = (n.y - cy) * (value - 1); }
        else if (mode === 'left') dx = -value;
        else if (mode === 'right') dx = value;
        else if (mode === 'up') dy = value;
        else if (mode === 'down') dy = -value;
        const oldX = n.x, oldY = n.y;
        n.x = F(oldX + dx); n.y = F(oldY + dy);
        for (const h of ['hIn', 'hOut']) if (n[h]) {
          if (mode === 'scale') {
            n[h].x = F(cx + (n[h].x - cx) * value);
            n[h].y = F(cy + (n[h].y - cy) * value);
          } else {
            n[h].x = F(n[h].x + dx);
            n[h].y = F(n[h].y + dy);
          }
        }
      }
      return list;
    });
    setMessage(mode === 'scale' ? 'Размер группы узлов изменён.' : 'Группа узлов перемещена.');
  };
  const clearNodeHandles = () => {
    const so = getObj();
    const st = stateRef.current;
    if (!so || !st.selNode) return;
    commit(list => {
      const ob = list.find(x => x.id === so.id);
      const n = ob && ob.contours[st.selNode.ci]?.nodes[st.selNode.ni];
      if (!n) return list;
      n.hIn = null;
      n.hOut = null;
      n.smooth = false;
      return list;
    });
    setMessage('Кривые у выбранного узла убраны: соседние сегменты стали прямыми.');
  };
  const setHandlePolar = (which, dimension, value) => {
    const so = getObj();
    const st = stateRef.current;
    const v = Number(value);
    if (!so || !st.selNode || !Number.isFinite(v)) return;
    commit(list => {
      const ob = list.find(x => x.id === so.id);
      const n = ob && ob.contours[st.selNode.ci]?.nodes[st.selNode.ni];
      if (!n || !n[which]) return list;
      const other = which === 'hIn' ? 'hOut' : 'hIn';
      const dx = n[which].x - n.x, dy = n[which].y - n.y;
      let len = Math.hypot(dx, dy), angle = Math.atan2(dy, dx) * 180 / Math.PI;
      if (dimension === 'length') len = Math.max(0, Math.min(2000, v));
      else angle = v;
      const rad = angle * Math.PI / 180;
      n[which] = { x: F(n.x + Math.cos(rad) * len), y: F(n.y + Math.sin(rad) * len) };
      if (n.smooth) {
        const otherLen = n[other] ? Math.hypot(n[other].x - n.x, n[other].y - n.y) : len;
        n[other] = { x: F(n.x - Math.cos(rad) * otherLen), y: F(n.y - Math.sin(rad) * otherLen) };
      }
      return list;
    });
  };
  const handlePolar = (node, which) => {
    if (!node || !node[which]) return { length: '', angle: '' };
    const dx = node[which].x - node.x, dy = node[which].y - node.y;
    return { length: Math.round(Math.hypot(dx, dy)), angle: Math.round(Math.atan2(dy, dx) * 180 / Math.PI) };
  };

  /* ===== Применение к букве ===== */
  const applyToGlyph = () => {
    const all = [];
    for (const source of objects) {
      // Не изменяем объекты React state во время подготовки экспорта.
      const o = clone(source);
      normalizeObject(o);
      for (const c of o.contours) {
        const flat = flattenContour(c, 4).map(p => ({ x: F(p.x), y: F(p.y) }));
        if (flat.length >= 3 && Math.abs(areaStd(flat)) > 20) all.push(flat);
      }
    }
    let advanceWidth = glyph.advanceWidth || 600;
    if (all.length) {
      let maxX = -Infinity;
      for (const c of all) for (const p of c) if (p.x > maxX) maxX = p.x;
      advanceWidth = Math.max(250, Math.min(1400, Math.round(maxX + 60)));
    }
    onApply({ outlines: all, advanceWidth });
  };

  /* ===== Импорт ===== */
  const regenPreview = useCallback(() => {
    try {
      let cs = null;
      if (importTab === 'pattern') cs = patternContours(patternKind, patternSize);
      else if (importTab === 'symbol') cs = loadedFont && symFamily === '__custom__' ? symbolFromFontFile(loadedFont, [...(symChar || char)][0] || char) : symbolFromSystem([...(symChar || char)][0] || char, symFamily, symWeight, symItalic);
      else if (importTab === 'png' && pngSource) cs = contoursFromImage(pngSource, pngThr, pngInvert, pngSimplify, pngSmooth, isLower);
      else if (importTab === 'svg' && svgText.trim()) cs = contoursFromSvg(svgText, svgTol, svgSmooth, isLower);
      if (cs && cs.length) {
        const tmp = { id: 'preview', contours: cs };
        normalizeObject(tmp);
        setPreviewContours(tmp.contours);
      } else setPreviewContours(null);
    } catch (err) {
      setPreviewContours(null);
      setMessage(err.message || String(err));
    }
  }, [importTab, patternKind, patternSize, symChar, symFamily, symWeight, symItalic, loadedFont, pngSource, pngThr, pngInvert, pngSimplify, pngSmooth, svgText, svgTol, svgSmooth, char, isLower]);
  useEffect(() => { if (importOpen) { const t = setTimeout(regenPreview, 120); return () => clearTimeout(t); } }, [importOpen, regenPreview]);

  const insertPreview = () => {
    if (!previewContours) return;
    const cs = clone(previewContours);
    commit(list => {
      const no = { id: uid(), contours: cs };
      list.push(no);
      setSel(no.id);
      return list;
    });
    setImportOpen(false);
    setToolState('select');
    setMessage('Вставлено и привязано к направляющим. Тяните ручки для размера; повторный клик — поворот/скос.');
  };
  const loadPngFile = file => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, 400 / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      setPngSource({ data: ctx.getImageData(0, 0, w, h).data, w, h });
      URL.revokeObjectURL(url);
      setImportTab('png'); setImportOpen(true);
    };
    img.onerror = () => { URL.revokeObjectURL(url); setMessage('Не удалось открыть картинку.'); };
    img.src = url;
  };
  const loadSvgFile = file => {
    const r = new FileReader();
    r.onload = () => { setSvgText(String(r.result)); setImportTab('svg'); setImportOpen(true); };
    r.readAsText(file);
  };
  const loadFontFile = async file => {
    try {
      const buf = await file.arrayBuffer();
      const font = opentype.parse(buf);
      setLoadedFont(font);
      const name = (font.names && font.names.fontFamily && (font.names.fontFamily.en || font.names.fontFamily.ru)) || file.name;
      setLoadedFontName(name);
      setSymFamily('__custom__');
    } catch (err) { setMessage('Не удалось прочитать шрифт: ' + (err.message || err)); }
  };

  /* ===== Клавиатура ===== */
  useEffect(() => {
    const down = e => {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      if (e.key === 'Escape') {
        if (importOpenRef.current) { setImportOpen(false); return; }
        if (typing) { e.target.blur(); return; }
        if (penRef.current.nodes.length) { penRef.current.nodes = []; rerender(); return; }
        onClose();
        return;
      }
      if (typing || importOpenRef.current) return;
      if (e.code === 'Space') { spaceRef.current = true; e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); redo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') { e.preventDefault(); duplicateSel(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (stateRef.current.tool === 'node' && stateRef.current.selNode) {
          if (stateRef.current.selectedNodes.length > 1) deleteSelectedNodes();
          else deleteNode();
        }
        else deleteSel();
        return;
      }
      if (e.key === 'Enter' && stateRef.current.tool === 'pen') { finishPen(); return; }
      if (e.key.startsWith('Arrow') && getObj()) {
        e.preventDefault();
        const s = e.shiftKey ? 20 : 4;
        const dx = e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0;
        const dy = e.key === 'ArrowUp' ? s : e.key === 'ArrowDown' ? -s : 0;
        transformSel(q => ({ x: q.x + dx, y: q.y + dy }));
        return;
      }
      const tools = { KeyV: 'select', KeyN: 'node', KeyP: 'pen', KeyB: 'brush', KeyE: 'eraser', KeyH: 'hand' };
      if (tools[e.code] && !e.ctrlKey && !e.metaKey && !e.altKey) { setToolState(tools[e.code]); penRef.current.nodes = []; rerender(); }
    };
    const up = e => { if (e.code === 'Space') spaceRef.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  });

  /* ===== Мини-превью импорта ===== */
  const previewSvg = () => {
    if (!previewContours) return null;
    let d = '';
    for (const c of previewContours) {
      const ns = c.nodes, n = ns.length;
      if (n < 2) continue;
      d += `M ${F(ns[0].x)} ${F(-ns[0].y)}`;
      for (let i = 0; i < n; i++) {
        const a = ns[i], b = ns[(i + 1) % n], cv = segCtrl(a, b);
        if (cv) d += ` C ${F(cv[0].x)} ${F(-cv[0].y)} ${F(cv[1].x)} ${F(-cv[1].y)} ${F(b.x)} ${F(-b.y)}`;
        else d += ` L ${F(b.x)} ${F(-b.y)}`;
      }
      d += ' Z';
    }
    return <svg viewBox="-60 -840 1000 1100" className="ve-preview-svg">
      <rect x="0" y="-800" width="900" height="1000" fill="#f4f1ea"/>
      {[[-800, '#3b82f6'], [-700, '#6366f1'], [-500, '#8b5cf6'], [0, '#22c55e'], [200, '#ef4444']].map(([y, color]) => <line key={y} x1="-60" y1={y} x2="940" y2={y} stroke={color} strokeWidth={y === 0 ? 3 : 1.5}/>)}
      <path d={d} fill="#20242d" fillRule="nonzero"/>
    </svg>;
  };

  const bb = selBBox();
  const st = stateRef.current;
  const activeNode = st.selNode ? st.objects.find(o => o.id === st.sel)?.contours[st.selNode.ci]?.nodes[st.selNode.ni] : null;
  const setTool = t => { setToolState(t); penRef.current.nodes = []; brushRef.current = null; eraserPosRef.current = null; rerender(); };

  return <div className="ve-overlay">
    <div className="ve-window">
      <div className="ve-titlebar">
        <strong>Векторный редактор — символ «{char === ' ' ? '␠' : char}»</strong>
        <span className="ve-title-note">Объекты привязаны к направляющим шрифта · всё сохраняется в букву</span>
        <button className="button" onClick={onClose}>✕ Закрыть</button>
      </div>

      <div className="ve-propertybar">
        <button className="button primary" onClick={() => { setImportOpen(true); setImportTab('pattern'); }}>📥 Вставить</button>
        <span className="ve-sep"/>
        {tool === 'select' && <>
          <label>X<input type="number" value={bb ? Math.round(bb.x) : ''} disabled={!bb} onChange={e => { const v = Number(e.target.value); if (bb && isFinite(v)) { const dx = v - bb.x; transformSel(q => ({ x: q.x + dx, y: q.y })); } }}/></label>
          <label>Y<input type="number" value={bb ? Math.round(bb.y) : ''} disabled={!bb} onChange={e => { const v = Number(e.target.value); if (bb && isFinite(v)) { const dy = v - bb.y; transformSel(q => ({ x: q.x, y: q.y + dy })); } }}/></label>
          <label>Ш<input type="number" min="1" value={bb ? Math.round(bb.w) : ''} disabled={!bb} onChange={e => { const v = Number(e.target.value); if (bb && v > 0) { const s = v / bb.w; transformSel(q => ({ x: bb.x + (q.x - bb.x) * s, y: q.y })); } }}/></label>
          <label>В<input type="number" min="1" value={bb ? Math.round(bb.h) : ''} disabled={!bb} onChange={e => { const v = Number(e.target.value); if (bb && v > 0) { const s = v / bb.h; transformSel(q => ({ x: q.x, y: bb.y + (q.y - bb.y) * s })); } }}/></label>
          <label>°<input type="number" step="5" defaultValue={0} disabled={!bb} onChange={e => { const v = Number(e.target.value); e.target.value = 0; rotateSel(v); }}/></label>
          <button className="button" disabled={!bb} onClick={duplicateSel} title="Дублировать (Ctrl+D)">⧉</button>
          <button className="button" disabled={!bb} onClick={() => flipSel(true)} title="Отразить по горизонтали">⇋</button>
          <button className="button" disabled={!bb} onClick={() => flipSel(false)} title="Отразить по вертикали">⇅</button>
          <button className="button" disabled={!bb} onClick={() => orderSel(false)} title="На задний план">⬇</button>
          <button className="button" disabled={!bb} onClick={() => orderSel(true)} title="На передний план">⬆</button>
          <button className="button" disabled={!bb} onClick={alignBaseline} title="Поставить низ на базовую линию">⌖ База</button>
          <button className="button" disabled={!bb} onClick={centerGlyph} title="Центрировать по полю">↔ Центр</button>
          <button className="button" disabled={!bb} onClick={() => fitHeight(METRICS.capHeight)} title="Высота прописной (700)">↕ 700</button>
          <button className="button" disabled={!bb} onClick={() => fitHeight(METRICS.xHeight)} title="Высота строчной (500)">↕ 500</button>
          <button className="button danger" disabled={!bb} onClick={deleteSel} title="Удалить (Delete)">🗑</button>
          {bb && (() => {
            const appearance = st.objects.find(o => o.id === st.sel)?.appearance || { opacity: 1, edgeOpacity: 0.95, centerOpacity: 0.18 };
            const controls = [
              ['opacity', 'Общая прозрачность', Math.round((1 - appearance.opacity) * 100)],
              ['edgeOpacity', 'Контур', Math.round((1 - appearance.edgeOpacity) * 100)],
              ['centerOpacity', 'Внутри', Math.round((1 - appearance.centerOpacity) * 100)]
            ];
            return controls.map(([key, label, value]) => <label className="ve-range" key={key}>
              {label}<input type="range" min="0" max="100" step="1" value={value}
                onPointerDown={beginAppearanceEdit}
                onChange={e => changeAppearance(key, 100 - Number(e.target.value))}
                onPointerUp={endAppearanceEdit} onPointerCancel={endAppearanceEdit} onBlur={endAppearanceEdit}/>
              <b>{value}%</b>
            </label>);
          })()}

        </>}
        {tool === 'node' && <>
          <label>X<input key={st.selNode ? st.selNode.ci + '-' + st.selNode.ni + '-x' : 'no-node-x'} type="number" step="1" defaultValue={activeNode ? Math.round(activeNode.x) : ''} disabled={!activeNode} onBlur={e => setSelectedNodeCoord('x', e.target.value)}/></label>
          <label>Y<input key={st.selNode ? st.selNode.ci + '-' + st.selNode.ni + '-y' : 'no-node-y'} type="number" step="1" defaultValue={activeNode ? Math.round(activeNode.y) : ''} disabled={!activeNode} onBlur={e => setSelectedNodeCoord('y', e.target.value)}/></label>
          <button className={`button ${nodeMultiSelect ? 'primary' : ''}`} onClick={() => setNodeMultiSelect(v => !v)} aria-pressed={nodeMultiSelect} title="Включить выбор нескольких узлов касанием; выключение сохраняет группу для перемещения">☷ Мультивыбор</button>
          <button className="button" disabled={!selectedNodes.length} onClick={() => { setSelectedNodes([]); setSelNode(null); rerender(); }}>Снять выбор</button>
          <button className="button" disabled={selectedNodes.length < 2} onClick={() => alignSelectedNodes('x')} title="Выровнять выделенные узлы по общей вертикали">X выровнять</button>
          <button className="button" disabled={selectedNodes.length < 2} onClick={() => alignSelectedNodes('y')} title="Выровнять выделенные узлы по общей горизонтали">Y выровнять</button>
          <button className="button" disabled={selectedNodes.length < 3 || new Set(selectedNodes.map(p => p.ci)).size !== 1} onClick={() => distributeSelectedNodes('x')} title="Равные промежутки по X в одном контуре">X распределить</button>
          <button className="button" disabled={selectedNodes.length < 3 || new Set(selectedNodes.map(p => p.ci)).size !== 1} onClick={() => distributeSelectedNodes('y')} title="Равные промежутки по Y в одном контуре">Y распределить</button>
          <button className="button" disabled={selectedNodes.length < 2} onClick={() => transformSelectedNodes('scale', 0.9)} title="Уменьшить группу относительно её центра">−10%</button>
          <button className="button" disabled={selectedNodes.length < 2} onClick={() => transformSelectedNodes('scale', 1.1)} title="Увеличить группу относительно её центра">+10%</button>
          <button className="button" disabled={selectedNodes.length < 2} onClick={() => transformSelectedNodes('left', 10)} title="Сдвинуть группу влево">← 10</button>
          <button className="button" disabled={selectedNodes.length < 2} onClick={() => transformSelectedNodes('right', 10)} title="Сдвинуть группу вправо">→ 10</button>
          <button className="button" disabled={selectedNodes.length < 2} onClick={() => transformSelectedNodes('up', 10)} title="Сдвинуть группу вверх">↑ 10</button>
          <button className="button" disabled={selectedNodes.length < 2} onClick={() => transformSelectedNodes('down', 10)} title="Сдвинуть группу вниз">↓ 10</button>
          <button className="button" disabled={!st.selNode} onClick={addNodeAfter}>+ узел</button>
          <button className="button" disabled={!st.selNode} onClick={() => selectedNodes.length > 1 ? deleteSelectedNodes() : deleteNode()}>{selectedNodes.length > 1 ? '− узлы' : '− узел'}</button>
          <button className="button" disabled={!activeNode} onClick={toggleSmoothSel}>{activeNode ? (activeNode.smooth ? 'Острый угол' : 'Сгладить') : 'Угол / гладкий'}</button>
          <button className="button" disabled={!activeNode && selectedNodes.length===0} onClick={() => setSelectedNodesSmooth('soft')} title="Небольшое мягкое скругление выбранных узлов">Мягко</button>
          <button className="button" disabled={!activeNode && selectedNodes.length===0} onClick={() => setSelectedNodesSmooth('curve')} title="Выраженная плавная кривая на выбранных узлах">Плавная кривая</button>
          <button className="button" disabled={!activeNode && selectedNodes.length===0} onClick={() => setSelectedNodesSmooth('auto')} title="Сгладить весь контур, сохраняя выраженные острые углы">Авто контур</button>
          <button className="button" disabled={!activeNode && selectedNodes.length===0} onClick={() => setSelectedNodesSmooth('sharp')} title="Сделать выбранные узлы острыми, без кривых">Острые узлы</button>
          <label title="Радиус скругления в единицах контура">Радиус<input type="number" min="1" max="1000" step="5" value={cornerRadius} onChange={e => setCornerRadius(Math.max(0, Number(e.target.value) || 0))} disabled={!activeNode}/></label>
          <button className="button" disabled={!activeNode} onClick={roundSelectedCorner} title="Заменить острый угол плавной дугой с заданным радиусом">◜ Скруглить</button>
          <button className="button" disabled={!activeNode || (!activeNode.hIn && !activeNode.hOut)} onClick={clearNodeHandles}>Убрать кривые</button>
          <button className="button" disabled={!activeNode} onClick={makeNodeSymmetric} title="Сделать входящую и исходящую ручки равными и противоположными">⇔ Симметрия</button>
          <button className="button" disabled={!activeNode || !st.selNode || (st.objects.find(o => o.id === st.sel)?.contours[st.selNode.ci]?.nodes.length || 0) < 3} onClick={centerNodeBetweenNeighbors} title="Переместить узел в середину между соседними">↔ Середина</button>
          <button className="button" disabled={!activeNode || !st.selNode} onClick={() => alignNodeAxisToPrevious('x')} title="Совместить X с предыдущим узлом">X сос.</button>
          <button className="button" disabled={!activeNode || !st.selNode} onClick={() => alignNodeAxisToPrevious('y')} title="Совместить Y с предыдущим узлом">Y сос.</button>
          {['hIn','hOut'].map((which) => {
            const hp = handlePolar(activeNode, which);
            const label = which === 'hIn' ? 'Вход' : 'Выход';
            return <Fragment key={which}>
              <label title={label + ': длина ручки'}>{label} L<input key={st.selNode ? st.selNode.ci+'-'+st.selNode.ni+'-'+which+'-l-'+hp.length+'-'+hp.angle : which+'-l'} type="number" min="0" max="2000" step="1" defaultValue={hp.length} disabled={!activeNode || !activeNode[which]} onBlur={e => setHandlePolar(which,'length',e.target.value)}/></label>
              <label title={label + ': угол ручки'}>°<input key={st.selNode ? st.selNode.ci+'-'+st.selNode.ni+'-'+which+'-a-'+hp.length+'-'+hp.angle : which+'-a'} type="number" step="1" defaultValue={hp.angle} disabled={!activeNode || !activeNode[which]} onBlur={e => setHandlePolar(which,'angle',e.target.value)}/></label>
            </Fragment>;
          })}
          <span className="ve-hint">Перетаскивай ручки или задавай их длину и угол числами. У гладкого узла противоположная ручка сохраняет направление.</span>
        </>}
        {tool === 'pen' && <span className="ve-hint">клик — узел · клик и тянуть — кривая · клик по первому узлу или Enter — замкнуть</span>}
        {tool === 'line' && <span className="ve-hint">Потяните от начала к концу линии.</span>}
        {tool === 'rect' && <span className="ve-hint">Потяните диагональ прямоугольника.</span>}
        {tool === 'ellipse' && <span className="ve-hint">Потяните диагональ овала.</span>}
        {tool === 'polygon' && <><label className="ve-range">Стороны<input type="range" min="3" max="12" step="1" value={polygonSides} onChange={e => setPolygonSides(Number(e.target.value))}/><b>{polygonSides}</b></label><span className="ve-hint">Потяните диагональ многоугольника.</span></>}
        <button className={`button ${showGuides ? 'primary' : ''}`} onClick={() => setShowGuides(v => !v)} aria-pressed={showGuides}>Направляющие {showGuides ? '✓' : '○'}</button>
        <button className={`button ${showGrid ? 'primary' : ''}`} onClick={() => setShowGrid(v => !v)} aria-pressed={showGrid}>Сетка {showGrid ? '✓' : '○'}</button>
        <button className={`button ${snapToGrid ? 'primary' : ''}`} onClick={() => { setSnapToGrid(v => !v); setShowGrid(true); }} aria-pressed={snapToGrid} title="Привязка точек к шагу сетки 100">Привязка {snapToGrid ? '✓' : '○'}</button>
        {(tool === 'brush' || tool === 'line') && <label className="ve-range">Толщина<input type="range" min="10" max="180" value={brushWidth} onChange={e => setBrushWidth(Number(e.target.value))}/><b>{brushWidth}</b></label>}
        {tool === 'eraser' && <label className="ve-range">Размер ластика<input type="range" min="10" max="200" value={eraserR} onChange={e => setEraserR(Number(e.target.value))}/><b>{eraserR}</b></label>}
        {tool === 'hand' && <span className="ve-hint">Перетаскивайте холст. Колесо мыши — зум.</span>}
        <span className="ve-flex"/>
        <button className="button" onClick={undo} title="Ctrl+Z">↩</button>
        <button className="button" onClick={redo} title="Ctrl+Y">↪</button>
        <button className="button" onClick={() => setView({ ...VIEW0 })} title="Показать всё поле">⤢</button>
        <button className="button primary" onClick={applyToGlyph} title="Записать объекты в букву и вернуться">✔ Применить к букве</button>
      </div>

      <div className="ve-body">
        <div className="ve-toolbox">
          {TOOL_DEFS.map(([t, key, title]) => <button key={t} className={`ve-tool ${tool === t ? 'active' : ''}`} title={`${title} (${key})`} onClick={() => setTool(t)}>
            {t === 'select' ? '➤' : t === 'line' ? '／' : t === 'rect' ? '□' : t === 'ellipse' ? '◯' : t === 'polygon' ? '⬡' : t === 'node' ? '◇' : t === 'pen' ? '✒' : t === 'brush' ? '✎' : t === 'eraser' ? '⌫' : '✋'}
            <small>{key}</small>
          </button>)}
        </div>
        <div className="ve-canvas-wrap" onDragOver={e => e.preventDefault()} onDrop={e => {
          e.preventDefault();
          const f = e.dataTransfer.files && e.dataTransfer.files[0];
          if (!f) return;
          if (/svg/.test(f.type) || /\.svg$/i.test(f.name)) loadSvgFile(f);
          else if (/^image\//.test(f.type)) loadPngFile(f);
        }}>
          <canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel} onContextMenu={e => e.preventDefault()} style={{ touchAction: 'none' }}/>
        </div>
      </div>
      <div className="ve-status">{message}</div>

      {importOpen && <div className="ve-modal-backdrop" onPointerDown={e => { if (e.target === e.currentTarget) setImportOpen(false); }}>
        <div className="ve-modal">
          <div className="ve-modal-head"><strong>📥 Вставить в символ «{char === ' ' ? '␠' : char}»</strong><button className="button" onClick={() => setImportOpen(false)}>✕</button></div>
          <div className="ve-tabs">
            {[['pattern', 'Узор'], ['symbol', 'Буква / знак'], ['png', 'Картинка'], ['svg', 'SVG']].map(([t, label]) => <button key={t} className={importTab === t ? 'active' : ''} onClick={() => setImportTab(t)}>{label}</button>)}
          </div>
          <div className="ve-modal-body">
            <div className="ve-import-controls">
              {importTab === 'pattern' && <>
                <label>Узор<select value={patternKind} onChange={e => setPatternKind(e.target.value)}>{PATTERNS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label>
                <label>Размер: {patternSize}<input type="range" min="200" max="800" step="20" value={patternSize} onChange={e => setPatternSize(Number(e.target.value))}/></label>
                <p className="ve-note">Орнамент вставляется как редактируемый векторный объект: масштаб, поворот, скос, узлы — как в Corel.</p>
              </>}
              {importTab === 'symbol' && <>
                <label>Символ<input type="text" maxLength={2} value={symChar} onChange={e => setSymChar(e.target.value)}/></label>
                <label>Шрифт<select value={symFamily} onChange={e => setSymFamily(e.target.value)}>
                  {FAMILIES.map(f => <option key={f} value={f}>{f}</option>)}
                  {loadedFont && <option value="__custom__">📄 {loadedFontName}</option>}
                </select></label>
                <label>Насыщенность<select value={symWeight} onChange={e => setSymWeight(e.target.value)}><option value="400">Обычная</option><option value="700">Жирная</option></select></label>
                <label className="ve-check"><input type="checkbox" checked={symItalic} onChange={e => setSymItalic(e.target.checked)}/> Курсив</label>
                <label className="button">🔤 Свой TTF/OTF…<input type="file" accept=".ttf,.otf,.woff" hidden onChange={e => { if (e.target.files[0]) loadFontFile(e.target.files[0]); e.target.value = ''; }}/></label>
                <p className="ve-note">Из файла шрифта контур берётся точный; системный шрифт обводится автоматически. Высота подгоняется под {isLower ? 'строчные (500)' : 'прописные (700)'}, низ — на базовую линию.</p>
              </>}
              {importTab === 'png' && <>
                <label className="button">Выбрать PNG/JPG…<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => { if (e.target.files[0]) loadPngFile(e.target.files[0]); e.target.value = ''; }}/></label>
                <label>Порог: {pngThr}<input type="range" min="10" max="245" value={pngThr} onChange={e => setPngThr(Number(e.target.value))}/></label>
                <label>Упрощение: {pngSimplify}<input type="range" min="0.4" max="4" step="0.2" value={pngSimplify} onChange={e => setPngSimplify(Number(e.target.value))}/></label>
                <label>Сглаживание: {pngSmooth}<input type="range" min="0" max="1.5" step="0.1" value={pngSmooth} onChange={e => setPngSmooth(Number(e.target.value))}/></label>
                <label className="ve-check"><input type="checkbox" checked={pngInvert} onChange={e => setPngInvert(e.target.checked)}/> Инвертировать (светлое на тёмном)</label>
                <p className="ve-note">Можно также перетащить файл прямо на холст.</p>
              </>}
              {importTab === 'svg' && <>
                <label className="button">Выбрать SVG…<input type="file" accept=".svg,image/svg+xml" hidden onChange={e => { if (e.target.files[0]) loadSvgFile(e.target.files[0]); e.target.value = ''; }}/></label>
                <textarea rows={4} placeholder="…или вставьте код SVG сюда" value={svgText} onChange={e => setSvgText(e.target.value)}/>
                <label>Упрощение: {svgTol}<input type="range" min="0.2" max="4" step="0.2" value={svgTol} onChange={e => setSvgTol(Number(e.target.value))}/></label>
                <label>Сглаживание: {svgSmooth}<input type="range" min="0" max="1.5" step="0.1" value={svgSmooth} onChange={e => setSvgSmooth(Number(e.target.value))}/></label>
              </>}
            </div>
            <div className="ve-import-preview">
              {previewSvg() || <div className="ve-preview-empty">Предпросмотр появится здесь</div>}
            </div>
          </div>
          <div className="ve-modal-foot">
            <button className="button" onClick={() => setImportOpen(false)}>Отмена</button>
            <button className="button primary" disabled={!previewContours} onClick={insertPreview}>Вставить в редактор</button>
          </div>
        </div>
      </div>}
    </div>
  </div>;
  }
