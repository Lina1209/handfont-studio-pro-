const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hasGlyph = glyph => Boolean(glyph?.strokes?.length || glyph?.outlines?.length);
function glyphSvg(glyph) {
  const strokes = (glyph?.strokes || []).map(stroke => {
    const pts = stroke?.points || [];
    if (!pts.length) return '';
    const d = pts.map((p,i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
    return `<path d="${d}" fill="none" stroke="#17191e" stroke-width="${Number(stroke.width)||70}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('');
  const outlines = (glyph?.outlines || []).filter(c => Array.isArray(c) && c.length >= 3).map(c => `M ${c.map(p => `${p.x} ${p.y}`).join(' L ')} Z`).join(' ');
  return `<svg viewBox="0 0 800 1000" role="img">${strokes}<path d="${outlines}" fill="#17191e" fill-rule="evenodd"/></svg>`;
}
function printPassport(project) {
  const codes = Object.keys(project.glyphs || {}).map(Number).filter(code => hasGlyph(project.glyphs[code])).sort((a,b)=>a-b);
  const rows = codes.map(code => {
    const glyph = project.glyphs[code], info = project.glyphInfo?.[code] || {};
    return `<tr><td class="symbol">${glyphSvg(glyph)}</td><td><b>${esc(String.fromCodePoint(code))}</b><br>U+${code.toString(16).toUpperCase().padStart(4,'0')}</td><td>${esc(info.name || '')}</td><td>${esc(info.mapping || '')}</td><td>${esc(info.description || '')}</td></tr>`;
  }).join('');
  const meta = project.passport || {};
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Паспорт шрифта — ${esc(project.familyName)}</title><style>
  body{font:14px Arial,sans-serif;color:#20232a;margin:24px}h1{margin-bottom:4px}p{line-height:1.5}.meta{background:#f3f4f6;padding:14px;border-radius:8px;margin:16px 0}.meta b{display:inline-block;min-width:130px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #cfd3da;padding:8px;text-align:left;vertical-align:middle}th{background:#eceff3}.symbol{width:70px;height:76px}.symbol svg{width:64px;height:72px}.muted{color:#666}@media print{body{margin:12mm}tr{break-inside:avoid}thead{display:table-header-group}}
  </style><h1>${esc(project.familyName || 'Авторский шрифт')}</h1><div class="muted">Паспорт авторского шрифта • HandFont Studio Pro</div>
  <section class="meta"><p><b>Автор:</b> ${esc(meta.author || project.metadata?.author || 'Не указан')}</p><p><b>Год:</b> ${esc(meta.year || new Date().getFullYear())}</p><p><b>Версия:</b> ${esc(project.metadata?.version || '1.000')}</p><p><b>Лицензия:</b> ${esc(meta.license || project.metadata?.license || '')}</p><p><b>Описание:</b> ${esc(meta.description || project.metadata?.description || '')}</p><p><b>История:</b> ${esc(meta.history || '')}</p></section>
  <h2>Каталог знаков</h2><p>В каталоге ${codes.length} созданных символов.</p><table><thead><tr><th>Знак</th><th>Код</th><th>Название</th><th>Соответствие</th><th>Описание / значение</th></tr></thead><tbody>${rows}</tbody></table>
  <script>window.onload=()=>setTimeout(()=>window.print(),350)<\/script></html>`;
  const popup = window.open('', '_blank');
  if (!popup) throw new Error('Разрешите всплывающие окна для сохранения паспорта в PDF.');
  popup.document.open(); popup.document.write(html); popup.document.close();
}
export default function FontPassport({ project, activeCode, onChange }) {
  const meta = project.passport || {};
  const info = project.glyphInfo?.[activeCode] || {};
  const updateMeta = (key, value) => onChange(previous => ({...previous, passport:{...(previous.passport||{}),[key]:value}}));
  const updateGlyph = (key, value) => onChange(previous => ({...previous, glyphInfo:{...(previous.glyphInfo||{}),[activeCode]:{...(previous.glyphInfo?.[activeCode]||{}),[key]:value}}}));
  return <section className="panel passport-panel">
    <div className="section-heading"><div><small>ДОКУМЕНТАЦИЯ ПРОЕКТА</small><h2>Паспорт шрифта</h2></div><span className="worksheet-icon">✧</span></div>
    <p className="worksheet-copy">Сведения об авторе и каталог с описанием каждого созданного знака. Данные сохраняются вместе с проектом и резервной копией JSON.</p>
    <label className="field-label">Автор / создатель<input maxLength="120" value={meta.author ?? project.metadata?.author ?? ''} onChange={e=>updateMeta('author',e.target.value)} placeholder="Имя автора"/></label>
    <label className="field-label">Год создания<input inputMode="numeric" maxLength="4" value={meta.year ?? ''} onChange={e=>updateMeta('year',e.target.value.replace(/[^0-9]/g,'').slice(0,4))} placeholder="2026"/></label>
    <label className="field-label">Описание и история шрифта<textarea rows="3" maxLength="2000" value={meta.description ?? project.metadata?.description ?? ''} onChange={e=>updateMeta('description',e.target.value)} placeholder="Идея, назначение и история создания"/></label>
    <label className="field-label">Лицензия / условия использования<textarea rows="2" maxLength="1000" value={meta.license ?? project.metadata?.license ?? ''} onChange={e=>updateMeta('license',e.target.value)} placeholder="Укажите условия использования"/></label>
    <div className="passport-glyph-head"><strong>Каталог знаков</strong><span>Символ: {String.fromCodePoint(Number(activeCode))}</span></div>
    <label className="field-label">Название знака<input maxLength="120" value={info.name || ''} onChange={e=>updateGlyph('name',e.target.value)} placeholder="Например: Солнечный знак"/></label>
    <label className="field-label">Соответствие букве / коду<input maxLength="120" value={info.mapping || ''} onChange={e=>updateGlyph('mapping',e.target.value)} placeholder="Например: A / U+0041"/></label>
    <label className="field-label">Описание / значение<textarea rows="2" maxLength="1000" value={info.description || ''} onChange={e=>updateGlyph('description',e.target.value)} placeholder="Значение и особенности знака"/></label>
    <button className="button full primary" type="button" onClick={()=>{try{printPassport(project)}catch(error){window.alert(error.message)}}}>▤ Печать паспорта / сохранить PDF</button>
  </section>;
}
