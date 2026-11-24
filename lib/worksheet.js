import { CHARSET_GROUPS } from './project.js';

export const SHEET_COLUMNS = 4;
export const SHEET_ROWS = 6;
export const CELLS_PER_PAGE = SHEET_COLUMNS * SHEET_ROWS;
export const WORKSHEET_CHARS = [...new Set(CHARSET_GROUPS.flatMap(group => [...group.chars]).filter(char => char !== ' '))];
export const SHEET_PAGES = Array.from({ length: Math.ceil(WORKSHEET_CHARS.length / CELLS_PER_PAGE) }, (_, index) => WORKSHEET_CHARS.slice(index * CELLS_PER_PAGE, (index + 1) * CELLS_PER_PAGE));
export const PAGE_WIDTH = 1000;
export const PAGE_HEIGHT = 1414;

const LAYOUT = { left: 44, top: 184, cellW: 228, cellH: 190, boxInsetX: 12, boxInsetY: 29 };
const BASELINE_RATIO = 0.72;

// Угловые L-метки: их центры — опорные точки для выравнивания скана/фото.
const MARKS = [
  { parts: [[24, 24, 34, 5], [24, 29, 5, 29]], corner: 'TL' },
  { parts: [[942, 24, 34, 5], [971, 29, 5, 29]], corner: 'TR' },
  { parts: [[942, 1385, 34, 5], [971, 1356, 5, 29]], corner: 'BR' },
  { parts: [[24, 1385, 34, 5], [24, 1356, 5, 29]], corner: 'BL' }
];
function markCenter(mark) {
  let area = 0, cx = 0, cy = 0;
  for (const [x, y, w, h] of mark.parts) { area += w * h; cx += (x + w / 2) * w * h; cy += (y + h / 2) * w * h; }
  return { x: cx / area, y: cy / area };
}
export const MARK_CENTERS = MARKS.map(markCenter);

function cellRect(index) {
  const col = index % SHEET_COLUMNS, row = Math.floor(index / SHEET_COLUMNS);
  const x = LAYOUT.left + col * LAYOUT.cellW, y = LAYOUT.top + row * LAYOUT.cellH;
  const bx = x + LAYOUT.boxInsetX, by = y + LAYOUT.boxInsetY;
  const bw = LAYOUT.cellW - LAYOUT.boxInsetX * 2, bh = LAYOUT.cellH - LAYOUT.boxInsetY - 12;
  return { bx, by, bw, bh, labelX: x + 4, labelY: y + 19 };
}

function escapeXml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]); }

