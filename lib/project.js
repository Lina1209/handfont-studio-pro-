export const STORAGE_KEY = 'handfont-studio-pro-v1';
export const METRICS = { ascender: 800, capHeight: 700, xHeight: 500, baseline: 0, descender: -200 };
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
