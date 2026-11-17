import { CHARSET_GROUPS } from './project.js';

const requiredChars = [...new Set(CHARSET_GROUPS.flatMap(group => [...group.chars]))];

export function validateProject(project) {
  const errors = [], warnings = [], glyphs = project?.glyphs || {};
  const hasDrawing = glyph => Boolean(glyph?.strokes?.length || glyph?.outlines?.length);
  const missing = requiredChars.filter(char => char !== ' ' && !hasDrawing(glyphs[char.codePointAt(0)]));
  if (missing.length) warnings.push({ code: 'coverage', title: `Не нарисовано символов: ${missing.length}`, detail: missing.slice(0, 45).join(' ') + (missing.length > 45 ? ' …' : '') });

  const drawn = Object.entries(glyphs).filter(([, glyph]) => hasDrawing(glyph));
  if (!drawn.length) errors.push({ code: 'empty', title: 'Нет нарисованных символов', detail: 'Нарисуйте или импортируйте хотя бы один символ перед экспортом.' });

  for (const [code, glyph] of drawn) {
    const char = String.fromCodePoint(Number(code)), width = Number(glyph.advanceWidth);
    if (!Number.isFinite(width) || width < 100 || width > 1800) errors.push({ code: 'width', title: `${char}: некорректная ширина`, detail: 'Ожидается ширина от 100 до 1800 units.' });

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, points = 0;
    for (const stroke of glyph.strokes || []) {
      const strokeWidth = Number(stroke.width || 70);
      if (!Number.isFinite(strokeWidth) || strokeWidth <= 0 || strokeWidth > 400) errors.push({ code: 'stroke', title: `${char}: некорректная толщина штриха`, detail: 'Толщина должна быть положительной и не превышать 400 units.' });
      for (const point of stroke.points || []) {
        points++;
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) { errors.push({ code: 'point', title: `${char}: некорректные координаты`, detail: 'Найдена точка с некорректными координатами.' }); continue; }
        minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x); minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
      }
    }
    for (const contour of glyph.outlines || []) {
      if (!Array.isArray(contour) || contour.length < 3) {
        errors.push({ code: 'outline', title: `${char}: повреждённый контур`, detail: 'Векторный контур должен содержать не менее трёх точек.' });
        continue;
      }
      for (const point of contour) {
        points++;
        if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) { errors.push({ code: 'point', title: `${char}: некорректные координаты`, detail: 'Найдена точка контура с некорректными координатами.' }); continue; }
        minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x); minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
      }
    }
    if (points < 2) warnings.push({ code: 'short', title: `${char}: слишком мало точек`, detail: 'Проверьте отображение символа после экспорта.' });
    if (minY < -200 || maxY > 800) warnings.push({ code: 'height', title: `${char}: за пределами высотных метрик`, detail: `Диапазон ${Math.round(minY)}…${Math.round(maxY)} units; базовая линия 0.` });
    if (minX < -40 || maxX > width) warnings.push({ code: 'spacing', title: `${char}: проверьте ширину и интервалы`, detail: `Штрихи или контуры выходят за ширину ${width} units или слишком близки к границе.` });
  }

  if (!project?.familyName?.trim()) errors.push({ code: 'family', title: 'Не задано название шрифта', detail: 'Укажите название семейства.' });
  if (!project?.metadata?.author?.trim()) warnings.push({ code: 'author', title: 'Не указан автор', detail: 'Добавьте имя автора/правообладателя.' });
  if (!project?.metadata?.version?.trim()) warnings.push({ code: 'version', title: 'Не указана версия', detail: 'Укажите версию, например 1.000.' });
  if (project?.metadata?.license !== 'SIL Open Font License 1.1') warnings.push({ code: 'license', title: 'Проверьте лицензию', detail: 'Для нового семейства, отправляемого в Google Fonts, требуется OFL 1.1; подтвердите право её применять.' });
  return { errors, warnings, checkedGlyphs: drawn.length, missingCount: missing.length, ready: errors.length === 0 && warnings.length === 0 };
}
