import { CHARSET_GROUPS } from './project.js';

export const SHEET_COLUMNS = 4;
export const SHEET_ROWS = 6;
export const CELLS_PER_PAGE = SHEET_COLUMNS * SHEET_ROWS;
export const WORKSHEET_CHARS = [...new Set(CHARSET_GROUPS.flatMap(group => [...group.chars]).filter(char => char !== ' '))];
export const SHEET_PAGES = Array.from({ length: Math.ceil(WORKSHEET_CHARS.length / CELLS_PER_PAGE) }, (_, index) => WORKSHEET_CHARS.slice(index * CELLS_PER_PAGE, (index + 1) * CELLS_PER_PAGE));
export const PAGE_WIDTH = 1000;
export const PAGE_HEIGHT = 1414;

export function worksheetPageSvg(chars, pageNumber, totalPages) {
  const left = 44, top = 184, cellW = 228, cellH = 190, boxInsetX = 12, boxInsetY = 29;
  const cells = chars.map((char, index) => {
    const col = index % SHEET_COLUMNS, row = Math.floor(index / SHEET_COLUMNS);
    const x = left + col * cellW, y = top + row * cellH;
    const bx = x + boxInsetX, by = y + boxInsetY, bw = cellW - boxInsetX * 2, bh = cellH - boxInsetY - 12;
    return `<g><text x="${x + 4}" y="${y + 19}" class="char">${escapeXml(char)}</text><rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="4" class="cell"/><line x1="${bx}" y1="${by + bh * .72}" x2="${bx + bw}" y2="${by + bh * .72}" class="guide"/><text x="${bx + 5}" y="${by + bh - 5}" class="hint">Нарисуйте символ внутри рамки</text></g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}"><style>text{font-family:Arial,sans-serif}.title{font-size:30px;font-weight:bold;fill:#17191e}.sub{font-size:14px;fill:#555b66}.char{font-size:19px;font-weight:bold;fill:#313641}.cell{fill:#fff;stroke:#252a32;stroke-width:2}.guide{stroke:#b9c9df;stroke-width:1;stroke-dasharray:6 5}.hint{font-size:9px;fill:#9aa0aa}</style><rect width="100%" height="100%" fill="#fff"/><text x="46" y="58" class="title">HandFont Studio — бланк для рукописного шрифта</text><text x="46" y="88" class="sub">Пишите тёмной ручкой по одному символу в ячейке. Не выходите за рамки; сканируйте всю страницу ровно.</text><text x="46" y="116" class="sub">Страница ${pageNumber} из ${totalPages} • После заполнения загрузите скан в редактор.</text><path d="M24 24h34v5H29v29h-5z M976 24h-34v5h29v29h5z M24 1390h5v-29h29v-5H24z M976 1390h-5v-29h-29v-5h34z" fill="#111"/>${cells}<text x="46" y="1378" class="sub">Лицензия на создаваемый шрифт и правообладание определяются автором проекта.</text></svg>`;
}
function escapeXml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]); }

export function openWorksheetPrint() {
  const pages = SHEET_PAGES.map((chars, index) => worksheetPageSvg(chars, index + 1, SHEET_PAGES.length));
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Бланк HandFont Studio</title><style>@page{size:A4 portrait;margin:0}*{box-sizing:border-box}body{margin:0}.page{width:210mm;height:297mm;page-break-after:always;break-after:page}.page:last-child{page-break-after:auto;break-after:auto}.page svg{width:210mm;height:297mm;display:block}@media screen{body{background:#ddd}.page{margin:12px auto;box-shadow:0 2px 12px #777}}</style>${pages.map(svg => `<section class="page">${svg}</section>`).join('')}<script>window.onload=()=>setTimeout(()=>window.print(),500)<\/script></html>`;
  const popup = window.open('', '_blank');
  if (!popup) throw new Error('Разрешите всплывающие окна, чтобы открыть бланк для печати.');
  popup.document.open(); popup.document.write(html); popup.document.close();
}

const layout = { left: 44, top: 184, cellW: 228, cellH: 190, boxInsetX: 12, boxInsetY: 29, columns: SHEET_COLUMNS };

export async function scanWorksheetFile(file, pageIndex) {
  if (!file || !/^image\//.test(file.type)) throw new Error('Выберите изображение скана или фотографии (PNG/JPG/WebP).');
  const image = await createImageBitmap(file);
  const source = document.createElement('canvas');
  source.width = PAGE_WIDTH; source.height = PAGE_HEIGHT;
  const sourceContext = source.getContext('2d', { willReadFrequently: true });
  sourceContext.fillStyle = '#fff'; sourceContext.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  // Assumes the complete page is visible and photographed/scanned nearly straight-on.
  sourceContext.drawImage(image, 0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  image.close?.();
  const chars = SHEET_PAGES[pageIndex];
  if (!chars) throw new Error('Неверно выбрана страница бланка.');
  const result = [];
  for (let index = 0; index < chars.length; index++) {
    const col = index % layout.columns, row = Math.floor(index / layout.columns);
    const x = Math.round(layout.left + col * layout.cellW + layout.boxInsetX + 7);
    const y = Math.round(layout.top + row * layout.cellH + layout.boxInsetY + 7);
    const width = Math.round(layout.cellW - layout.boxInsetX * 2 - 14);
    const height = Math.round(layout.cellH - layout.boxInsetY - 24);
    const pixels = sourceContext.getImageData(x, y, width, height).data;
    // Downsample to a 96x96 grid, dropping faint print/grid marks and scanner noise.
    const gridSize = 96, mask = Array.from({ length: gridSize }, () => new Uint8Array(gridSize));
    let ink = 0;
    for (let gy = 0; gy < gridSize; gy++) for (let gx = 0; gx < gridSize; gx++) {
      const sx = Math.min(width - 1, Math.floor((gx + .5) * width / gridSize));
      const sy = Math.min(height - 1, Math.floor((gy + .5) * height / gridSize));
      const offset = (sy * width + sx) * 4;
      const luminance = .299 * pixels[offset] + .587 * pixels[offset + 1] + .114 * pixels[offset + 2];
      if (luminance < 105) { mask[gy][gx] = 1; ink++; }
    }
    if (ink < 7) continue;
    const outlines = [];
    // Trace dark pixel runs as tiny filled vector rectangles: keeps the scan recognizable,
    // but outlines may need cleanup in a dedicated font editor before publication.
    for (let gy = 0; gy < gridSize; gy++) {
      let gx = 0;
      while (gx < gridSize) {
        if (!mask[gy][gx]) { gx++; continue; }
        const start = gx;
        while (gx < gridSize && mask[gy][gx]) gx++;
        const x1 = 90 + start / gridSize * 620, x2 = 90 + gx / gridSize * 620;
        const yTop = 90 + (1 - gy / gridSize) * 620, yBottom = 90 + (1 - (gy + 1) / gridSize) * 620;
        outlines.push([{ x: x1, y: yTop }, { x: x1, y: yBottom }, { x: x2, y: yBottom }, { x: x2, y: yTop }]);
      }
    }
    result.push({ code: chars[index].codePointAt(0), char: chars[index], advanceWidth: 800, strokes: [], outlines, importedFromWorksheet: true });
  }
  if (!result.length) throw new Error('В ячейках не найдено до��таточно тёмных линий. Используйте контрастную ручку и проверьте, что загружена правильная страница целиком.');
  return result;
}
