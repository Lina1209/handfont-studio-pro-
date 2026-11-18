import test from 'node:test';
import assert from 'node:assert/strict';
import * as opentypeModule from 'opentype.js';
import { buildFont } from '../lib/font.js';
import { ttfToWoff } from '../lib/formats.js';
import { createZip } from '../lib/publishing.js';
import { SHEET_PAGES } from '../lib/worksheet.js';

const opentype = opentypeModule.default ?? opentypeModule;

function sampleProject() {
  return {
    familyName: 'HandFont QA',
    metadata: {
      author: 'Studio Author',
      version: '1.002',
      description: 'Test font description',
      license: 'SIL Open Font License 1.1'
    },
    passport: {
      author: 'Studio Author',
      description: 'Test font description',
      license: 'SIL Open Font License 1.1'
    },
    glyphs: {
      65: {
        advanceWidth: 620,
        strokes: [],
        outlines: [[{ x: 40, y: 0 }, { x: 300, y: 700 }, { x: 560, y: 0 }]]
      }
    }
  };
}

test('buildFont writes a readable TTF with author, version and license metadata', () => {
  const font = buildFont(sampleProject());
  const parsed = opentype.parse(font.toArrayBuffer());
  const values = field => Object.values(parsed.names[field] || {});
  assert.ok(values('fontFamily').includes('HandFont QA'));
  assert.ok(values('designer').includes('Studio Author'));
  assert.ok(values('version').includes('Version 1.002'));
  assert.ok(values('license').some(value => value.includes('SIL Open Font License 1.1')));
  assert.equal(parsed.charToGlyph('A').unicode, 65);
});

test('buildFont preserves separate outer, hole and detached contours in one glyph', () => {
  const project = {
    familyName: 'Contour QA',
    glyphs: {
      66: {
        advanceWidth: 735,
        strokes: [],
        outlines: [
          [{ x: 40, y: 0 }, { x: 560, y: 0 }, { x: 560, y: 700 }, { x: 40, y: 700 }],
          [{ x: 180, y: 180 }, { x: 180, y: 520 }, { x: 420, y: 520 }, { x: 420, y: 180 }],
          [{ x: 620, y: 0 }, { x: 700, y: 0 }, { x: 700, y: 80 }, { x: 620, y: 80 }]
        ]
      }
    }
  };
  const parsed = opentype.parse(buildFont(project).toArrayBuffer());
  const glyph = parsed.charToGlyph('B');
  assert.equal(glyph.advanceWidth, 735);
  assert.equal(glyph.path.commands.filter(command => command.type === 'M').length, 3);
  assert.equal(glyph.path.commands.filter(command => command.type === 'Z').length, 3);
  assert.ok(glyph.path.commands.every(command =>
    Object.values(command).every(value => typeof value !== 'number' || Number.isFinite(value))
  ));
});

test('ttfToWoff creates a WOFF container with consistent header lengths', async () => {
  const ttf = buildFont(sampleProject()).toArrayBuffer();
  const woff = await ttfToWoff(ttf);
  assert.equal(String.fromCharCode(...woff.slice(0, 4)), 'wOFF');
  const view = new DataView(woff.buffer, woff.byteOffset, woff.byteLength);
  assert.equal(view.getUint32(8), woff.byteLength);
  assert.ok(view.getUint16(12) > 0);
  assert.ok(view.getUint32(16) >= 12);
});

test('ttfToWoff rejects truncated or invalid font data', async () => {
  await assert.rejects(() => ttfToWoff(new ArrayBuffer(4)), /слишком короткий/);
  await assert.rejects(() => ttfToWoff(new Uint8Array([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0])), /некорректная таблица/);
});


test('createZip writes a readable UTF-8 archive with correct local and central records', () => {
  const zip = createZip([
    { name: 'fonts/test.ttf', data: new Uint8Array([0, 1, 2, 255]) },
    { name: 'паспорт/описание.txt', data: 'Проверка архива' }
  ]);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const read32 = at => view.getUint32(at, true);
  const read16 = at => view.getUint16(at, true);
  assert.equal(read32(0), 0x04034b50);
  let cursor = 0;
  const localFiles = [];
  while (read32(cursor) === 0x04034b50) {
    const nameLength = read16(cursor + 26), extraLength = read16(cursor + 28);
    const size = read32(cursor + 18);
    const name = new TextDecoder().decode(zip.slice(cursor + 30, cursor + 30 + nameLength));
    const dataStart = cursor + 30 + nameLength + extraLength;
    localFiles.push({ name, data: zip.slice(dataStart, dataStart + size) });
    cursor = dataStart + size;
  }
  assert.deepEqual(localFiles.map(file => file.name), ['fonts/test.ttf', 'паспорт/описание.txt']);
  assert.deepEqual([...localFiles[0].data], [0, 1, 2, 255]);
  assert.equal(new TextDecoder().decode(localFiles[1].data), 'Проверка архива');
  assert.equal(read32(cursor), 0x02014b50);
  const endOffset = zip.length - 22;
  assert.equal(read32(endOffset), 0x06054b50);
  assert.equal(read16(endOffset + 10), 2);
});

test('createZip rejects duplicate paths and unsupported input', () => {
  assert.throws(() => createZip([{ name: 'same.txt', data: 'a' }, { name: 'same.txt', data: 'b' }]), /Повторяющийся путь/);
  assert.throws(() => createZip([{ name: 'bad.bin', data: {} }]), /Некорректные данные/);
  assert.throws(() => createZip(null), /список файлов/);
});


test('worksheet generator contains seven printable pages with no duplicated symbols', () => {
  assert.equal(SHEET_PAGES.length, 7);
  assert.ok(SHEET_PAGES.every(page => page.length > 0 && page.length <= 24));
  const allChars = SHEET_PAGES.flat();
  assert.equal(new Set(allChars).size, allChars.length);
});


test('createZip rejects NUL bytes in entry names', () => {
  const invalidName = `bad${String.fromCharCode(0)}name.txt`;
  assert.throws(() => createZip([{ name: invalidName, data: 'x' }]), /некорректное имя файла/);
});
