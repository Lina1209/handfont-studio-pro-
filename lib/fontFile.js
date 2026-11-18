const FONT_SIGNATURES = {
  ttf: new Set(['\u0000\u0001\u0000\u0000', 'true', 'typ1']),
  otf: new Set(['OTTO']),
  woff: new Set(['wOFF']),
  woff2: new Set(['wOF2'])
};
const FONT_MIME_TYPES = {
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2'
};

export async function validateFontAsset(file) {
  const extension = String(file?.name || '').split('.').pop().toLowerCase();
  if (!Object.hasOwn(FONT_SIGNATURES, extension)) return null;
  if (!file || typeof file.slice !== 'function' || file.size < 4) {
    throw new Error(`Файл «${file?.name || 'без названия'}» слишком короткий для шрифта ${extension.toUpperCase()}.`);
  }
  const header = await file.slice(0, 4).arrayBuffer();
  const signature = new TextDecoder('latin1').decode(header);
  if (!FONT_SIGNATURES[extension].has(signature)) {
    throw new Error(`Содержимое файла «${file.name}» не соответствует формату .${extension}. Файл не добавлен.`);
  }
  return FONT_MIME_TYPES[extension];
}
