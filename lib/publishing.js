export const OFL_LICENSE = `SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide development of collaborative font projects, to support the font creation efforts of academic and linguistic communities, and to provide a free and open framework in which fonts may be shared and improved in partnership with others.

The OFL allows the licensed fonts to be used, studied, modified and redistributed freely as long as they are not sold by themselves. The fonts, including any derivative works, can be bundled, embedded, redistributed and/or sold with any software provided that any reserved names are not used by derivative works. The fonts and derivatives, however, cannot be released under any other type of license. The requirement for fonts to remain under this license does not apply to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright Holder(s) under this license and clearly marked as such. This may include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the copyright statement(s).

"Original Version" refers to the collection of Font Software components as distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting, or substituting -- in part or in whole -- any of the components of the Original Version, by changing formats or by porting the Font Software to a new environment.

"Author" refers to any designer, engineer, programmer, technical writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining a copy of the Font Software, to use, study, copy, merge, embed, modify, redistribute, and sell modified and unmodified copies of the Font Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components, in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled, redistributed and/or sold with any software, provided that each copy contains the above copyright notice and this license. These can be included either as stand-alone text files, human-readable headers or in the appropriate machine-readable metadata fields within text or binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font Name(s) unless explicit written permission is granted by the corresponding Copyright Holder. This restriction only applies to the primary font name as presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font Software shall not be used to promote, endorse or advertise any Modified Version, except to acknowledge the contribution(s) of the Copyright Holder(s) and the Author(s) or with their explicit written permission.

5) The Font Software, modified or unmodified, in part or in whole, must be distributed entirely under this license, and must not be distributed under any other license. The requirement for fonts to remain under this license does not apply to any document created using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM OTHER DEALINGS IN THE FONT SOFTWARE.
`;

const encoder = new TextEncoder();

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function w16(view, at, value) { view.setUint16(at, value, true); }
function w32(view, at, value) { view.setUint32(at, value >>> 0, true); }

export function createZip(files) {
  if (!Array.isArray(files)) throw new TypeError('Для ZIP нужен список файлов.');
  if (files.length > 0xffff) throw new Error('Слишком много файлов для ZIP без ZIP64.');
  const locals = [], centrals = [];
  const names = new Set();
  let offset = 0;
  for (const file of files) {
    if (!file || typeof file.name !== 'string' || !file.name.trim() || file.name.includes('\0')) {
      throw new Error('В ZIP обнаружено некорректное имя файла.');
    }
    const name = encoder.encode(file.name);
    if (name.length > 0xffff) throw new Error('Слишком длинное имя файла для ZIP.');
    if (names.has(file.name)) throw new Error(`Повторяющийся путь в ZIP: ${file.name}`);
    names.add(file.name);
    let data;
    if (typeof file.data === 'string') data = encoder.encode(file.data);
    else if (file.data instanceof ArrayBuffer) data = new Uint8Array(file.data);
    else if (ArrayBuffer.isView(file.data)) data = new Uint8Array(file.data.buffer, file.data.byteOffset, file.data.byteLength);
    else throw new TypeError(`Некорректные данные файла ZIP: ${file.name}`);
    if (data.length > 0xffffffff) throw new Error(`Файл слишком большой для ZIP без ZIP64: ${file.name}`);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    w32(lv, 0, 0x04034b50); w16(lv, 4, 20); w16(lv, 6, 0x0800); w16(lv, 8, 0);
    w32(lv, 14, crc); w32(lv, 18, data.length); w32(lv, 22, data.length); w16(lv, 26, name.length);
    local.set(name, 30); local.set(data, 30 + name.length);
    locals.push(local);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    w32(cv, 0, 0x02014b50); w16(cv, 4, 20); w16(cv, 6, 20); w16(cv, 8, 0x0800); w16(cv, 10, 0);
    w32(cv, 16, crc); w32(cv, 20, data.length); w32(cv, 24, data.length); w16(cv, 28, name.length); w32(cv, 42, offset);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
    if (offset > 0xffffffff) throw new Error('Архив слишком большой для ZIP без ZIP64.');
  }
  const centralSize = centrals.reduce((sum, item) => sum + item.length, 0);
  if (centralSize > 0xffffffff || offset + centralSize + 22 > 0xffffffff) {
    throw new Error('Архив слишком большой для ZIP без ZIP64.');
  }
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  w32(ev, 0, 0x06054b50); w16(ev, 8, files.length); w16(ev, 10, files.length);
  w32(ev, 12, centralSize); w32(ev, 16, offset);
  const output = new Uint8Array(offset + centralSize + 22);
  let cursor = 0;
  for (const item of locals) { output.set(item, cursor); cursor += item.length; }
  for (const item of centrals) { output.set(item, cursor); cursor += item.length; }
  output.set(end, cursor);
  return output;
}

