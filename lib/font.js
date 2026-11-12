import * as opentypeModule from 'opentype.js';
import { strokeToContours } from './geometry.js';
const opentype = opentypeModule.default ?? opentypeModule;
function addContour(path, points) { if (!points || points.length < 3) return; path.moveTo(points[0].x, points[0].y); for (let i = 1; i < points.length; i++) path.lineTo(points[i].x, points[i].y); path.close(); }
const STYLE = { Regular: { weight: 1, shear: 0 }, Bold: { weight: 1.28, shear: 0 }, Italic: { weight: 1, shear: 0.20 }, 'Bold Italic': { weight: 1.28, shear: 0.20 } };
export function buildFont(project, styleName = 'Regular') {
  const style = STYLE[styleName] || STYLE.Regular, glyphs = [];
  for (const [key, glyph] of Object.entries(project.glyphs || {})) {
    const unicode = Number(key); if (!Number.isInteger(unicode) || unicode < 0 || unicode > 0x10ffff) continue;
    const path = new opentype.Path();
    for (const stroke of glyph.strokes || []) for (const contour of strokeToContours(stroke.points || [], (stroke.width || 70) * style.weight / 2)) addContour(path, contour.map(point => ({ x: point.x + (800 - point.y) * style.shear, y: point.y })));
    for (const contour of glyph.outlines || []) addContour(path, contour.map(point => ({ x: point.x + (800 - point.y) * style.shear, y: point.y })));
    glyphs.push(new opentype.Glyph({ name: `uni${unicode.toString(16).toUpperCase().padStart(4, '0')}`, unicode, advanceWidth: Math.max(100, Math.min(1800, Math.round((glyph.advanceWidth || 600) * style.weight))), path }));
  }
  glyphs.sort((a, b) => a.unicode - b.unicode);
  const familyName = (project.familyName || 'HandFont').slice(0, 60), author = project.metadata?.author?.trim();
  const font = new opentype.Font({ familyName, styleName, fullName: `${familyName} ${styleName}`, postScriptName: `${familyName.replace(/[^A-Za-z0-9]/g, '')}-${styleName.replace(/\s+/g, '')}`, version: project.metadata?.version || 'Version 1.000', unitsPerEm: 1000, ascender: 800, descender: -200, glyphs: [new opentype.Glyph({ name: '.notdef', advanceWidth: 600, path: new opentype.Path() }), ...glyphs], outlinesFormat: 'truetype' });
  if (author && font.names?.designer) font.names.designer.en = author;
  if (project.metadata?.description && font.names?.description) font.names.description.en = project.metadata.description;
  return font;
}
export function downloadBlob(blob, filename) { const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); }
export function safeFilename(name) { return (name || 'handfont').trim().replace(/[^a-zа-яё0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'handfont'; }
