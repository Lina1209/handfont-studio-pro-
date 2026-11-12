export const STORAGE_KEY = 'handfont-studio-pro-v1';
export const METRICS = { ascender: 800, capHeight: 700, xHeight: 500, baseline: 0, descender: -200 };
export const PALETTE_COLORS = ['#f2eee7', '#f5d76e', '#f472b6', '#60a5fa', '#4ade80', '#f87171', '#a78bfa'];
export const CHARSET_GROUPS = [
  { id: 'cyrillic', label: 'Кириллица', chars: 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя' },
  { id: 'latin', label: 'Латиница', chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' },
  { id: 'digits', label: 'Цифры и знаки', chars: '0123456789.,;:!?—–-()[]«»"\\\'@#&/№%+=' },
  { id: 'space', label: 'Пробел', chars: ' ' }
];
export function makeGlyph(char) {
  return { unicode: char.codePointAt(0), strokes: [], advanceWidth: char === ' ' ? 280 : 600 };
}
export function defaultProject() {
  const glyphs = {};
  for (const group of CHARSET_GROUPS) for (const char of group.chars) glyphs[char.codePointAt(0)] = makeGlyph(char);
  return { familyName: 'My Handwriting', glyphs, updatedAt: Date.now() };
}
export function loadProject() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultProject();
    const saved = JSON.parse(raw);
    const base = defaultProject();
    return { familyName: saved.familyName || base.familyName, glyphs: { ...base.glyphs, ...(saved.glyphs || {}) }, updatedAt: saved.updatedAt || Date.now() };
  } catch {
    return defaultProject();
  }
}
export function charOf(code) {
  return String.fromCodePoint(Number(code));
}

const pointSegmentDistance = (point, start, end) => {
  const dx = end.x - start.x, dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
};

export function applyEraserToStrokes(strokes, eraser) {
  if (!Array.isArray(strokes) || !eraser?.points?.length) return strokes || [];
  const eraserPoints = eraser.points;
  const eraserSegments = eraserPoints.length === 1
    ? [[eraserPoints[0], eraserPoints[0]]]
    : eraserPoints.slice(1).map((point, index) => [eraserPoints[index], point]);
  const eraserRadius = Math.max(6, (eraser.width || 48) / 2);
  const next = [];

  for (const stroke of strokes) {
    const source = stroke?.points || [];
    if (!source.length) continue;
    const radius = eraserRadius + (stroke.width || 70) / 2;
    const isErased = point => eraserSegments.some(([start, end]) => pointSegmentDistance(point, start, end) <= radius);
    const keep = [];
    const append = point => {
      const last = keep[keep.length - 1];
      if (!last || Math.hypot(last.x - point.x, last.y - point.y) > 0.01) keep.push(point);
    };
    const flush = () => {
      if (keep.length) next.push({ ...stroke, points: keep.splice(0) });
    };

    if (source.length === 1) {
      if (!isErased(source[0])) next.push(stroke);
      continue;
    }

    for (let index = 1; index < source.length; index++) {
      const start = source[index - 1], end = source[index];
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      const steps = Math.max(1, Math.ceil(length / Math.max(1, Math.min(5, radius / 3))));
      for (let step = 0; step <= steps; step++) {
        if (index > 1 && step === 0) continue;
        const t = step / steps;
        const point = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
        if (isErased(point)) flush();
        else append(point);
      }
    }
    flush();
  }
  return next;
}
