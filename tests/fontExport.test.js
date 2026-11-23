import test from 'node:test';
import assert from 'node:assert/strict';
import * as opentypeModule from 'opentype.js';
import { buildFont } from '../lib/font.js';
import { ttfToWoff } from '../lib/formats.js';
import { createZip } from '../lib/publishing.js';
import { SHEET_PAGES, createProjectiveMapper, traceMask } from '../lib/worksheet.js';
import { BACKUP_STORAGE_KEY, RECOVERY_STORAGE_KEY, STORAGE_KEY, defaultProject, loadProject, saveProjectSnapshot, updateProjectMetadata } from '../lib/project.js';
import { resolveFontMetadata } from '../lib/metadata.js';
import { normalizeImportedProject } from '../lib/projectImport.js';
import { validateFontAsset } from '../lib/fontFile.js';
import { crc32 } from '../lib/checksum.js';
import { importLibraryBackup } from '../lib/library.js';


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


test('loadProject restores passport and glyph catalog while normalizing malformed sections', () => {
  const previousStorage = globalThis.localStorage;
  const saved = {
    ...defaultProject(),
    familyName: 'Saved HandFont',
    metadata: { author: 'Saved Author', version: '1.003' },
    passport: { author: 'Saved Author', year: '2026', history: 'Origin story' },
    glyphInfo: { 65: { name: 'Alpha', mapping: 'A', description: 'First sign' } },
    updatedAt: 123
  };
  globalThis.localStorage = { getItem: key => key === STORAGE_KEY ? JSON.stringify(saved) : null };
  try {
    const loaded = loadProject();
    assert.equal(loaded.familyName, 'Saved HandFont');
    assert.deepEqual(loaded.passport, saved.passport);
    assert.deepEqual(loaded.glyphInfo, saved.glyphInfo);
    assert.equal(loaded.metadata.author, 'Saved Author');
    assert.equal(loaded.updatedAt, 123);
    globalThis.localStorage = { getItem: () => JSON.stringify({ ...saved, passport: 'bad', glyphInfo: null }) };
    const normalized = loadProject();
    assert.deepEqual(normalized.passport, {});
    assert.deepEqual(normalized.glyphInfo, {});
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  }
});

test('project metadata edits keep passport author, description and license in sync', () => {
  const initial = {
    metadata: { author: 'Old', description: 'Old description', license: 'Old license', version: '1.000' },
    passport: { author: 'Old', description: 'Old description', license: 'Old license', year: '2026' }
  };
  const updated = updateProjectMetadata(initial, 'author', 'New Author');
  assert.equal(updated.metadata.author, 'New Author');
  assert.equal(updated.passport.author, 'New Author');
  assert.equal(updated.passport.year, '2026');
  assert.equal(updated.metadata.version, '1.000');
  assert.equal(updateProjectMetadata(updated, 'version', '1.005').passport.author, 'New Author');
});


test('font metadata resolver trims fields and consistently falls back from blank passport values', () => {
  const resolved = resolveFontMetadata({
    familyName: '  Rune Family  ',
    metadata: { author: '  Studio Author ', description: ' Description ', license: ' SIL Open Font License 1.1 ', version: ' 1.007 ' },
    passport: { author: '   ', description: '', license: '   ' }
  });
  assert.deepEqual(resolved, {
    familyName: 'Rune Family',
    author: 'Studio Author',
    description: 'Description',
    license: 'SIL Open Font License 1.1',
    version: '1.007'
  });
});

test('font metadata resolver supplies stable defaults for missing or malformed metadata', () => {
  assert.deepEqual(resolveFontMetadata({ metadata: null, passport: [] }), {
    familyName: 'HandFont', author: '', description: '',
    license: 'SIL Open Font License 1.1', version: '1.000'
  });
});


test('JSON project import accepts a valid empty project and fills safe defaults', () => {
  const imported = normalizeImportedProject({
    familyName: '  My Font  ',
    metadata: { author: 'Author' },
    glyphs: { 65: { unicode: 65, advanceWidth: 620, strokes: [], outlines: [] } }
  });
  assert.equal(imported.familyName, 'My Font');
  assert.equal(imported.metadata.license, 'SIL Open Font License 1.1');
  assert.equal(imported.glyphs[65].unicode, 65);
  assert.ok(imported.glyphs[66]);
});