export function worksheetPageSvg(chars, pageNumber, totalPages) {
  const cells = chars.map((char, index) => {
    const { bx, by, bw, bh, labelX, labelY } = cellRect(index);
    return `<g><text x="${labelX}" y="${labelY}" class="char">${escapeXml(char)}</text><rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="4" class="cell"/><line x1="${bx}" y1="${by + bh * BASELINE_RATIO}" x2="${bx + bw}" y2="${by + bh * BASELINE_RATIO}" class="guide"/><text x="${bx + 5}" y="${by + bh - 5}" class="hint">Пишите внутри рамки, на линии</text></g>`;
  }).join('');
  const marks = MARKS.map(mark => mark.parts.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#111"/>`).join('')).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}"><style>text{font-family:Arial,sans-serif}.title{font-size:30px;font-weight:bold;fill:#17191e}.sub{font-size:14px;fill:#555b66}.char{font-size:19px;font-weight:bold;fill:#313641}.cell{fill:#fff;stroke:#252a32;stroke-width:2}.guide{stroke:#b9c9df;stroke-width:1;stroke-dasharray:6 5}.hint{font-size:9px;fill:#9aa0aa}</style><rect width="100%" height="100%" fill="#fff"/><text x="46" y="58" class="title">HandFont Studio — бланк для рукописного шрифта</text><text x="46" y="88" class="sub">Пишите тёмной ручкой по одному символу в ячейке. Базовая линия — пунктир. Не закрывайте чёрные уголки.</text><text x="46" y="116" class="sub">Страница ${pageNumber} из ${totalPages} • Сфотографируйте лист целиком и ровно, при хорошем свете.</text>${marks}${cells}<text x="46" y="1378" class="sub">Чёрные уголки нужны для выравнивания — не рисуйте на них и не обрезайте.</text></svg>`;
}

export function openWorksheetPrint() {
  const pages = SHEET_PAGES.map((chars, index) => worksheetPageSvg(chars, index + 1, SHEET_PAGES.length));
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Бланк HandFont Studio</title><style>@page{size:A4 portrait;margin:0}*{box-sizing:border-box}body{margin:0}.page{width:210mm;height:297mm;page-break-after:always;break-after:page}.page:last-child{page-break-after:auto;break-after:auto}.page svg{width:210mm;height:297mm;display:block}@media screen{body{background:#ddd}.page{margin:12px auto;box-shadow:0 2px 12px #777}}</style>${pages.map(svg => `<section class="page">${svg}</section>`).join('')}<script>window.onload=()=>setTimeout(()=>window.print(),500)<\/script></html>`;
  const popup = window.open('', '_blank');
  if (!popup) throw new Error('Разрешите всплывающие окна, чтобы открыть бланк для печати.');
  popup.document.open(); popup.document.write(html); popup.document.close();
}

export function downloadWorksheetSvg(pageIndex) {
  const chars = SHEET_PAGES[pageIndex];
  if (!chars) throw new Error('Нет такой страницы бланка.');
  const svg = worksheetPageSvg(chars, pageIndex + 1, SHEET_PAGES.length);
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `handfont-blank-stranica-${pageIndex + 1}.svg`;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ================= Распознавание скана ================= */

function isPdfFile(file) {
  return file?.type === 'application/pdf' || /\.pdf$/i.test(file?.name || '');
}

export const MAX_WORKSHEET_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_WORKSHEET_IMAGE_DIMENSION = 12000;
export const MAX_WORKSHEET_IMAGE_PIXELS = 40_000_000;

// Проверка размера выполняется до чтения файла в память и до передачи его декодеру.
export function validateWorksheetFile(file) {
  if (!file) throw new Error('Выберите PDF-бланк или изображение скана.');
  if (Number.isFinite(file.size) && file.size > MAX_WORKSHEET_FILE_BYTES) {
    throw new Error('Файл слишком большой (максимум 25 МБ). Уменьшите размер скана или сохраните PDF с меньшим разрешением.');
  }
  if (!isPdfFile(file) && !/^image\//.test(file.type || '')) {
    throw new Error('Выберите PDF-бланк или изображение скана (PNG/JPG/WebP).');
  }
  return true;
}

function validateWorksheetImageDimensions(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error('Изображение пустое или повреждённое.');
  }
  if (width > MAX_WORKSHEET_IMAGE_DIMENSION || height > MAX_WORKSHEET_IMAGE_DIMENSION ||
      width * height > MAX_WORKSHEET_IMAGE_PIXELS) {
    throw new Error('Разрешение изображения слишком большое. Максимум — 12 000 пикселей по стороне и 40 мегапикселей. Уменьшите фото и загрузите его снова.');
  }
  return true;
}

export async function getWorksheetPdfPageCount(file) {
  validateWorksheetFile(file);
  if (!isPdfFile(file)) return 1;
  let pdfjs;
  try {
    const [module, workerModule] = await Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    ]);
    pdfjs = module;
    pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;
  } catch {
    throw new Error('Не удалось подготовить чтение PDF. Обновите приложение и попробуйте снова.');
  }
  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
  try {
    const pdf = await loadingTask.promise;
    return pdf.numPages;
  } finally {
    await loadingTask.destroy();
  }
}

async function rasterizeWorksheetFile(file, pageIndex) {
  validateWorksheetFile(file);
  if (isPdfFile(file)) {
    let pdfjs;
    try {
      const [pdfModule, workerModule] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url')
      ]);
      // Не затеняем внешнюю переменную: она нужна ниже для getDocument().
      pdfjs = pdfModule;
      // Vite отдаёт worker отдельным ресурсом, чтобы PDF.js работал и на мобильных устройствах.
      pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;
    } catch (error) {
      throw new Error('Не удалось подготовить чтение PDF. Обновите приложение и попробуйте снова.');
    }
    const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
    let pdf;
    try {
      pdf = await loadingTask.promise;
      // Поддерживаем и полный семистраничный PDF, и отдельный PDF/скан одной выбранной страницы бланка.
      const pdfPageNumber = pdf.numPages === 1 ? 1 : pageIndex + 1;
      if (pdfPageNumber < 1 || pdfPageNumber > pdf.numPages) {
        throw new Error(`В PDF ${pdf.numPages} стр. Для страницы бланка ${pageIndex + 1} нужна соответствующая страница PDF либо отдельный одностраничный файл.`);
      }
      const page = await pdf.getPage(pdfPageNumber);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2, 1600 / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Браузер не смог создать холст для обработки PDF.');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;
      return canvas;
    } finally {
      await loadingTask.destroy();
    }
  }

  if (!/^image\//.test(file?.type || '')) {
    throw new Error('Выберите PDF-бланк или изображение скана (PNG/JPG/WebP).');
  }
  let bitmap;
  if (typeof createImageBitmap === 'function') {
    bitmap = await createImageBitmap(file);
  } else {
    bitmap = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось открыть изображение.')); };
      img.src = url;
    });
  }
  const naturalW = bitmap.width || bitmap.naturalWidth;
  const naturalH = bitmap.height || bitmap.naturalHeight;
  try {
    validateWorksheetImageDimensions(naturalW, naturalH);
  } catch (error) {
    if (bitmap.close) bitmap.close();
    throw error;
  }
  const scale = Math.min(1, 1600 / Math.max(naturalW, naturalH));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(naturalW * scale));
  canvas.height = Math.max(1, Math.round(naturalH * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Браузер не смог создать холст для обработки изображения.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if (bitmap.close) bitmap.close();
  return canvas;
}

export async function previewWorksheetFile(file, pageIndex = 0) {
  const canvas = await rasterizeWorksheetFile(file, pageIndex);
  return canvas.toDataURL('image/jpeg', 0.82);
}

function otsuThreshold(gray, w, h) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < w * h; i++) hist[gray[i]]++;
  const total = w * h;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, weightB = 0, best = 128, bestVar = -1;
  for (let t = 0; t < 256; t++) {
    weightB += hist[t];
    if (!weightB) continue;
    const weightF = total - weightB;
    if (!weightF) break;
    sumB += t * hist[t];
    const meanB = sumB / weightB, meanF = (sum - sumB) / weightF;
    const between = weightB * weightF * (meanB - meanF) * (meanB - meanF);
    if (between > bestVar) { bestVar = between; best = t; }
  }
  return best;
}

