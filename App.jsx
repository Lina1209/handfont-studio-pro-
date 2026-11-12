import { useCallback, useEffect, useMemo, useState } from 'react';
import GlyphCanvas from './components/GlyphCanvas.jsx';
import { buildFont, downloadBlob, safeFilename } from './lib/font.js';
import { CHARSET_GROUPS, PALETTE_COLORS, STORAGE_KEY, charOf, defaultProject, loadProject, makeGlyph } from './lib/project.js';
import { validateProject } from './lib/quality.js';
import { createZip, fontSpecimenSvg, OFL_LICENSE, openSpecimenPrint } from './lib/publishing.js';

const STYLES = ['Regular', 'Bold', 'Italic', 'Bold Italic'];
const toolHelp = {
  pen: 'Перо: рисуйте мышью, пальцем или стилусом. Толщину и цвет можно менять ниже.',
  eraser: 'Ластик: проведите по штриху. Мягкий истончает затронутую линию, жёсткий удаляет фрагмент.',
  selection: 'Выделение: потяните от одного угла к противоположному. Отпустите, чтобы удалить фрагменты внутри прямоугольника.'
};

export default function App() {
  const [project, setProject] = useState(loadProject);
  const [history, setHistory] = useState({});
  const [group, setGroup] = useState('cyrillic');
  const [activeCode, setActiveCode] = useState('А'.codePointAt(0));
  const [toolMode, setToolMode] = useState('pen');
  const [eraserMode, setEraserMode] = useState('hard');
  const [penWidth, setPenWidth] = useState(72);
  const [eraserSize, setEraserSize] = useState(54);
  const [penColor, setPenColor] = useState('#f2eee7');
  const [showGuides, setShowGuides] = useState(true);
  const [previewText, setPreviewText] = useState('Привет! Hello, мир 123');
  const [message, setMessage] = useState('Изменения автоматически сохраняются на этом устройстве.');
  const [fontUrl, setFontUrl] = useState('');
  const [qualityOpen, setQualityOpen] = useState(false);

  const activeGroup = CHARSET_GROUPS.find(item => item.id === group) || CHARSET_GROUPS[0];
  const glyph = project.glyphs[activeCode] || makeGlyph(charOf(activeCode));
  const drawnCount = useMemo(() => Object.values(project.glyphs).filter(item => item.strokes?.length).length, [project.glyphs]);
  const quality = useMemo(() => validateProject(project), [project]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...project, updatedAt: Date.now() })); }
      catch { setMessage('Не удалось сохранить данные. Скачайте резервную копию проекта.'); }
    }, 350);
    return () => clearTimeout(timer);
  }, [project]);

  useEffect(() => {
    let url = '';
    try {
      const font = buildFont(project, 'Regular');
      url = URL.createObjectURL(new Blob([font.toArrayBuffer()], { type: 'font/ttf' }));
      setFontUrl(url);
    } catch (error) { setMessage(`Предпросмотр недоступен: ${error.message}`); }
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [project]);

  const commitStrokes = useCallback(strokes => {
    const old = project.glyphs[activeCode]?.strokes || [];
    setHistory(previous => ({ ...previous, [activeCode]: [...(previous[activeCode] || []), old].slice(-50) }));
    setProject(previous => {
      const current = previous.glyphs[activeCode] || makeGlyph(charOf(activeCode));
      let advanceWidth = current.advanceWidth;
      if (!current.strokes?.length && strokes.length) {
        const maxX = Math.max(...strokes.flatMap(stroke => stroke.points.map(point => point.x)), 0);
        advanceWidth = Math.max(250, Math.min(1400, Math.round(maxX + 100)));
      }
      return { ...previous, glyphs: { ...previous.glyphs, [activeCode]: { ...current, strokes, advanceWidth } } };
    });
    setMessage('Изменения символа сохранены.');
  }, [activeCode, project.glyphs]);

  const undo = () => {
    const stack = history[activeCode] || [];
    if (!stack.length) return;
    const strokes = stack[stack.length - 1];
    setHistory(previous => ({ ...previous, [activeCode]: stack.slice(0, -1) }));
    setProject(previous => ({ ...previous, glyphs: { ...previous.glyphs, [activeCode]: { ...(previous.glyphs[activeCode] || glyph), strokes } } }));
    setMessage('Последнее действие отменено.');
  };

  const eraseLast = () => {
    if (glyph.strokes?.length) { commitStrokes(glyph.strokes.slice(0, -1)); setMessage('Последний штрих удалён.'); }
  };

  const updateMetadata = (key, value) => setProject(previous => ({ ...previous, metadata: { ...(previous.metadata || {}), [key]: value } }));

  const exportFont = style => {
    try {
      const font = buildFont(project, style);
      downloadBlob(new Blob([font.toArrayBuffer()], { type: 'font/ttf' }), `${safeFilename(project.familyName)}-${style.toLowerCase().replace(/\s+/g, '-')}.ttf`);
      setMessage(`TTF ${style} скачан. Проверьте файл отдельными font QA-инструментами перед распространением.`);
    } catch (error) { setMessage(`Не удалось создать TTF: ${error.message}`); }
  };

  const exportProject = () => downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), `${safeFilename(project.familyName)}-source.json`);

  const exportPackage = () => {
    try {
      const styles = project.metadata?.styles || ['Regular'];
      const files = [];
      for (const style of styles) {
        const font = buildFont(project, style);
        files.push({ name: `${safeFilename(project.familyName)}-${style.toLowerCase().replace(/\s+/g, '-')}.ttf`, data: font.toArrayBuffer() });
      }
      files.push({ name: 'OFL.txt', data: OFL_LICENSE });
      files.push({ name: 'source/handfont-project.json', data: JSON.stringify(project, null, 2) });
      files.push({ name: 'specimen/specimen.svg', data: fontSpecimenSvg(project) });
      files.push({ name: 'METADATA.json', data: JSON.stringify({ familyName: project.familyName, ...project.metadata, packageNote: 'Prepared by HandFont Studio. This package is not an approval or guarantee of acceptance by Google Fonts.' }, null, 2) });
      files.push({ name: 'README.txt', data: `Font family: ${project.familyName}\nAuthor: ${project.metadata?.author || '(not specified)'}\nVersion: ${project.metadata?.version || '1.000'}\nLicense: SIL Open Font License 1.1\n\nIncludes TTF exports, project source and an SVG specimen. Synthetic Bold/Italic styles are generated from the same outlines and should be reviewed as separate designs before submission. Run professional font QA and consult current Google Fonts submission requirements; packaging does not imply acceptance.\n` });
      downloadBlob(new Blob([createZip(files)], { type: 'application/zip' }), `${safeFilename(project.familyName)}-distribution.zip`);
      setMessage('Пакет собран. Он не означает автоматическое принятие шрифта в Google Fonts.');
    } catch (error) { setMessage(`Не удалось собрать пакет: ${error.message}`); }
  };

  const printSpecimen = () => openSpecimenPrint(project, previewText);

  const importProject = async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed.glyphs !== 'object' || Array.isArray(parsed.glyphs)) throw new Error('В файле не найдена библиотека символов.');
      const base = defaultProject();
      setProject({ ...base, ...parsed, metadata: { ...base.metadata, ...(parsed.metadata || {}) }, glyphs: { ...base.glyphs, ...parsed.glyphs } });
      setHistory({}); setMessage('Проект загружен.');
    } catch (error) { setMessage(`Не удалось загрузить проект: ${error.message}`); }
    event.target.value = '';
  };

  const reset = () => {
    if (!window.confirm('Очистить все нарисованные символы?')) return;
    setProject(previous => ({ ...previous, glyphs: Object.fromEntries(Object.entries(previous.glyphs).map(([key, item]) => [key, { ...item, strokes: [] }])) }));
    setHistory({}); setMessage('Рисунки очищены.');
  };

  const fitWidth = () => {
    const maxX = Math.max(...(glyph.strokes || []).flatMap(stroke => stroke.points.map(point => point.x)), 0);
    const width = Math.max(250, Math.min(1400, Math.round(maxX + 100)));
    setProject(previous => ({ ...previous, glyphs: { ...previous.glyphs, [activeCode]: { ...glyph, advanceWidth: width } } }));
  };

  const toolLabels = { pen: '✎ Перо', eraser: '⌫ Ластик', selection: '▱ Выделение' };
  return <div className="app-shell">
    <header className="topbar"><div className="brand-mark" aria-hidden="true">H</div><div className="brand-copy"><strong>HandFont Studio Pro</strong><span>СТУДИЯ РУКОПИСНЫХ ШРИФТОВ</span></div><div className="top-actions"><span className="save-indicator"><i /> Автосохранение</span><button className="button" onClick={exportProject}>⇩ Исходник</button><button className="button primary" onClick={() => exportFont('Regular')}>↓ TTF</button></div></header>
    <main className="workspace">
      <aside className="sidebar panel"><div className="section-heading"><div><small>БИБЛИОТЕКА</small><h2>Символы</h2></div><span className="count">{drawnCount}/{Object.keys(project.glyphs).length}</span></div><div className="group-tabs">{CHARSET_GROUPS.map(item => <button key={item.id} className={group === item.id ? 'selected' : ''} onClick={() => setGroup(item.id)}>{item.label}</button>)}</div><div className="glyph-grid">{Array.from(activeGroup.chars).map(char => { const code = char.codePointAt(0), complete = project.glyphs[code]?.strokes?.length > 0; return <button key={code} className={`glyph-tile ${activeCode === code ? 'active' : ''} ${complete ? 'complete' : ''}`} onClick={() => setActiveCode(code)} aria-label={char === ' ' ? 'Пробел' : `Символ ${char}`}><span>{char === ' ' ? '␠' : char}</span>{complete && <i />}</button>; })}</div><div className="sidebar-foot"><span className="dot" /> {drawnCount} символов нарисовано</div></aside>
      <section className="editor-column"><div className="panel editor-panel">
        <div className="editor-heading"><div><small>РЕДАКТОР</small><h1>Символ <span>{charOf(activeCode) === ' ' ? 'Пробел' : charOf(activeCode)}</span></h1></div><label className="guide-toggle"><input type="checkbox" checked={showGuides} onChange={event => setShowGuides(event.target.checked)} /> Направляющие</label></div>
        <div className="canvas-instructions"><span>Рабочее поле</span><span>Мышь · палец · стилус</span></div><div className="canvas-stage"><GlyphCanvas glyph={glyph} penWidth={penWidth} penColor={penColor} eraserSize={eraserSize} eraserMode={eraserMode} toolMode={toolMode} showGuides={showGuides} onCommit={commitStrokes} /></div>
        <div className="tool-help" role="status"><span className="tool-help-icon">{toolMode === 'pen' ? '✎' : toolMode === 'eraser' ? '⌫' : '▱'}</span><div><strong>Сейчас: {toolLabels[toolMode]}</strong><p>{toolHelp[toolMode]}</p></div></div>
        <div className="tool-row"><div className="tool-mode-group" aria-label="Инструмент"><button type="button" title="Рисовать штрихи" className={toolMode === 'pen' ? 'selected' : ''} onClick={() => setToolMode('pen')}>✎ <span>Перо</span></button><button type="button" title="Стирать фрагменты" className={toolMode === 'eraser' ? 'selected' : ''} onClick={() => setToolMode('eraser')}>⌫ <span>Ластик</span></button><button type="button" title="Выделить область для удаления" className={toolMode === 'selection' ? 'selected' : ''} onClick={() => setToolMode('selection')}>▱ <span>Выделить</span></button></div>
          {toolMode === 'pen' ? <label className="range-control"><span>Толщина</span><input type="range" min="10" max="180" value={penWidth} onChange={event => setPenWidth(Number(event.target.value))} /><b>{penWidth}</b></label> : toolMode === 'eraser' ? <div className="eraser-controls"><div className="segmented-control"><button className={eraserMode === 'soft' ? 'selected' : ''} onClick={() => setEraserMode('soft')}>◌ Мягкий</button><button className={eraserMode === 'hard' ? 'selected' : ''} onClick={() => setEraserMode('hard')}>● Жёсткий</button></div><label className="range-control"><span>Размер</span><input type="range" min="12" max="200" value={eraserSize} onChange={event => setEraserSize(Number(event.target.value))} /><b>{eraserSize}</b></label></div> : <span className="selection-tip">Потяните по холсту, чтобы выбрать область</span>}</div>
        <div className="palette-row"><span>Цвет пера</span>{PALETTE_COLORS.map(color => <button key={color} type="button" className={`swatch ${penColor === color ? 'active' : ''}`} style={{ background: color }} onClick={() => setPenColor(color)} aria-label={`Цвет ${color}`} />)}<label className="custom-color"><input type="color" value={penColor} onChange={event => setPenColor(event.target.value)} /> Свой</label></div>
        <div className="tool-buttons"><button className="button" onClick={undo} disabled={!history[activeCode]?.length}>↶ Отменить</button><button className="button" onClick={eraseLast} disabled={!glyph.strokes?.length}>⌫ Последний штрих</button><button className="button" onClick={fitWidth}>↔ Ширина</button><button className="button danger" onClick={() => commitStrokes([])} disabled={!glyph.strokes?.length}>Очистить символ</button></div>
        <div className="metrics-row"><span>ВЫСОТА: 1000 UNITS</span><span>ШИРИНА: {glyph.advanceWidth}</span><span>ШТРИХОВ: {glyph.strokes?.length || 0}</span></div>
      </div>
      <div className="panel preview-panel"><div className="section-heading"><div><small>ПРОВЕРКА</small><h2>Предпросмотр</h2></div><span className="preview-note">Live</span></div><input className="preview-input" value={previewText} onChange={event => setPreviewText(event.target.value)} placeholder="Текст для проверки" aria-label="Текст для предпросмотра"/><div className="preview-output" style={fontUrl ? { fontFamily: 'HandFontLive, sans-serif' } : {}}>{previewText || 'Ваш текст появится здесь'}</div>{fontUrl && <style>{`@font-face{font-family:"HandFontLive";src:url("${fontUrl}") format("truetype")}`}</style>}</div></section>
      <aside className="right-column"><div className="panel project-panel"><small>ПРОЕКТ И ПУБЛИКАЦИЯ</small><h2>Сведения о шрифте</h2>
        <label className="field-label">Название семейства<input value={project.familyName} maxLength={60} onChange={event => setProject(previous => ({ ...previous, familyName: event.target.value }))}/></label>
        <label className="field-label">Автор / правообладатель<input value={project.metadata?.author || ''} maxLength={100} onChange={event => updateMetadata('author', event.target.value)} placeholder="Имя автора"/></label>
        <div className="metadata-grid"><label className="field-label">Версия<input value={project.metadata?.version || ''} onChange={event => updateMetadata('version', event.target.value)} placeholder="1.000"/></label><label className="field-label">Лицензия<select value={project.metadata?.license || 'SIL Open Font License 1.1'} onChange={event => updateMetadata('license', event.target.value)}><option>SIL Open Font License 1.1</option></select></label></div>
        <label className="field-label">Описание<input value={project.metadata?.description || ''} maxLength={180} onChange={event => updateMetadata('description', event.target.value)} placeholder="Краткое описание"/></label>
        <label className="field-label">Начертания для пакета<select multiple value={project.metadata?.styles || ['Regular']} onChange={event => updateMetadata('styles', [...event.target.selectedOptions].map(option => option.value))}>{STYLES.map(style => <option key={style}>{style}</option>)}</select><small>Bold / Italic генерируются автоматически; для публикации желательно отдельно проверить и доработать дизайн.</small></label>
        <div className="info-card"><span>Нарисовано</span><strong>{drawnCount}/{Object.keys(project.glyphs).length}</strong></div><div className="info-card"><span>Качество</span><strong className={quality.errors.length ? 'quality-bad' : quality.warnings.length ? 'quality-warn' : 'quality-good'}>{quality.errors.length ? `${quality.errors.length} ошибок` : quality.warnings.length ? `${quality.warnings.length} предупреждений` : 'Проверено'}</strong></div>
        <button className="button full" onClick={() => setQualityOpen(value => !value)}>⌕ {qualityOpen ? 'Скрыть проверку' : 'Проверить шрифт'}</button>
        {qualityOpen && <div className="quality-report"><strong>Проверено символов: {quality.checkedGlyphs}</strong>{quality.errors.map((item, index) => <p className="issue error" key={`e${index}`}>⛔ {item.title}<small>{item.detail}</small></p>)}{quality.warnings.map((item, index) => <p className="issue warning" key={`w${index}`}>⚠ {item.title}<small>{item.detail}</small></p>)}{!quality.errors.length && !quality.warnings.length && <p className="issue success">Ошибок и предупреждений не найдено.</p>}<small>Это базовая проверка проекта, не замена профессиональным font QA и требованиям каталога.</small></div>}
        <div className="export-style-grid">{STYLES.map(style => <button key={style} className="button" onClick={() => exportFont(style)}>TTF {style}</button>)}</div><button className="button full primary" onClick={exportPackage}>▣ Собрать ZIP-пакет</button><button className="button full" onClick={printSpecimen}>▤ Образец / печать в PDF</button><button className="button full" onClick={exportProject}>⇩ Исходники проекта</button><label className="button full import-button">Загрузить JSON<input type="file" accept="application/json,.json" onChange={importProject}/></label><button className="button full danger" onClick={reset}>Очистить все рисунки</button><p className="publishing-note">ZIP содержит TTF, исходный JSON, SVG-образец, метаданные и OFL.txt. Подготовка пакета не гарантирует принятие в Google Fonts.</p>
      </div><div className="panel help-panel"><small>ТЕКУЩЕЕ ДЕЙСТВИЕ</small><p>{toolHelp[toolMode]}</p></div><div className="status-line" role="status">{message}</div></aside>
    </main><footer>HANDfont STUDIO • Проект хранится на этом устройстве</footer>
  </div>;
}
