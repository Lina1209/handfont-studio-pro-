
import OFL_LICENSE from './OFL.txt?raw';

const encoder = new TextEncoder();

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) {
    crc = crc & 1
      ? 0xedb88320 ^ (crc >>> 1)
      : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function w16(view, at, value) {
  view.setUint16(at, value, true);
}

function w32(view, at, value) {
  view.setUint32(at, value >>> 0, true);
}

export function createZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = typeof file.data === 'string'
      ? encoder.encode(file.data)
      : new Uint8Array(file.data);

    const crc = crc32(data);

    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);

    w32(lv, 0, 0x04034b50);
    w16(lv, 4, 20);
    w16(lv, 6, 0x0800);
    w16(lv, 8, 0);
    w32(lv, 14, crc);
    w32(lv, 18, data.length);
    w32(lv, 22, data.length);
    w16(lv, 26, name.length);

    local.set(name, 30);
    local.set(data, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);

    w32(cv, 0, 0x02014b50);
    w16(cv, 4, 20);
    w16(cv, 6, 20);
    w16(cv, 8, 0x0800);
    w16(cv, 10, 0);
    w32(cv, 16, crc);
    w32(cv, 20, data.length);
    w32(cv, 24, data.length);
    w16(cv, 28, name.length);
    w32(cv, 42, offset);

    central.set(name, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce(
    (sum, item) => sum + item.length,
    0
  );

  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);

  w32(ev, 0, 0x06054b50);
  w16(ev, 8, files.length);
  w16(ev, 10, files.length);
  w32(ev, 12, centralSize);
  w32(ev, 16, offset);

  const output = new Uint8Array(
    offset + centralSize + 22
  );

  let cursor = 0;

  for (const item of locals) {
    output.set(item, cursor);
    cursor += item.length;
  }

  for (const item of centrals) {
    output.set(item, cursor);
    cursor += item.length;
  }

  output.set(end, cursor);

  return output;
}

const xml = value =>
  String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;'
  })[char]);

function validOutline(contour) {
  return (
    Array.isArray(contour) &&
    contour.length >= 3 &&
    contour.every(point =>
      Number.isFinite(point?.x) &&
      Number.isFinite(point?.y)
    )
  );
}

function hasDrawing(glyph) {
  return Boolean(
    glyph?.strokes?.length ||
    glyph?.outlines?.some(validOutline)
  );
}

function renderStrokes(strokes) {
  return (strokes || []).map(stroke => {
    const points = stroke?.points || [];

    if (!points.length) return '';

    const d = points
      .map((point, index) =>
        `${index ? 'L' : 'M'} ${point.x} ${point.y}`
      )
      .join(' ');

    return `<path
      d="${d}"
      fill="none"
      stroke="${xml(stroke.color || '#20242d')}"
      stroke-width="${stroke.width || 70}"
      stroke-linecap="round"
      stroke-linejoin="round"
    />`;
  }).join('');
}

function renderOutlines(outlines) {
  return (outlines || [])
    .filter(validOutline)
    .map(contour => {
      const first = contour[0];

      const rest = contour
        .slice(1)
        .map(point => `L ${point.x} ${point.y}`)
        .join(' ');

      return `<path
        d="M ${first.x} ${first.y} ${rest} Z"
        fill="#20242d"
        fill-rule="evenodd"
      />`;
    })
    .join('');
}

export function fontSpecimenSvg(
  project,
  sampleText = 'HandFont Studio • Aa Бб 0123'
) {
  const chars = [...new Set([
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    ...sampleText
  ])];

  const columns = 8;
  const cellW = 105;
  const cellH = 150;
  const rows = Math.ceil(chars.length / columns);
  const height = 120 + rows * cellH;

  const contents = chars.map((char, index) => {
    const glyph = project.glyphs?.[char.codePointAt(0)];

    const x = (index % columns) * cellW + 12;
    const y = Math.floor(index / columns) * cellH + 58;

    const strokes = renderStrokes(glyph?.strokes);
    const outlines = renderOutlines(glyph?.outlines);

    const drawing = strokes + outlines;
    const missing = !hasDrawing(glyph);

    return `
      <g transform="translate(${x} ${y + 90}) scale(.12 -.12)">
        ${drawing}
      </g>
      <text
        x="${x}"
        y="${y + 124}"
        class="label"
      >${xml(char)}${missing ? ' · missing' : ''}</text>
    `;
  }).join('');

  return `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="840"
      height="${height}"
      viewBox="0 0 840 ${height}"
    >
      <style>
        text {
          font-family: Arial, sans-serif;
        }

        .title {
          font-size: 25px;
          font-weight: bold;
          fill: #181a20;
        }

        .sub {
          font-size: 12px;
          fill: #707581;
        }

        .label {
          font-size: 12px;
          fill: #858a95;
        }
      </style>

      <rect width="100%" height="100%" fill="#fff"/>

      <text x="20" y="32" class="title">
        ${xml(project.familyName || 'HandFont')}
      </text>

      <text x="20" y="50" class="sub">
        ${xml(project.metadata?.author || '')}
        •
        ${xml(project.metadata?.version || '1.000')}
      </text>

      ${contents}
    </svg>
  `;
}

export function openSpecimenPrint(project, sampleText) {
  const svg = fontSpecimenSvg(project, sampleText);

  const html = `
    <!doctype html>
    <html>
      <meta charset="utf-8">
      <title>${xml(project.familyName)} specimen</title>

      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 24px;
        }

        img {
          width: 100%;
          height: auto;
        }

        @media print {
          body {
            margin: 8mm;
          }
        }
      </style>

      <img
        src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}"
        onload="setTimeout(()=>window.print(),300)"
      >
    </html>
  `;

  const url = URL.createObjectURL(
    new Blob([html], { type: 'text/html' })
  );

  const windowRef = window.open(url, '_blank');

  if (!windowRef) {
    URL.revokeObjectURL(url);
    throw new Error(
      'Разрешите всплывающее окно для печати в PDF.'
    );
  }

  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export { OFL_LICENSE };