test('JSON project import rejects malformed nested stroke and contour data', () => {
  const base = { familyName: 'Damaged', glyphs: { 65: { strokes: [], outlines: [] } } };
  assert.throws(() => normalizeImportedProject({
    ...base, glyphs: { 65: { strokes: [null], outlines: [] } }
  }), /Штрих .* повреждён/);
  assert.throws(() => normalizeImportedProject({
    ...base, glyphs: { 65: { strokes: [{ points: [{ x: 1, y: '2' }] }], outlines: [] } }
  }), /повреждённые или слишком большие координаты/);
  assert.throws(() => normalizeImportedProject({
    ...base, glyphs: { 65: { strokes: [], outlines: [[{ x: 0, y: 0 }, { x: 1, y: 1 }]] } }
  }), /минимум три точки/);
});

test('JSON project import rejects invalid Unicode keys, excessive coordinates and mismatched glyph codes', () => {
  const base = { familyName: 'Damaged', glyphs: {} };
  assert.throws(() => normalizeImportedProject({ ...base, glyphs: { 55296: { strokes: [], outlines: [] } } }), /Unicode-код/);
  assert.throws(() => normalizeImportedProject({
    ...base, glyphs: { 65: { strokes: [{ points: [{ x: 10001, y: 0 }] }], outlines: [] } }
  }), /слишком большие координаты/);
  assert.throws(() => normalizeImportedProject({
    ...base, glyphs: { 65: { unicode: 66, strokes: [], outlines: [] } }
  }), /не совпадает/);
});

test('JSON project import rejects corrupted metadata, passport and glyph catalog fields', () => {
  const base = { familyName: 'Valid', glyphs: { 65: { strokes: [], outlines: [] } } };
  assert.throws(() => normalizeImportedProject({ ...base, metadata: { author: { name: 'x' } } }), /метаданные/);
  assert.throws(() => normalizeImportedProject({ ...base, passport: 'broken' }), /паспорт шрифта/);
  assert.throws(() => normalizeImportedProject({ ...base, glyphInfo: { 65: { description: 12 } } }), /знак 65/);
  assert.throws(() => normalizeImportedProject({ ...base, familyName: '   ' }), /Название семейства/);
});

test('JSON project import rejects dangerous property names and oversized project geometry', () => {
  const glyphs = JSON.parse('{"65":{"strokes":[],"outlines":[],"__proto__":{"polluted":true}}}');
  assert.throws(() => normalizeImportedProject({ familyName: 'Unsafe', glyphs }), /недопустимое поле/);
  const points = Array.from({ length: 20001 }, (_, index) => ({ x: index % 100, y: index % 100 }));
  assert.throws(() => normalizeImportedProject({
    familyName: 'Huge', glyphs: { 65: { strokes: [{ points }], outlines: [] } }
  }), /Слишком много точек/);
});


test('local project autosave keeps a last-known-good snapshot', () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value))
  };
  const first = defaultProject();
  first.familyName = 'First saved';
  saveProjectSnapshot(first);
  const second = { ...first, familyName: 'Second saved' };
  saveProjectSnapshot(second);
  assert.equal(JSON.parse(values.get(STORAGE_KEY)).familyName, 'Second saved');
  assert.equal(JSON.parse(values.get(BACKUP_STORAGE_KEY)).familyName, 'First saved');
  delete globalThis.localStorage;
});

test('local project loader recovers the previous snapshot when the current JSON is corrupted', () => {
  const values = new Map([
    [STORAGE_KEY, '{"glyphs": broken json'],
    [BACKUP_STORAGE_KEY, JSON.stringify({ ...defaultProject(), familyName: 'Recovered project' })]
  ]);
  globalThis.localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value))
  };
  const recovered = loadProject();
  assert.equal(recovered.familyName, 'Recovered project');
  assert.equal(values.get(RECOVERY_STORAGE_KEY), '{"glyphs": broken json');
  delete globalThis.localStorage;
});

test('local project loader safely starts fresh when no valid snapshot exists', () => {
  const values = new Map([[STORAGE_KEY, 'not-json'], [BACKUP_STORAGE_KEY, '{broken']]);
  globalThis.localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value))
  };
  const loaded = loadProject();
  assert.equal(loaded.familyName, 'My Handwriting');
  assert.equal(values.get(RECOVERY_STORAGE_KEY), 'not-json');
  delete globalThis.localStorage;
});


