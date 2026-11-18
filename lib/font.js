import * as opentypeModule from 'opentype.js';
import { strokeToContours } from './geometry.js';

const opentype = opentypeModule.default ?? opentypeModule;

function addContour(path, points) {
  if (!Array.isArray(points) || points.length < 3) return;
  path.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) path.lineTo(points[i].x, points[i].y);
  path.close();
}

export function buildFont(project, styleName = 'Regular') {
  if (styleName !== 'Regular') throw new Error(`Начертание ${styleName} ещё не реализовано. Доступно только Regular.`);
  const glyphs = [];
  const usedCodePoints = new Set();
  for (const [key, glyph] of Object.entries(project.glyphs || {})) {
    const unicode = Number(key);
    if (!Number.isInteger(unicode) || unicode < 0 || unicode > 0x10ffff ||
        (unicode >= 0xd800 && unicode <= 0xdfff) || usedCodePoints.has(unicode) ||
        !glyph || typeof glyph !== 'object') continue;
    usedCodePoints.add(unicode);
    const path = new opentype.Path();
    const strokes = Array.isArray(glyph.strokes) ? glyph.strokes : [];
    for (const stroke of strokes) {
      if (!stroke || typeof stroke !== 'object' || !Array.isArray(stroke.points)) continue;
      for (const contour of strokeToContours(stroke.points, (Number(stroke.width) || 70) / 2)) {
        addContour(path, contour);
      }
    }
    const outlines = Array.isArray(glyph.outlines) ? glyph.outlines : [];
    for (const outline of outlines) addContour(path, outline);
    const width = Number(glyph.advanceWidth);
    glyphs.push(new opentype.Glyph({
      name: `uni${unicode.toString(16).toUpperCase().padStart(4, '0')}`,
      unicode,
      advanceWidth: Math.max(100, Math.min(1800, Math.round(Number.isFinite(width) && width ? width : 600))),
      path
    }));
  }
  glyphs.sort((a, b) => a.unicode - b.unicode);
  const notdef = new opentype.Glyph({ name: '.notdef', advanceWidth: 600, path: new opentype.Path() });
  const familyName = (project.familyName || 'HandFont').trim().slice(0, 60) || 'HandFont';
  const metadata = project.metadata || {};
  const passport = project.passport || {};
  const author = String(passport.author || metadata.author || '').trim();
  const version = String(metadata.version || '1.000').trim();
  const description = String(passport.description || metadata.description || '').trim();
  const license = String(passport.license || metadata.license || 'SIL Open Font License 1.1').trim();
  const postScriptFamily = familyName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9-]/g, '') || 'HandFont';
  const copyright = author ? `Copyright ${new Date().getFullYear()} ${author}` : '';
  return new opentype.Font({
    familyName,
    styleName: 'Regular',
    fullName: `${familyName} Regular`,
    postScriptName: `${postScriptFamily}-Regular`.slice(0, 63),
    designer: author || undefined,
    description: description || undefined,
    license: license ? `Licensed under ${license}` : undefined,
    version: `Version ${version}`,
    copyright: copyright || undefined,
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs: [notdef, ...glyphs]
  });
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