function findMark(mask, w, h, corner) {
  const win = Math.round(Math.min(w, h) * 0.14);
  const x0 = corner === 'TL' || corner === 'BL' ? 0 : w - win;
  const y0 = corner === 'TL' || corner === 'TR' ? 0 : h - win;
  const x1 = Math.min(w, x0 + win), y1 = Math.min(h, y0 + win);
  const seen = new Uint8Array((x1 - x0) * (y1 - y0));
  const regionW = x1 - x0;
  const minPixels = Math.max(12, Math.round(win * win * 0.0015));
  let best = null;

  // Ищем отдельную связанную чёрную область. Нельзя усреднять все пиксели
  // угла: туда попадают заголовок и подписи, которые смещают опорную точку.
  for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) {
    const start = (sy - y0) * regionW + (sx - x0);
    if (!mask[sy * w + sx] || seen[start]) continue;

    const queue = [start];
    seen[start] = 1;
    let head = 0, count = 0, sumX = 0, sumY = 0;
    let minX = sx, maxX = sx, minY = sy, maxY = sy;

    while (head < queue.length) {
      const pos = queue[head++];
      const x = x0 + (pos % regionW), y = y0 + Math.floor(pos / regionW);
      count++; sumX += x; sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < x0 || nx >= x1 || ny < y0 || ny >= y1) continue;
        const ni = (ny - y0) * regionW + (nx - x0);
        if (!seen[ni] && mask[ny * w + nx]) {
          seen[ni] = 1;
          queue.push(ni);
        }
      }
    }

    const boxW = maxX - minX + 1, boxH = maxY - minY + 1;
    const fill = count / (boxW * boxH);
    const ratio = boxW / boxH;
    // L-метка занимает заметную площадь и имеет примерно квадратную рамку.
    if (count < minPixels || boxW < win * 0.07 || boxH < win * 0.07) continue;
    if (fill < 0.08 || fill > 0.7 || ratio < 0.45 || ratio > 2.2) continue;
    if (!best || count > best.count) best = { count, x: sumX / count, y: sumY / count };
  }

  return best ? { x: best.x, y: best.y } : null;
}