test('local project loader recovers when JSON parses but glyph geometry is structurally damaged', () => {
  const damaged = { ...defaultProject(), familyName: 'Broken current', glyphs: {
    65: { strokes: [{ points: [{ x: 1, y: 'bad' }] }], outlines: [] }
  } };
  const values = new Map([
    [STORAGE_KEY, JSON.stringify(damaged)],
    [BACKUP_STORAGE_KEY, JSON.stringify({ ...defaultProject(), familyName: 'Safe previous copy' })]
  ]);
  globalThis.localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value))
  };
  const loaded = loadProject();
  assert.equal(loaded.familyName, 'Safe previous copy');
  assert.equal(values.get(RECOVERY_STORAGE_KEY), JSON.stringify(damaged));
  delete globalThis.localStorage;
});


test('autosave does not overwrite a valid recovery snapshot with a damaged primary file', () => {
  const safe = { ...defaultProject(), familyName: 'Last known good' };
  const values = new Map([
    [STORAGE_KEY, JSON.stringify({ ...defaultProject(), familyName: 'Broken', glyphs: { 65: { strokes: [{ points: [{ x: 1, y: 'bad' }] }], outlines: [] } } })],
    [BACKUP_STORAGE_KEY, JSON.stringify(safe)]
  ]);
  globalThis.localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value))
  };
  saveProjectSnapshot({ ...defaultProject(), familyName: 'Recovered and edited' });
  assert.equal(JSON.parse(values.get(BACKUP_STORAGE_KEY)).familyName, 'Last known good');
  assert.equal(JSON.parse(values.get(STORAGE_KEY)).familyName, 'Recovered and edited');
  delete globalThis.localStorage;
});


test('font library upload validates TTF, OTF, WOFF and WOFF2 signatures', async () => {
  const samples = [
    ['sample.ttf', [0, 1, 0, 0], 'font/ttf'],
    ['sample.otf', [79, 84, 84, 79], 'font/otf'],
    ['sample.woff', [119, 79, 70, 70], 'font/woff'],
    ['sample.woff2', [119, 79, 70, 50], 'font/woff2']
  ];
  for (const [name, bytes, mime] of samples) {
    const file = new Blob([new Uint8Array(bytes)]);
    file.name = name;
    assert.equal(await validateFontAsset(file), mime);
  }
});

test('font library upload rejects a mismatched or truncated font file', async () => {
  const mismatch = new Blob(['NOPE']); mismatch.name = 'fake.woff2';
  await assert.rejects(() => validateFontAsset(mismatch), /не соответствует формату/);
  const truncated = new Blob(['TT']); truncated.name = 'short.ttf';
  await assert.rejects(() => validateFontAsset(truncated), /слишком короткий/);
});

test('non-font library assets bypass font signature validation', async () => {
  const pdf = new Blob(['%PDF']); pdf.name = 'worksheet.pdf';
  assert.equal(await validateFontAsset(pdf), null);
});


test('backup asset checksum detects accidental changes in binary data', () => {
  const original = new Uint8Array([0, 1, 2, 255, 10, 13]);
  const restored = new Uint8Array([0, 1, 2, 255, 10, 13]);
  const damaged = new Uint8Array([0, 1, 2, 254, 10, 13]);
  assert.equal(crc32(original), crc32(restored));
  assert.notEqual(crc32(original), crc32(damaged));
  assert.equal(crc32(new TextEncoder().encode('123456789')), 'cbf43926');
});


test('library backup rejects malformed project metadata before touching IndexedDB', async () => {
  const backup = {
    format: 'handfont-studio-library-backup', version: 1,
    projects: [{ id: 'p1', name: '   ', project: sampleProject() }],
    assets: [], currentProject: sampleProject()
  };
  await assert.rejects(() => importLibraryBackup(backup), /Название проекта.*неверное имя/);
});

test('library backup rejects duplicate project and asset identifiers before restore', async () => {
  const project = sampleProject();
  const duplicateProjects = {
    format: 'handfont-studio-library-backup', version: 1,
    projects: [
      { id: 'same', name: 'First', project },
      { id: 'same', name: 'Second', project }
    ],
    assets: []
  };
  await assert.rejects(() => importLibraryBackup(duplicateProjects), /повторяется идентификатор проекта/);
  const duplicateAssets = {
    format: 'handfont-studio-library-backup', version: 1,
    projects: [],
    assets: [
      { id: 'same', name: 'one.ttf', data: 'AA==' },
      { id: 'same', name: 'two.ttf', data: 'AA==' }
    ]
  };
  await assert.rejects(() => importLibraryBackup(duplicateAssets), /повторяется идентификатор файла/);
});

