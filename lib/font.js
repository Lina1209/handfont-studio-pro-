import * as opentypeModule from 'opentype.js';
import { strokeToContours } from './geometry.js';

const opentype = opentypeModule.default ?? opentypeModule;

function addContour(path, points) {
  if (!points || points.length < 3) return;
  path.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) path.lineTo(points[i].x, points[i].y);
  path.close();
}

export function buildFont(project) {
  const glyphs = [];
  for (const [key, glyph] of Object.entries(project.glyphs || {})) {
    const unicode = Number(key);
    if (!Number.isInteger(unicode) || unicode < 0 || unicode > 0x10ffff) continue;
    const path = new opentype.Path();
    for (const stroke of glyph.strokes || []) {
      for (const contour of strokeToContours(stroke.points || [], (stroke.width || 70) / 2)) addContour(path, contour);
    }
    glyphs.push(new opentype.Glyph({
      name: `uni${unicode.toString(16).toUpperCase().padStart(4, '0')}`,
      unicode,
      advanceWidth: Math.max(100, Math.min(1600, Math.round(glyph.advanceWidth || 600))),
      path
    }));
  }
  glyphs.sort((a, b) => a.unicode - b.unicode);
  const notdef = new opentype.Glyph({ name: '.notdef', advanceWidth: 600, path: new opentype.Path() });
  return new opentype.Font({ familyName: (project.familyName || 'HandFont').slice(0, 60), styleName: 'Regular', unitsPerEm: 1000, ascender: 800, descender: -200, glyphs: [notdef, ...glyphs] });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeFilename(name) {
  return (name || 'handfont').trim().replace(/[^a-zа-яё0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'handfont';
}