function makeMapper(found) {
  const names = ['TL', 'TR', 'BR', 'BL'];
  const present = names.filter(name => found[name]);
  if (present.length === 4) {
    const [tl, tr, br, bl] = names.map(name => found[name]);
    const [rTL, rTR, rBR, rBL] = MARK_CENTERS;
    const spanX = rTR.x - rTL.x, spanY = rBL.y - rTL.y;
    const mapper = (px, py) => {
      const u = (px - rTL.x) / spanX, v = (py - rTL.y) / spanY;
      return {
        x: (1 - u) * (1 - v) * tl.x + u * (1 - v) * tr.x + u * v * br.x + (1 - u) * v * bl.x,
        y: (1 - u) * (1 - v) * tl.y + u * (1 - v) * tr.y + u * v * br.y + (1 - u) * v * bl.y
      };
    };
    mapper.alignmentMode = 'four-mark';
    return mapper;
  }

  // Если одна метка потеряна на фото/скане, три оставшиеся задают
  // однозначное аффинное преобразование. Оно устойчиво для ровного листа
  // и умеренного наклона; при сильной перспективе точность ниже.
  if (present.length === 3) {
    const anchors = present.map(name => ({
      source: MARK_CENTERS[names.indexOf(name)],
      target: found[name]
    }));
    const [p1, p2, p3] = anchors.map(item => [item.source.x, item.source.y, 1]);
    const determinant = p1[0] * (p2[1] - p3[1]) + p2[0] * (p3[1] - p1[1]) + p3[0] * (p1[1] - p2[1]);
    if (Math.abs(determinant) < 1e-6) return null;
    const solve = values => {
      const [v1, v2, v3] = values;
      return [
        (v1 * (p2[1] - p3[1]) + v2 * (p3[1] - p1[1]) + v3 * (p1[1] - p2[1])) / determinant,
        (v1 * (p3[0] - p2[0]) + v2 * (p1[0] - p3[0]) + v3 * (p2[0] - p1[0])) / determinant,
        (v1 * (p2[0] * p3[1] - p3[0] * p2[1]) + v2 * (p3[0] * p1[1] - p1[0] * p3[1]) + v3 * (p1[0] * p2[1] - p2[0] * p1[1])) / determinant
      ];
    };
    const ax = solve(anchors.map(item => item.target.x));
    const ay = solve(anchors.map(item => item.target.y));
    const mapper = (px, py) => ({ x: ax[0] * px + ax[1] * py + ax[2], y: ay[0] * px + ay[1] * py + ay[2] });
    mapper.alignmentMode = 'three-mark-affine';
    return mapper;
  }
  return null;
}