test('library backup rejects invalid asset metadata and corrupted checksums before restore', async () => {
  const invalidName = {
    format: 'handfont-studio-library-backup', version: 1,
    projects: [],
    assets: [{ id: 'a1', name: '', data: 'AA==' }]
  };
  await assert.rejects(() => importLibraryBackup(invalidName), /Название файла.*неверное имя/);
  const corrupted = new Uint8Array([1, 2, 3]);
  const invalidChecksum = {
    format: 'handfont-studio-library-backup', version: 1,
    projects: [],
    assets: [{
      id: 'a1', name: 'font.ttf', data: 'AQID',
      size: 3, checksum: '00000000'
    }]
  };
  await assert.rejects(() => importLibraryBackup(invalidChecksum), /Контрольная сумма.*не совпадает/);
});


test('single-project backup round-trips a normalized project without library assets', async () => {
  const { createProjectBackup, parseProjectBackup } = await import('../lib/projectBackup.js');
  const source = { id: 'project-17', name: 'My archive font', project: sampleProject() };
  const parsed = parseProjectBackup(createProjectBackup(source));
  assert.equal(parsed.name, source.name);
  assert.equal(parsed.project.familyName, source.project.familyName);
  assert.equal(parsed.project.glyphs[65].advanceWidth, 620);
});

test('single-project restore rejects wrong format and damaged project data', async () => {
  const { parseProjectBackup } = await import('../lib/projectBackup.js');
  assert.throws(() => parseProjectBackup({ format: 'handfont-studio-library-backup', version: 1 }), /не является корректной/);
  assert.throws(() => parseProjectBackup({
    format: 'handfont-studio-project-backup', version: 1,
    name: 'Damaged', project: { familyName: 'Bad', glyphs: { 65: { strokes: [null], outlines: [] } } }
  }), /Штрих .* повреждён/);
});


test('projective worksheet alignment maps all four registration marks and interior points', () => {
  const source = [
    { x: 0, y: 0 }, { x: 100, y: 0 },
    { x: 100, y: 100 }, { x: 0, y: 100 }
  ];
  const h = [1.2, 0.1, 30, -0.05, 1.1, 20, 0.0008, -0.0004];
  const project = ({ x, y }) => ({
    x: (h[0] * x + h[1] * y + h[2]) / (h[6] * x + h[7] * y + 1),
    y: (h[3] * x + h[4] * y + h[5]) / (h[6] * x + h[7] * y + 1)
  });
  const target = source.map(project);
  const mapper = createProjectiveMapper(source, target);
  assert.equal(typeof mapper, 'function');
  for (let i = 0; i < source.length; i++) {
    const actual = mapper(source[i].x, source[i].y);
    assert.ok(Math.abs(actual.x - target[i].x) < 1e-7);
    assert.ok(Math.abs(actual.y - target[i].y) < 1e-7);
  }
  const actual = mapper(37, 61), expected = project({ x: 37, y: 61 });
  assert.ok(Math.abs(actual.x - expected.x) < 1e-7);
  assert.ok(Math.abs(actual.y - expected.y) < 1e-7);
});

test('projective worksheet alignment rejects degenerate or malformed registration marks', () => {
  const collinear = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }];
  assert.equal(createProjectiveMapper(collinear, collinear), null);
  assert.equal(createProjectiveMapper([{ x: 0, y: 0 }], [{ x: 0, y: 0 }]), null);
  assert.equal(createProjectiveMapper(
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    [{ x: 0, y: 0 }, { x: Infinity, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
  ), null);
});


test('worksheet contour tracing preserves a hole as a separate closed contour', () => {
  const width = 5, height = 5;
  const mask = new Uint8Array(width * height).fill(1);
  mask[2 * width + 2] = 0;
  const loops = traceMask(mask, width, height);
  assert.equal(loops.length, 2);
  assert.ok(loops.every(loop => loop.length >= 4));
});

test('worksheet contour tracing keeps detached pen marks as separate contours', () => {
  const width = 7, height = 7;
  const mask = new Uint8Array(width * height);
  for (let y = 1; y <= 2; y++) for (let x = 1; x <= 2; x++) mask[y * width + x] = 1;
  for (let y = 4; y <= 5; y++) for (let x = 4; x <= 5; x++) mask[y * width + x] = 1;
  const loops = traceMask(mask, width, height);
  assert.equal(loops.length, 2);
  assert.ok(loops.every(loop => loop.length >= 4));
});
