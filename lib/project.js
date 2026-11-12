export const STORAGE_KEY = 'handfont-studio-pro-v1';
export const METRICS = { ascender: 800, capHeight: 700, xHeight: 500, baseline: 0, descender: -200 };
export const PALETTE_COLORS = ['#f2eee7', '#f5d76e', '#f472b6', '#60a5fa', '#4ade80', '#f87171', '#a78bfa'];
export const CHARSET_GROUPS = [
  { id: 'cyrillic', label: 'Кириллица', chars: 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя' },
  { id: 'latin', label: 'Латиница', chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' },
  { id: 'digits', label: 'Цифры и знаки', chars: '0123456789.,;:!?—–-()[]«»"\\\'@#&/№%+=' },
  { id: 'space', label: 'Пробел', chars: ' ' }
];
export function makeGlyph(char) { return { unicode: char.codePointAt(0), strokes: [], advanceWidth: char === ' ' ? 280 : 600 }; }
export function defaultProject() {
  const glyphs = {};
  for (const group of CHARSET_GROUPS) for (const char of group.chars) glyphs[char.codePointAt(0)] = makeGlyph(char);
  return { familyName: 'My Handwriting', metadata: { author: '', version: '1.000', description: '', license: 'SIL Open Font License 1.1', styles: ['Regular'] }, glyphs, updatedAt: Date.now() };
}
export function loadProject() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY); if (!raw) return defaultProject();
    const saved = JSON.parse(raw), base = defaultProject();
    return { ...base, ...saved, metadata: { ...base.metadata, ...(saved.metadata || {}) }, glyphs: { ...base.glyphs, ...(saved.glyphs || {}) }, updatedAt: saved.updatedAt || Date.now() };
  } catch { return defaultProject(); }
}
export function charOf(code) { return String.fromCodePoint(Number(code)); }
const pointSegmentDistance = (point, start, end) => {
  const dx = end.x - start.x, dy = end.y - start.y, lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
};
function splitStrokeByMask(strokes, isMasked, transformWidth = width => width) {
  const next = [];
  for (const stroke of strokes || []) {
    const source = stroke?.points || []; if (!source.length) continue;
    if (source.length === 1) { if (!isMasked(source[0], stroke)) next.push(stroke); continue; }
    let run = [], runWidth = null;
    const flush = () => { if (run.length) next.push({ ...stroke, width: runWidth || stroke.width, points: run }); run = []; runWidth = null; };
    const append = (point, width) => { if (runWidth !== null && Math.abs(runWidth - width) > 0.1) flush(); runWidth = width; const last = run[run.length - 1]; if (!last || Math.hypot(last.x - point.x, last.y - point.y) > 0.01) run.push(point); };
    for (let index = 1; index < source.length; index++) {
      const start = source[index - 1], end = source[index], steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / 3));
      for (let step = 0; step <= steps; step++) {
        if (index > 1 && step === 0) continue;
        const t = step / steps, point = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t }, result = isMasked(point, stroke);
        if (result === true || result === 'erase') flush(); else append(point, typeof result === 'number' ? transformWidth(stroke.width || 70, result) : stroke.width || 70);
      }
    }
    flush();
  }
  return next;
}
export function applyEraserToStrokes(strokes, eraser, mode = 'hard') {
  if (!Array.isArray(strokes) || !eraser?.points?.length) return strokes || [];
  const segments = eraser.points.length === 1 ? [[eraser.points[0], eraser.points[0]]] : eraser.points.slice(1).map((point, index) => [eraser.points[index], point]);
  const radius = Math.max(6, (eraser.width || 48) / 2);
  return splitStrokeByMask(strokes, (point, stroke) => {
    const distance = Math.min(...segments.map(([start, end]) => pointSegmentDistance(point, start, end))), reach = radius + (stroke.width || 70) / 2;
    if (mode === 'soft') return distance > reach ? false : Math.max(0.25, Math.min(0.72, distance / Math.max(1, reach)));
    return distance <= reach ? 'erase' : false;
  }, (width, strength) => Math.max(8, width * strength));
}
export function applySelectionToStrokes(strokes, selection) {
  if (!selection?.start || !selection?.end) return strokes || [];
  const left = Math.min(selection.start.x, selection.end.x), right = Math.max(selection.start.x, selection.end.x), bottom = Math.min(selection.start.y, selection.end.y), top = Math.max(selection.start.y, selection.end.y);
  return splitStrokeByMask(strokes, point => point.x >= left && point.x <= right && point.y >= bottom && point.y <= top ? 'erase' : false);
}
