import test from 'node:test';
import assert from 'node:assert/strict';
import * as opentypeModule from 'opentype.js';
import { buildFont } from '../lib/font.js';
import { ttfToWoff } from '../lib/formats.js';

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
