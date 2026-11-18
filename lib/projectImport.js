import { defaultProject } from './project.js';

const MAX_COORDINATE = 10000;
const MAX_POINTS_PER_GLYPH = 20000;
const MAX_TOTAL_POINTS = 500000;
const MAX_GLYPHS = 4096;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isCodePointKey = key => {
  if (!/^(0|[1-9]\\d*)$/.test(key)) return false;
  const value = Number(key);
  return Number.isSafeInteger(value) && value >= 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff);
};
const assertTextFields = (record, fields, section) => {
  if (!isRecord(record)) throw new Error(`Раздел «${section}» повреждён.`);
  for (const [key, max] of Object.entries(fields)) {
    if (record[key] !== undefined && (typeof record[key] !== 'string' || record[key].length > max)) {
      throw new Error(`Поле «${key}» в разделе «${section}» имеет неверный формат или слишком длинное значение.`);
    }
  }
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error(`В разделе «${section}» найдено недопустимое поле.`);
  }
};
function validateGlyphs(glyphs) {
  if (!isRecord(glyphs)) throw new Error('В файле не найдена корректная библиотека символов.');
  const entries = Object.entries(glyphs);
  if (entries.length > MAX_GLYPHS) throw new Error(`Слишком много символов: максимум ${MAX_GLYPHS}.`);
  let totalPoints = 0;
  for (const [key, glyph] of entries) {
    if (!isCodePointKey(key)) throw new Error(`Некорректный Unicode-код символа: ${key}.`);
    const code = Number(key), label = `U+${code.toString(16).toUpperCase()}`;
    if (!isRecord(glyph)) throw new Error(`Данные символа ${label} повреждены.`);
    if (glyph.unicode !== undefined && glyph.unicode !== code) throw new Error(`Unicode-код внутри символа ${label} не совпадает с его ключом.`);
    if (glyph.advanceWidth !== undefined && (!Number.isFinite(glyph.advanceWidth) || glyph.advanceWidth < 100 || glyph.advanceWidth > 1800)) {
      throw new Error(`Ширина символа ${label} должна быть числом от 100 до 1800.`);
    }
    for (const field of ['strokes', 'outlines']) {
      if (glyph[field] !== undefined && !Array.isArray(glyph[field])) throw new Error(`Список «${field}» символа ${label} повреждён.`);
    }
    let glyphPoints = 0;
    for (const [index, stroke] of (glyph.strokes || []).entries()) {
      if (!isRecord(stroke)) throw new Error(`Штрих ${index + 1} символа ${label} повреждён.`);
      if (stroke.width !== undefined && (!Number.isFinite(stroke.width) || stroke.width <= 0 || stroke.width > 400)) {
        throw new Error(`Толщина штриха символа ${label} должна быть числом от 0 до 400.`);
      }
      if (!Array.isArray(stroke.points) || stroke.points.length === 0) throw new Error(`У штриха символа ${label} отсутствуют корректные точки.`);
      for (const point of stroke.points) {
        if (!isRecord(point) || !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
            Math.abs(point.x) > MAX_COORDINATE || Math.abs(point.y) > MAX_COORDINATE) {
          throw new Error(`В символе ${label} найдены повреждённые или слишком большие координаты.`);
        }
        glyphPoints++;
      }
    }
    for (const contour of glyph.outlines || []) {
      if (!Array.isArray(contour) || contour.length < 3) throw new Error(`Векторный контур символа ${label} должен содержать минимум три точки.`);
      for (const point of contour) {
        if (!isRecord(point) || !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
            Math.abs(point.x) > MAX_COORDINATE || Math.abs(point.y) > MAX_COORDINATE) {
          throw new Error(`В контуре символа ${label} найдены повреждённые или слишком большие координаты.`);
        }
        glyphPoints++;
      }
    }
    if (glyphPoints > MAX_POINTS_PER_GLYPH) throw new Error(`Слишком много точек в символе ${label}.`);
    totalPoints += glyphPoints;
    if (totalPoints > MAX_TOTAL_POINTS) throw new Error('В проекте слишком много точек. Файл превышает безопасный лимит.');
    for (const key of Object.keys(glyph)) {
      if (FORBIDDEN_KEYS.has(key)) throw new Error(`В символе ${label} найдено недопустимое поле.`);
    }
  }
}
export function normalizeImportedProject(parsed) {
  if (!isRecord(parsed)) throw new Error('JSON должен содержать объект проекта.');
  validateGlyphs(parsed.glyphs);
  assertTextFields(parsed.metadata ?? {}, { author: 120, version: 40, description: 2000, license: 1000 }, 'метаданные');
  assertTextFields(parsed.passport ?? {}, { author: 120, year: 4, description: 2000, license: 1000, history: 5000 }, 'паспорт шрифта');
  if (parsed.glyphInfo !== undefined && !isRecord(parsed.glyphInfo)) throw new Error('Каталог знаков повреждён.');
  for (const [code, info] of Object.entries(parsed.glyphInfo || {})) {
    if (!isCodePointKey(code) || !isRecord(info)) throw new Error(`Описание знака ${code} повреждено.`);
    assertTextFields(info, { name: 120, mapping: 120, description: 1000 }, `знак ${code}`);
  }
  if (parsed.familyName !== undefined && (typeof parsed.familyName !== 'string' || !parsed.familyName.trim() || parsed.familyName.length > 120)) {
    throw new Error('Название семейства должно содержать от 1 до 120 символов.');
  }
  if (parsed.updatedAt !== undefined && (!Number.isFinite(parsed.updatedAt) || parsed.updatedAt < 0)) {
    throw new Error('Дата изменения проекта повреждена.');
  }
  if (parsed.metadata?.styles !== undefined &&
      (!Array.isArray(parsed.metadata.styles) || parsed.metadata.styles.length > 12 ||
       parsed.metadata.styles.some(style => typeof style !== 'string' || style.length > 40))) {
    throw new Error('Список начертаний шрифта повреждён.');
  }
  const base = defaultProject();
  return {
    ...base,
    ...parsed,
    familyName: typeof parsed.familyName === 'string' ? parsed.familyName.trim() : base.familyName,
    metadata: { ...base.metadata, ...(parsed.metadata || {}) },
    passport: { ...(parsed.passport || {}) },
    glyphInfo: { ...(parsed.glyphInfo || {}) },
    glyphs: { ...base.glyphs, ...parsed.glyphs }
  };
}
export async function readProjectJsonFile(file) {
  if (!file || typeof file.text !== 'function') throw new Error('Выберите JSON-файл проекта.');
  if (file.size > 25 * 1024 * 1024) throw new Error('Файл слишком большой: максимальный размер JSON-проекта — 25 МБ.');
  let parsed;
  try { parsed = JSON.parse(await file.text()); }
  catch { throw new Error('Файл не является корректным JSON или повреждён при сохранении.'); }
  return normalizeImportedProject(parsed);
}
