
import { CHARSET_GROUPS, METRICS } from './project.js';

const requiredChars = [
  ...new Set(
    CHARSET_GROUPS.flatMap(group => [...group.chars])
  )
];

function isValidCodePoint(code) {
  return (
    Number.isInteger(code) &&
    code >= 0 &&
    code <= 0x10FFFF &&
    !(code >= 0xD800 && code <= 0xDFFF)
  );
}

function hasDrawing(glyph) {
  return (
    Array.isArray(glyph?.strokes) && glyph.strokes.length > 0
  ) || (
    Array.isArray(glyph?.outlines) && glyph.outlines.length > 0
  );
}

function getCharLabel(code) {
  const numericCode = Number(code);

  if (!isValidCodePoint(numericCode)) {
    return `Код ${code}`;
  }

  return String.fromCodePoint(numericCode);
}

export function validateProject(project) {
  const errors = [];
  const warnings = [];

  const glyphs =
    project?.glyphs &&
    typeof project.glyphs === 'object' &&
    !Array.isArray(project.glyphs)
      ? project.glyphs
      : {};

  // Проверка полноты набора символов.
  const missing = requiredChars.filter(char => {
    if (char === ' ') return false;

    const code = char.codePointAt(0);
    return !hasDrawing(glyphs[String(code)]);
  });

  if (missing.length) {
    warnings.push({
      code: 'coverage',
      title: `Не нарисовано символов: ${missing.length}`,
      detail:
        missing.slice(0, 45).join(' ') +
        (missing.length > 45 ? ' …' : '')
    });
  }

  const entries = Object.entries(glyphs);

  const drawn = entries.filter(([, glyph]) =>
    hasDrawing(glyph)
  );

  if (!drawn.length) {
    errors.push({
      code: 'empty',
      title: 'Нет нарисованных символов',
      detail:
        'Нарисуйте или импортируйте хотя бы один символ перед экспортом.'
    });
  }

  // Проверка каждого символа.
  for (const [code, glyph] of entries) {
    const malformed =
      glyph &&
      typeof glyph === 'object' &&
      (
        (glyph.strokes !== undefined &&
          !Array.isArray(glyph.strokes)) ||
        (glyph.outlines !== undefined &&
          !Array.isArray(glyph.outlines))
      );

    if (!hasDrawing(glyph) && !malformed) continue;

    const numericCode = Number(code);
    const char = getCharLabel(code);

    if (
      !/^(0|[1-9]\d*)$/.test(code) ||
      !isValidCodePoint(numericCode)
    ) {
      errors.push({
        code: 'unicode',
        title: `${char}: некорректный Unicode`,
        detail:
          'Ключ символа должен быть допустимым целым кодом Unicode.'
      });
      continue;
    }

    if (
      !glyph ||
      typeof glyph !== 'object' ||
      Array.isArray(glyph)
    ) {
      errors.push({
        code: 'glyph',
        title: `${char}: некорректная запись символа`,
        detail: 'Данные символа должны быть объектом.'
      });
      continue;
    }

    const width = Number(glyph.advanceWidth);

    if (
      hasDrawing(glyph) &&
      (!Number.isFinite(width) || width < 100 || width > 1800)
    ) {
      errors.push({
        code: 'width',
        title: `${char}: некорректная ширина`,
        detail: 'Ожидается ширина от 100 до 1800 units.'
      });
    }

    if (
      glyph.strokes !== undefined &&
      !Array.isArray(glyph.strokes)
    ) {
      errors.push({
        code: 'strokes',
        title: `${char}: некорректные штрихи`,
        detail: 'Поле strokes должно быть массивом.'
      });
    }

    if (
      glyph.outlines !== undefined &&
      !Array.isArray(glyph.outlines)
    ) {
      errors.push({
        code: 'outlines',
        title: `${char}: некорректные контуры`,
        detail: 'Поле outlines должно быть массивом.'
      });
    }

    const strokes = Array.isArray(glyph.strokes)
      ? glyph.strokes
      : [];

    const outlines = Array.isArray(glyph.outlines)
      ? glyph.outlines
      : [];

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    let pointCount = 0;
    let invalidPointCount = 0;

    // Проверка обычных штрихов.
    for (const stroke of strokes) {
      if (!stroke || typeof stroke !== 'object') {
        errors.push({
          code: 'stroke',
          title: `${char}: повреждённый штрих`,
          detail: 'Найдена некорректная запись штриха.'
        });
        continue;
      }

      const strokeWidth = Number(stroke.width ?? 70);

      if (
        !Number.isFinite(strokeWidth) ||
        strokeWidth <= 0 ||
        strokeWidth > 400
      ) {
        errors.push({
          code: 'stroke-width',
          title: `${char}: некорректная толщина штриха`,
          detail:
            'Толщина должна быть положительной и не превышать 400 units.'
        });
      }

      if (!Array.isArray(stroke.points)) {
        errors.push({
          code: 'stroke-points',
          title: `${char}: отсутствуют точки штриха`,
          detail: 'Поле points должно быть массивом.'
        });
        continue;
      }

      for (const point of stroke.points) {
        pointCount++;

        if (
          !Number.isFinite(point?.x) ||
          !Number.isFinite(point?.y)
        ) {
          invalidPointCount++;
          continue;
        }

        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
      }
    }

    // Проверка импортированных контуров.
    for (const contour of outlines) {
      if (!Array.isArray(contour) || contour.length < 3) {
        errors.push({
          code: 'contour',
          title: `${char}: повреждённый контур`,
          detail:
            'Каждый контур должен содержать минимум три точки.'
        });
        continue;
      }

      for (const point of contour) {
        pointCount++;

        if (
          !Number.isFinite(point?.x) ||
          !Number.isFinite(point?.y)
        ) {
          invalidPointCount++;
          continue;
        }

        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
      }
    }

    if (invalidPointCount > 0) {
      errors.push({
        code: 'point',
        title: `${char}: некорректные координаты`,
        detail:
          `Найдено точек с некорректными координатами: ${invalidPointCount}.`
      });
    }

    if (pointCount < 2) {
      warnings.push({
        code: 'short',
        title: `${char}: слишком мало точек`,
        detail:
          'Проверьте отображение символа после экспорта.'
      });
    }

    // Проверка высоты относительно метрик проекта.
    if (
      Number.isFinite(minY) &&
      Number.isFinite(maxY) &&
      (
        minY < METRICS.descender ||
        maxY > METRICS.ascender
      )
    ) {
      warnings.push({
        code: 'height',
        title: `${char}: за пределами высотных метрик`,
        detail:
          `Диапазон ${Math.round(minY)}…${Math.round(maxY)} units; ` +
          `допустимый диапазон ${METRICS.descender}…${METRICS.ascender}.`
      });
    }

    // Проверка ширины и боковых интервалов.
    if (
      Number.isFinite(width) &&
      Number.isFinite(minX) &&
      Number.isFinite(maxX) &&
      (minX < -40 || maxX > width)
    ) {
      warnings.push({
        code: 'spacing',
        title: `${char}: проверьте ширину и интервалы`,
        detail:
          `Контуры или штрихи выходят за ширину ${width} units ` +
          'или слишком близки к границе.'
      });
    }
  }

  // Проверка сведений о шрифте.
  if (
    typeof project?.familyName !== 'string' ||
    !project.familyName.trim()
  ) {
    errors.push({
      code: 'family',
      title: 'Не задано название шрифта',
      detail: 'Укажите название семейства.'
    });
  }

  const author = project?.metadata?.author;
  if (typeof author !== 'string' || !author.trim()) {
    warnings.push({
      code: 'author',
      title: 'Не указан автор',
      detail: 'Добавьте имя автора или правообладателя.'
    });
  }

  const version = project?.metadata?.version;
  if (typeof version !== 'string' || !version.trim()) {
    warnings.push({
      code: 'version',
      title: 'Не указана версия',
      detail: 'Укажите версию, например 1.000.'
    });
  }

  const license = project?.metadata?.license;
  if (typeof license !== 'string' || !license.trim()) {
    warnings.push({
      code: 'license',
      title: 'Не указана лицензия',
      detail:
        'Укажите лицензию и убедитесь, что у вас есть право её применять.'
    });
  }

  return {
    errors,
    warnings,
    checkedGlyphs: drawn.length,
    missingCount: missing.length,
    ready: errors.length === 0 && warnings.length === 0
  };
}