function traceMask(v, w, h) {
  const segs = new Map();
  const key = (x, y) => x + '_' + y;
  const add = (a, b) => {
    const k = key(a[0], a[1]);
    if (!segs.has(k)) segs.set(k, []);
    segs.get(k).push(b);
  };
  const V = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : v[y * w + x];
  for (let y = -1; y < h; y++) for (let x = -1; x < w; x++) {
    const idx = V(x, y) * 8 + V(x + 1, y) * 4 + V(x + 1, y + 1) * 2 + V(x, y + 1);
    if (idx === 0 || idx === 15) continue;
    const N = [x + .5, y], E = [x + 1, y + .5], S = [x + .5, y + 1], W = [x, y + .5];
    switch (idx) {
      case 1: add(S, W); break;
      case 2: add(E, S); break;
      case 3: add(E, W); break;
      case 4: add(N, E); break;
      case 5: add(N, E); add(S, W); break;
      case 6: add(N, S); break;
      case 7: add(N, W); break;
      case 8: add(W, N); break;
      case 9: add(S, N); break;
      case 10: add(W, N); add(E, S); break;
      case 11: add(E, N); break;
      case 12: add(W, E); break;
      case 13: add(S, E); break;
      case 14: add(W, S); break;
    }
  }
  const loops = [];
  segs.forEach((list, k) => {
    while (list.length) {
      const start = k.split('_').map(Number);
      const loop = [start];
      let next = list.pop(), guard = 500000, ok = false;
      while (guard--) {
        loop.push(next);
        const nk = key(next[0], next[1]);
        if (nk === k) { ok = true; break; }
        const l2 = segs.get(nk);
        if (!l2 || !l2.length) break;
        next = l2.pop();
      }
      if (ok && loop.length > 3) { loop.pop(); loops.push(loop); }
    }
  });
  return loops;
}

function perpDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
}
function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  let dmax = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax > eps) {
    const l = rdp(pts.slice(0, idx + 1), eps), r = rdp(pts.slice(idx), eps);
    return l.slice(0, -1).concat(r);
  }
  return [pts[0], pts[pts.length - 1]];
}
function simplifyClosed(pts, eps) {
  if (pts.length < 5) return pts;
  let far = 1, fd = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > fd) { fd = d; far = i; }
  }
  const s1 = rdp(pts.slice(0, far + 1), eps);
  const s2 = rdp(pts.slice(far).concat([pts[0]]), eps);
  return s1.slice(0, -1).concat(s2.slice(0, -1));
}
function contourArea(pts) {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  return s / 2;
}
function pointInContour(point, contour) {
  let inside = false;
  for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
    const a = contour[i], b = contour[j];
    if ((a.y > point.y) !== (b.y > point.y) &&
        point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export async function scanWorksheetFile(file, pageIndex, options = {}) {
  if (!file) throw new Error('Выберите PDF-бланк или изображение скана.');
  const chars = SHEET_PAGES[pageIndex];
  if (!chars) throw new Error('Неверно выбрана страница бланка.');
  const canvas = await rasterizeWorksheetFile(file, pageIndex);
  const w = canvas.width, h = canvas.height;
  if (w < 200 || h < 200) throw new Error('Страница слишком маленькая для распознавания.');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Браузер не смог прочитать изображение страницы.');
  const data = ctx.getImageData(0, 0, w, h).data;

  const gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = Math.round(.299 * data[i * 4] + .587 * data[i * 4 + 1] + .114 * data[i * 4 + 2]);
  }
  const globalThr = otsuThreshold(gray, w, h);
  const markThr = Math.min(globalThr, 120);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = gray[i] < markThr ? 1 : 0;

  const found = {
    TL: findMark(mask, w, h, 'TL'), TR: findMark(mask, w, h, 'TR'),
    BR: findMark(mask, w, h, 'BR'), BL: findMark(mask, w, h, 'BL')
  };
  const mapPage = makeMapper(found);
  const marksFound = Object.values(found).filter(Boolean).length;
  if (!mapPage) {
    throw new Error(`Найдены только ${marksFound} из 4 угловых меток. Сканирование остановлено, чтобы не распознать символы со смещением. Сфотографируйте весь бланк целиком, включая четыре чёрных уголка, или повысьте чувствительность распознавания.`);
  }
  const aligned = marksFound === 4;
  const alignmentMode = mapPage.alignmentMode || 'unknown';

  const sensitivity = Math.max(60, Math.min(200, Number(options.threshold) || 128));
  const result = [];
  const skipped = [];

  for (let index = 0; index < chars.length; index++) {
    const { bx, by, bw, bh } = cellRect(index);
    const inset = 7;
    const x0 = bx + inset, y0 = by + inset, x1 = bx + bw - inset, y1 = by + bh - inset;
    const gw = 132, gh = Math.max(40, Math.round(gw * (y1 - y0) / (x1 - x0)));
    const cellGray = new Uint8Array(gw * gh);
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      const px = x0 + (gx + .5) * (x1 - x0) / gw, py = y0 + (gy + .5) * (y1 - y0) / gh;
      const p = mapPage(px, py);
      const ix = Math.round(p.x), iy = Math.round(p.y);
      cellGray[gy * gw + gx] = (ix >= 0 && iy >= 0 && ix < w && iy < h) ? gray[iy * w + ix] : 255;
    }
    let thr = otsuThreshold(cellGray, gw, gh);
    thr = Math.max(50, Math.min(210, thr + (sensitivity - 128) * 0.5));
    const cellMask = new Uint8Array(gw * gh);
    let ink = 0;
    for (let i = 0; i < gw * gh; i++) { if (cellGray[i] < thr) { cellMask[i] = 1; ink++; } }
    if (ink < 14 || ink > gw * gh * 0.6) { skipped.push(chars[index]); continue; }

    const loops = traceMask(cellMask, gw, gh);
    if (!loops.length) { skipped.push(chars[index]); continue; }

    const baseRow = ((by + bh * BASELINE_RATIO) - y0) / (y1 - y0) * gh;
    const unitsPerCell = 700 / Math.max(1, baseRow);
    const outlines = [];
    let minX = Infinity, maxX = -Infinity;
    const candidates = loops.map(loop => {
      const simplified = simplifyClosed(loop, 1.1);
      if (simplified.length < 3) return null;
      const points = simplified.map(p => ({ x: Math.round(p[0] * unitsPerCell * 10) / 10, y: Math.round((baseRow - p[1]) * unitsPerCell * 10) / 10 }));
      return Math.abs(contourArea(points)) >= 60 ? points : null;
    }).filter(Boolean);
    for (const pts of candidates) {
      const depth = candidates.reduce((count, other) => other !== pts && pointInContour(pts[0], other) ? count + 1 : count, 0);
      // Для TTF: внешние контуры по часовой стрелке, внутренние отверстия — против.
      const wantPositive = depth % 2 === 1;
      if ((contourArea(pts) > 0) !== wantPositive) pts.reverse();
      for (const p of pts) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; }
      outlines.push(pts);
    }
    if (!outlines.length) { skipped.push(chars[index]); continue; }
    const shift = 60 - minX;
    for (const contour of outlines) for (const p of contour) p.x = Math.round((p.x + shift) * 10) / 10;
    const advanceWidth = Math.max(250, Math.min(1400, Math.round(maxX - minX + 120)));
    result.push({ code: chars[index].codePointAt(0), char: chars[index], advanceWidth, strokes: [], outlines, importedFromWorksheet: true });
  }

  if (!result.length) {
    throw new Error(mapPage
      ? 'В ячейках не найдено рукописных символов. Пишите тёмной ручкой и проверьте номер страницы бланка.'
      : 'Не удалось надёжно определить угловые метки. Сфотографируйте лист целиком, ровно, при хорошем свете — или повысьте чувствительность распознавания.');
  }
  return { glyphs: result, skipped, aligned, marksFound, alignmentMode };
                                                         }