const xml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);

function validOutline(contour) {
  return Array.isArray(contour) && contour.length >= 3 && contour.every(point => Number.isFinite(point?.x) && Number.isFinite(point?.y));
}
function hasDrawing(glyph) { return Boolean(glyph?.strokes?.length || glyph?.outlines?.some(validOutline)); }

function renderStrokes(strokes) {
  return (strokes || []).map(stroke => {
    const points = stroke?.points || [];
    if (!points.length) return '';
    const d = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
    return `<path d="${d}" fill="none" stroke="${xml(stroke.color || '#20242d')}" stroke-width="${stroke.width || 70}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('');
}
function renderOutlines(outlines) {
  const contours = (outlines || []).filter(validOutline);
  if (!contours.length) return '';
  const d = contours.map(contour => {
    const first = contour[0];
    const rest = contour.slice(1).map(point => `L ${point.x} ${point.y}`).join(' ');
    return `M ${first.x} ${first.y} ${rest} Z`;
  }).join(' ');
  return `<path d="${d}" fill="#20242d" fill-rule="evenodd"/>`;
}

export function fontSpecimenSvg(project, sampleText = 'HandFont Studio • Aa Бб 0123') {
  const chars = [...new Set([...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', ...sampleText])];
  const columns = 8, cellW = 105, cellH = 150;
  const rows = Math.ceil(chars.length / columns);
  const height = 120 + rows * cellH;
  const contents = chars.map((char, index) => {
    const glyph = project.glyphs?.[char.codePointAt(0)];
    const x = (index % columns) * cellW + 12;
    const y = Math.floor(index / columns) * cellH + 58;
    const drawing = renderStrokes(glyph?.strokes) + renderOutlines(glyph?.outlines);
    const missing = !hasDrawing(glyph);
    return `<g transform="translate(${x} ${y + 90}) scale(.12 -.12)">${drawing}</g><text x="${x}" y="${y + 124}" class="label">${xml(char)}${missing ? ' · missing' : ''}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="840" height="${height}" viewBox="0 0 840 ${height}"><style>text{font-family:Arial,sans-serif}.title{font-size:25px;font-weight:bold;fill:#181a20}.sub{font-size:12px;fill:#707581}.label{font-size:12px;fill:#858a95}</style><rect width="100%" height="100%" fill="#fff"/><text x="20" y="32" class="title">${xml(project.familyName || 'HandFont')}</text><text x="20" y="50" class="sub">${xml(project.metadata?.author || '')} • ${xml(project.metadata?.version || '1.000')}</text>${contents}</svg>`;
}

export function openSpecimenPrint(project, sampleText) {
  const svg = fontSpecimenSvg(project, sampleText);
  const html = `<!doctype html><html><meta charset="utf-8"><title>${xml(project.familyName)} specimen</title><style>body{font-family:Arial,sans-serif;margin:24px}img{width:100%;height:auto}@media print{body{margin:8mm}}</style><img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}" onload="setTimeout(()=>window.print(),300)"></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const windowRef = window.open(url, '_blank');
  if (!windowRef) { URL.revokeObjectURL(url); throw new Error('Разрешите всплывающее окно для печати в PDF.'); }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
