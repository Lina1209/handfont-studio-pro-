import { CHARSET_GROUPS } from './project.js';

const requiredChars = [...new Set(CHARSET_GROUPS.flatMap(group => [...group.chars]))];
const isCodePoint = value => Number.isInteger(value) && value >= 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff);
const isText = value => typeof value === 'string' && value.trim().length > 0;

export function validateProject(project) {
  const errors = [], warnings = [];
  const glyphs = project?.glyphs && typeof project.glyphs === 'object' && !Array.isArray(project.glyphs) ? project.glyphs : {};
  const hasDrawing = glyph => Boolean(glyph?.strokes?.length || glyph?.outlines?.length);
  const missing = requiredChars.filter(char => char !== ' ' && !hasDrawing(glyphs[char.codePointAt(0)]));
  if (missing.length) warnings.push({ code: 'coverage', title: `Не нарисовано символов: ${missing.length}`, detail: missing.slice(0, 45).join(' ') + (missing.length > 45 ? ' …' : '') });

  const drawn = Object.entries(glyphs).filter(([, glyph]) => hasDrawing(glyph));
  if (!drawn.length) errors.push({ code: 'empty', title: 'Нет нарисованных символов', detail: 'Нарисуйте или импортируйте хотя бы один символ перед экспортом.' });

  for (const [code, glyph] of drawn) {
    const codePoint = Number(code);
    const validCode = isCodePoint(codePoint);
    const char = validCode ? String.fromCodePoint(codePoint) : `U+${code}`;
    if (!validCode) errors.push({ code: 'unicode', title: `${char}: некорректный код символа`, detail: 'Ключ глифа должен быть допустимым Unicode code point.' });

    const width = Number(glyph?.advanceWidth);
    if (!Number.isFinite(width) || width < 100 || width > 1800) errors.push({ code: 'width', title: `${char}: некорректная ширина`, detail: 'Ожидается ширина от 100 до 1800 units.' });

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, points = 0;
    const strokes = Array.isArray(glyph?.strokes) ? glyph.strokes : [];
    if (glyph?.strokes != null && !Array.isArray(glyph.strokes)) errors.push({ code: 'strokes', title: `${char}: повреждённые штрихи`, detail: 'Список штрихов должен быть массивом.' });
    for (const stroke of strokes) {
      if (!stroke || typeof stroke !== 'object') {
        errors.push({ code: 'stroke', title: `${char}: повреждённый штрих`, detail: 'Найден некорректный объект штриха.' });
        continue;
      }
      const strokeWidth = Number(stroke.width || 70);
      if (!Number.isFinite(strokeWidth) || strokeWidth <= 0 || strokeWidth > 400) errors.push({ code: 'stroke', title: `${char}: некорректная толщина штриха`, detail: 'Толщина должна быть положительной и не превышать 400 units.' });
      if (stroke.points != null && !Array.isArray(stroke.points)) {
        errors.push({ code: 'points', title: `${char}: повреждённые точки штриха`, detail: 'Список точек должен быть массивом.' });
        continue;
      }
      for (const point of stroke.points || []) {
        points++;
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) { errors.push({ code: 'point', title: `${char}: некорректные координаты`, detail: 'Найдена точка с некорректными координатами.' }); continue; }
        minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x); minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
      }
    }

    const outlines = Array.isArray(glyph?.outlines) ? glyph.outlines : [];
    if (glyph?.outlines != null && !Array.isArray(glyph.outlines)) errors.push({ code: 'outlines', title: `${char}: повреждённые контуры`, detail: 'Список контуров должен быть массивом.' });
    for (const contour of outlines) {
      if (!Array.isArray(contour) || contour.length < 3) {
        errors.push({ code: 'outline', title: `${char}: повреждённый контур`, detail: 'Векторный контур должен содержать не менее трёх точек.' });
        continue;
      }
      for (const point of contour) {
        points++;
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) { errors.push({ code: 'point', title: `${char}: некорректные координаты`, detail: 'Найдена точка контура с некорректными координатами.' }); continue; }
        minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x); minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
      }
    }

    if (points < 2) warnings.push({ code: 'short', title: `${char}: слишком мало точек`, detail: 'Проверьте отображение символа после экспорта.' });
    if (points && (minY < -200 || maxY > 800)) warnings.push({ code: 'height', title: `${char}: за пределами высотных метрик`, detail: `Диапазон ${Math.round(minY)}…${Math.round(maxY)} units; базовая линия 0.` });
    if (points && (minX < -40 || maxX > width)) warnings.push({ code: 'spacing', title: `${char}: проверьте ширину и интервалы`, detail: `Штрихи или контуры выходят за ширину ${width} units или слишком близки к границе.` });
  }

  if (!isText(project?.familyName)) errors.push({ code: 'family', title: 'Не задано название шрифта', detail: 'Укажите название семейства.' });
  if (!isText(project?.metadata?.author)) warnings.push({ code: 'author', title: 'Не указан автор', detail: 'Добавьте имя автора/правообладателя.' });
  if (!isText(project?.metadata?.version)) warnings.push({ code: 'version', title: 'Не указана версия', detail: 'Укажите версию, например 1.000.' });
  if (project?.metadata?.license !== 'SIL Open Font License 1.1') warnings.push({ code: 'license', title: 'Проверьте лицензию', detail: 'Для нового семейства, отправляемого в Google Fonts, требуется OFL 1.1; подтвердите право её применять.' });
  return { errors, warnings, checkedGlyphs: drawn.length, missingCount: missing.length, ready: errors.length === 0 && warnings.length === 0 };
}
