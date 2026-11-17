import { downloadBlob, safeFilename } from './font.js';

/* Конвертер TTF -> WOFF через встроенный CompressionStream. */
async function deflateBytes(bytes) {
  if (typeof CompressionStream === 'undefined') return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}
const pad4 = n => (n + 3) & ~3;

export async function ttfToWoff(ttfBuffer) {
  const ttf = new Uint8Array(ttfBuffer);
  const view = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  const flavor = view.getUint32(0);
  const numTables = view.getUint16(4);
  const entries = [];
  let totalSfntSize = 12 + 16 * numTables;
  for (let i = 0; i < numTables; i++) {
    const at = 12 + i * 16;
    const tag = ttf.slice(at, at + 4);
    const checksum = view.getUint32(at + 4);
    const offset = view.getUint32(at + 8);
    const length = view.getUint32(at + 12);
    entries.push({ tag, checksum, offset, length });
    totalSfntSize += pad4(length);
  }
  const compressed = [];
  for (const entry of entries) {
    const data = ttf.slice(entry.offset, entry.offset + entry.length);
    let comp = await deflateBytes(data);
    if (comp.length >= data.length) comp = data;
    compressed.push({ ...entry, comp, origLength: entry.length });
  }
  const dataStart = 44 + 20 * numTables;
  let totalLength = dataStart;
  for (const item of compressed) totalLength += pad4(item.comp.length);
  const out = new Uint8Array(totalLength);
  const ov = new DataView(out.buffer);
  out.set([0x77, 0x4f, 0x46, 0x46], 0);
  ov.setUint32(4, flavor);
  ov.setUint32(8, totalLength);
  ov.setUint16(12, numTables);
  ov.setUint16(14, 0);
  ov.setUint32(16, totalSfntSize);
  ov.setUint16(20, 1);
  ov.setUint16(22, 0);
  let cursor = dataStart;
  compressed.forEach((item, i) => {
    const at = 44 + i * 20;
    out.set(item.tag, at);
    ov.setUint32(at + 4, cursor);
    ov.setUint32(at + 8, item.comp.length);
    ov.setUint32(at + 12, item.origLength);
    ov.setUint32(at + 16, item.checksum);
    out.set(item.comp, cursor);
    cursor += pad4(item.comp.length);
  });
  return out;
}

export function supportsWoff() { return typeof CompressionStream !== 'undefined'; }

export async function exportFontFile(font, familyName, styleName, format) {
  const base = `${safeFilename(familyName)}-${styleName.toLowerCase().replace(/\\s+/g, '-')}`;
  const ttf = font.toArrayBuffer();
  if (format === 'woff') {
    if (!supportsWoff()) throw new Error('Этот браузер не поддерживает создание WOFF. Обновите браузер или скачайте TTF.');
    const woff = await ttfToWoff(ttf);
    downloadBlob(new Blob([woff], { type: 'font/woff' }), `${base}.woff`);
    return;
  }
  downloadBlob(new Blob([ttf], { type: 'font/ttf' }), `${base}.ttf`);
}

export async function buildDistributionFiles(project, buildFont, styles, extras) {
  const files = [];
  for (const style of styles) {
    const font = buildFont(project, style);
    const base = `${safeFilename(project.familyName)}-${style.toLowerCase().replace(/\\s+/g, '-')}`;
    const ttf = font.toArrayBuffer();
    files.push({ name: `fonts/ttf/${base}.ttf`, data: ttf });
    if (supportsWoff()) {
      try {
        const woff = await ttfToWoff(ttf);
        files.push({ name: `fonts/woff/${base}.woff`, data: woff });
      } catch { /* TTF остаётся доступным, даже если WOFF не удалось создать. */ }
    }
  }
  for (const extra of extras) files.push(extra);
  return files;
}
