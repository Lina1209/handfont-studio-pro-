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
export const BACKUP_STORAGE_KEY = `${STORAGE_KEY}-last-good`;
export const RECOVERY_STORAGE_KEY = `${STORAGE_KEY}-recovery`;

function parseStoredProject(raw) {
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return null;
    if (!saved.glyphs || typeof saved.glyphs !== 'object' || Array.isArray(saved.glyphs)) return null;
    const base = defaultProject();
    const savedGlyphs = saved.glyphs;
    const safeGlyphs = {};
    for (const [code, glyph] of Object.entries(savedGlyphs)) {
      const number = Number(code);
      if (!Number.isInteger(number) || number < 0 || number > 0x10ffff ||
          (number >= 0xd800 && number <= 0xdfff) ||
          !glyph || typeof glyph !== 'object' || Array.isArray(glyph) ||
          (glyph.strokes != null && !Array.isArray(glyph.strokes)) ||
          (glyph.outlines != null && !Array.isArray(glyph.outlines))) return null;
      if ((glyph.strokes || []).some(stroke => !stroke || typeof stroke !== 'object' || !Array.isArray(stroke.points) || stroke.points.some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)))) return null;
      const strokes = (glyph.strokes || []).filter(stroke => stroke.points.length > 0).map(stroke => ({ ...stroke, points: stroke.points }));
      if ((glyph.outlines || []).some(contour => !Array.isArray(contour) || contour.length < 3 || contour.some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)))) return null;
      const outlines = glyph.outlines || [];
      const advanceWidth = Number(glyph.advanceWidth);
      safeGlyphs[number] = {
        ...makeGlyph(String.fromCodePoint(number)),
        ...glyph,
        unicode: number,
        advanceWidth: Number.isFinite(advanceWidth) ? Math.max(100, Math.min(1800, advanceWidth)) : makeGlyph(String.fromCodePoint(number)).advanceWidth,
        strokes, outlines
      };
    }
    const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const metadata = record(saved.metadata), passport = record(saved.passport), glyphInfo = record(saved.glyphInfo);
    return {
      ...base, ...saved,
      familyName: typeof saved.familyName === 'string' && saved.familyName.trim() ? saved.familyName : base.familyName,
      metadata: { ...base.metadata, ...metadata }, passport, glyphInfo,
      glyphs: { ...base.glyphs, ...safeGlyphs },
      updatedAt: Number.isFinite(saved.updatedAt) ? saved.updatedAt : Date.now()
    };
  } catch { return null; }
}

export function saveProjectSnapshot(project) {
  const serialized = JSON.stringify({ ...project, updatedAt: Date.now() });
  try {
    const previous = localStorage.getItem(STORAGE_KEY);
    if (previous) {
      const parsed = JSON.parse(previous);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
          parsed.glyphs && typeof parsed.glyphs === 'object' && !Array.isArray(parsed.glyphs)) {
        localStorage.setItem(BACKUP_STORAGE_KEY, previous);
      }
    }
    localStorage.setItem(STORAGE_KEY, serialized);
    return true;
  } catch (error) { throw new Error(error?.name === 'QuotaExceededError'
    ? 'Недостаточно места в памяти браузера. Скачайте JSON-проект и резервную копию библиотеки.'
    : 'Не удалось сохранить проект в памяти браузера. Скачайте резервную копию.'); }
}

export function loadProject() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const primary = parseStoredProject(raw);
    if (primary) return primary;
    if (raw) {
      try { localStorage.setItem(RECOVERY_STORAGE_KEY, raw); } catch { /* storage may be full */ }
    }
    const backupRaw = localStorage.getItem(BACKUP_STORAGE_KEY);
    const backup = parseStoredProject(backupRaw);
    if (backup) return backup;
    return defaultProject();
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


export function updateProjectMetadata(project, key, value) {
  const next = {
    ...project,
    metadata: { ...(project.metadata || {}), [key]: value }
  };
  if (['author', 'description', 'license'].includes(key)) {
    next.passport = { ...(project.passport || {}), [key]: value };
  }
  return next;
}
