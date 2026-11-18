import { useCallback, useEffect, useMemo, useState } from 'react';
import GlyphCanvas from './components/GlyphCanvas.jsx';
import WorksheetImport from './components/WorksheetImport.jsx';
import FontPassport from './components/FontPassport.jsx';
import ProjectLibrary from './components/ProjectLibrary.jsx';
import { buildFont, downloadBlob, safeFilename } from './lib/font.js';
import { resolveFontMetadata } from './lib/metadata.js';
import { readProjectJsonFile } from './lib/projectImport.js';
import { CHARSET_GROUPS, PALETTE_COLORS, STORAGE_KEY, charOf, defaultProject, loadProject, makeGlyph, updateProjectMetadata } from './lib/project.js';
import { validateProject } from './lib/quality.js';
import { createZip, fontSpecimenSvg, OFL_LICENSE, openSpecimenPrint } from './lib/publishing.js';
import { openWorksheetPrint } from './lib/worksheet.js';
import VectorEditor from './components/VectorEditor.jsx';
import { buildDistributionFiles } from './lib/formats.js';
const STYLES = ['Regular'];
const toolHelp = { pen: 'Перо: рисуйте мышью, пальцем или стилусом. Толщину и цвет можно менять ниже.', eraser: 'Ластик: проведите по штриху. Мягкий истончает затронутую линию, жёсткий удаляет фрагмент.', selection: 'Выделение: потяните от одного угла к противоположному. Отпустите, чтобы удалить фрагменты внутри прямоугольника.' };

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
  const [previewText, setPreviewText] = useState('');
  const [message, setMessage] = useState('Изменения автоматически сохраняются на этом устройстве.');
  const [fontUrl, setFontUrl] = useState('');
  const [qualityOpen, setQualityOpen] = useState(false);
    const [vectorOpen, setVectorOpen] = useState(false);
  const applyVector = ({ outlines, advanceWidth }) => {
    const oldGlyph = project.glyphs[activeCode] || makeGlyph(charOf(activeCode));
    setHistory(previous => ({ ...previous, [activeCode]: [...(previous[activeCode] || []), { strokes: oldGlyph.strokes || [], outlines: oldGlyph.outlines || [], advanceWidth: oldGlyph.advanceWidth }].slice(-50) }));
    setProject(previous => ({ ...previous, glyphs: { ...previous.glyphs, [activeCode]: { ...(previous.glyphs[activeCode] || makeGlyph(charOf(activeCode))), strokes: [], outlines, advanceWidth } } }));
    setVectorOpen(false);
    setMessage('Векторные объекты записаны в символ. Экспортируйте TTF/WOFF или ZIP.');
  };
  const activeGroup = CHARSET_GROUPS.find(item => item.id === group) || CHARSET_GROUPS[0];
  const glyph = project.glyphs[activeCode] || makeGlyph(charOf(activeCode));
  const drawnCount = useMemo(() => Object.values(project.glyphs).filter(item => item.strokes?.length || item.outlines?.length).length, [project.glyphs]);
  const quality = useMemo(() => validateProject(project), [project]);

  useEffect(() => {
    const timer = setTimeout(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...project, updatedAt: Date.now() })); } catch { setMessage('Не удалось сохранить данные. Скачайте резервную копию проекта.'); } }, 350);
    return () => clearTimeout(timer);
  }, [project]);
  useEffect(() => {
    let url = '';
    try { const font = buildFont(project, 'Regular'); url = URL.createObjectURL(new Blob([font.toArrayBuffer()], { type: 'font/ttf' })); setFontUrl(url); }
    catch (error) { setMessage(`Предпросмотр недоступен: ${error.message}`); }
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [project]);

  const commitStrokes = useCallback(strokes => {
    const oldGlyph = project.glyphs[activeCode] || makeGlyph(charOf(activeCode));
    setHistory(previous => ({ ...previous, [activeCode]: [...(previous[activeCode] || []), { strokes: oldGlyph.strokes || [], outlines: oldGlyph.outlines || [], advanceWidth: oldGlyph.advanceWidth }].slice(-50) }));
    setProject(previous => {
      const current = previous.glyphs[activeCode] || makeGlyph(charOf(activeCode)); let advanceWidth = current.advanceWidth;
      if (!current.strokes?.length && !current.outlines?.length && strokes.length) { const maxX = Math.max(...strokes.flatMap(stroke => stroke.points.map(point => point.x)), 0); advanceWidth = Math.max(250, Math.min(1400, Math.round(maxX + 100))); }
      return { ...previous, glyphs: { ...previous.glyphs, [activeCode]: { ...current, strokes, advanceWidth } } };
    });
    setMessage('Изменения символа сохранены.');
  }, [activeCode, project.glyphs]);
  const exportPackage = async () => {
    try {
      const styles = ['Regular'];
      const fontMeta = resolveFontMetadata(project);
      const declaredLicense = fontMeta.license;
      const licenseFile = declaredLicense === 'SIL Open Font License 1.1'
        ? { name: 'OFL.txt', data: OFL_LICENSE }
        : { name: 'LICENSE-NOTICE.txt', data: `License declared in the font passport:\n${declaredLicense}\n\nAdd the complete license text before distributing the font.` };
      const extras = [
        licenseFile,
        { name: 'source/handfont-project.json', data: JSON.stringify(project, null, 2) },
        { name: 'specimen/specimen.svg', data: fontSpecimenSvg(project) },
        { name: 'passport/font-passport.json', data: JSON.stringify({ familyName: fontMeta.familyName, metadata: { ...project.metadata, author: fontMeta.author, description: fontMeta.description, license: fontMeta.license, version: fontMeta.version }, passport: { ...(project.passport || {}), author: fontMeta.author, description: fontMeta.description, license: fontMeta.license }, glyphInfo: project.glyphInfo || {} }, null, 2) },
        { name: 'METADATA.json', data: JSON.stringify({
          familyName: fontMeta.familyName,
          ...project.metadata,
          author: fontMeta.author,
          description: fontMeta.description,
          license: fontMeta.license,
          passport: project.passport || {},
          packageNote: 'Prepared by HandFont Studio.'
        }, null, 2) },
        { name: 'README.txt', data: `Font family: ${fontMeta.familyName}\nAuthor: ${fontMeta.author || '(not specified)'}\nVersion: ${fontMeta.version}\nFormats: TTF (install on Windows/macOS/Linux), WOFF (web standard)\nLicense: ${declaredLicense}\n` }
      ];
      const files = await buildDistributionFiles(project, buildFont, styles, extras);
      const hasWoff = files.some(file => file.name.endsWith('.woff'));
      const readme = files.find(file => file.name === 'README.txt');
      if (readme) {
        readme.data = `Font family: ${project.familyName}\nAuthor: ${fontMeta.author || '(not specified)'}\nVersion: ${fontMeta.version}\nFormats: TTF${hasWoff ? ' + WOFF' : ''} Regular\nLicense: ${declaredLicense}\n`;
      }
      downloadBlob(new Blob([createZip(files)], { type: 'application/zip' }), `${safeFilename(project.familyName)}-distribution.zip`);
      setMessage(`ZIP собран: TTF${hasWoff ? ' + WOFF' : ''} Regular, лицензия, исходник, образец и метаданные.`);
    } catch (error) { setMessage(`Не удалось собрать пакет: ${error.message}`); }
  };
  const importSheetGlyphs = payload => {
    const imported = Array.isArray(payload) ? payload : (payload?.glyphs || []);
    if (!imported.length) { setMessage('Символы не распознаны.'); return; }

    // Импорт скана — такое же редактирование, как рисование: сохраняем
    // снимок каждого заменяемого знака, чтобы пользователь мог отменить импорт.
    const codes = [...new Set(imported.map(item => String(item.code)))];
    setHistory(previous => ({
      ...previous,
      ...Object.fromEntries(codes.map(code => {
        const oldGlyph = project.glyphs[code] || makeGlyph(charOf(Number(code)));
        const snapshot = {
          strokes: oldGlyph.strokes || [],
          outlines: oldGlyph.outlines || [],
          advanceWidth: oldGlyph.advanceWidth
        };
        return [code, [...(previous[code] || []), snapshot].slice(-50)];
      }))
    }));
    setProject(previous => ({
      ...previous,
      glyphs: {
        ...previous.glyphs,
        ...Object.fromEntries(imported.map(item => [item.code, {
          ...(previous.glyphs[item.code] || makeGlyph(item.char)),
          strokes: item.strokes || [],
          outlines: item.outlines || [],
          advanceWidth: item.advanceWidth,
          importedFromWorksheet: true
        }]))
      }
    }));
    const skipped = Array.isArray(payload?.skipped) ? payload.skipped : [];
    setMessage(`Импортированы символы: ${imported.map(item => item.char).join(' ')}.${skipped.length ? ` Пропущены: ${skipped.join(' ')}.` : ''} Проверьте знаки в редакторе; при необходимости используйте «Отменить».`);
  };
  const undo = () => {
    const stack = history[activeCode] || []; if (!stack.length) return;
    const snapshot = stack[stack.length - 1];
    const strokes = Array.isArray(snapshot) ? snapshot : (snapshot.strokes || []);
    const outlines = Array.isArray(snapshot) ? undefined : (snapshot.outlines || []);
    const advanceWidth = Array.isArray(snapshot) ? undefined : snapshot.advanceWidth;
    setHistory(previous => ({ ...previous, [activeCode]: stack.slice(0, -1) }));
    setProject(previous => { const current = previous.glyphs[activeCode] || glyph; return { ...previous, glyphs: { ...previous.glyphs, [activeCode]: { ...current, strokes, ...(outlines !== undefined ? { outlines } : {}), ...(advanceWidth !== undefined ? { advanceWidth } : {}) } } }; });
    setMessage('Последнее действие отменено.');
  };
  const eraseLast = () => {
    if (glyph.strokes?.length) { commitStrokes(glyph.strokes.slice(0, -1)); setMessage('Последний штрих удалён.'); return; }
    if (glyph.outlines?.length) {
      const oldGlyph = glyph;
      setHistory(previous => ({ ...previous, [activeCode]: [...(previous[activeCode] || []), { strokes: oldGlyph.strokes || [], outlines: oldGlyph.outlines || [], advanceWidth: oldGlyph.advanceWidth }].slice(-50) }));
      setProject(previous => ({ ...previous, glyphs: { ...previous.glyphs, [activeCode]: { ...glyph, outlines: glyph.outlines.slice(0, -1) } } }));
      setMessage('Последний контур скана удалён.');
    }
  };
  const clearGlyph = () => {
    const oldGlyph = glyph;
    setHistory(previous => ({ ...previous, [activeCode]: [...(previous[activeCode] || []), { strokes: oldGlyph.strokes || [], outlines: oldGlyph.outlines || [], advanceWidth: oldGlyph.advanceWidth }].slice(-50) }));
    setProject(previous => ({ ...previous, glyphs: { ...previous.glyphs, [activeCode]: { ...glyph, strokes: [], outlines: [] } } }));
    setMessage('Символ очищен (штрихи и скан-контуры).');
  };
  const updateMetadata = (key, value) => setProject(previous => updateProjectMetadata(previous, key, value));
  const copyText = async value => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {
        const area = document.createElement('textarea'); area.value = value; area.style.position = 'fixed'; area.style.opacity = '0';
        document.body.appendChild(area); area.select(); const ok = document.execCommand('copy'); area.remove();
        if (!ok) throw new Error('Копирование не поддерживается браузером.');
      }
      setMessage('Скопировано в буфер обмена.');
    } catch (error) { setMessage(`Не удалось скопировать: ${error.message}`); }
  };
  const copyActiveGlyph = () => copyText(charOf(activeCode));
  const copyGlyphData = () => copyText(JSON.stringify({ format: 'handfont-glyph', unicode: activeCode, char: charOf(activeCode), glyph }, null, 2));
  const pasteGlyphData = async () => {
    try {
      if (!navigator.clipboard?.readText) throw new Error('Разрешите доступ к буферу обмена или вставьте данные вручную в JSON-файл.');
      const parsed = JSON.parse(await navigator.clipboard.readText());
      const incoming = parsed?.format === 'handfont-glyph' ? parsed.glyph : parsed;
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming) ||
          (incoming.strokes != null && !Array.isArray(incoming.strokes)) ||
          (incoming.outlines != null && !Array.isArray(incoming.outlines))) {
        throw new Error('В буфере нет корректных данных символа HandFont.');
      }
      const oldGlyph = glyph;
      setHistory(previous => ({ ...previous, [activeCode]: [...(previous[activeCode] || []), { strokes: oldGlyph.strokes || [], outlines: oldGlyph.outlines || [], advanceWidth: oldGlyph.advanceWidth }].slice(-50) }));
      setProject(previous => ({ ...previous, glyphs: { ...previous.glyphs, [activeCode]: { ...makeGlyph(charOf(activeCode)), ...incoming, unicode: activeCode } } }));
      setMessage('Данные символа вставлены. Действие можно отменить.');
    } catch (error) { setMessage(`Не удалось вставить символ: ${error.message}`); }
  };

  const exportFont = style => { try { const font = buildFont(project, style); downloadBlob(new Blob([font.toArrayBuffer()], { type: 'font/ttf' }), `${safeFilename(project.familyName)}-${style.toLowerCase().replace(/\s+/g, '-')}.ttf`); setMessage(`TTF ${style} скачан. Проверьте отдельными font QA-инструментами перед распространением.`); } catch (error) { setMessage(`Не удалось создать TTF: ${error.message}`); } };
  const exportProject = () => downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), `${safeFilename(project.familyName)}-source.json`);
  const importProject = async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const candidate = await readProjectJsonFile(file);
      setProject(candidate);
      setHistory({});
      setMessage('Проект проверен и загружен. Предупреждения о качестве проверьте перед экспортом.');
    } catch (error) {
      setMessage(`Не удалось загрузить проект: ${error.message}`);
    } finally {
      event.target.value = '';
    }
  };
  const reset = () => { if (!window.confirm('Очистить все нарисованные символы?')) return; setProject(previous => ({ ...previous, glyphs: Object.fromEntries(Object.entries(previous.glyphs).map(([key, item]) => [key, { ...item, strokes: [], outlines: [] }])) })); setHistory({}); setMessage('Рисунки очищены.'); };
  const fitWidth = () => {
    const xs = [...(glyph.strokes || []).flatMap(stroke => (stroke.points || []).map(point => point.x)), ...(glyph.outlines || []).flatMap(contour => contour.map(point => point.x))];
    if (!xs.length) { setMessage('Сначала нарисуйте или импортируйте символ.'); return; }
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const width = Math.max(250, Math.min(1400, Math.round(maxX - Math.min(0, minX) + 100)));
    setHistory(previous => ({ ...previous, [activeCode]: [...(previous[activeCode] || []), { strokes: glyph.strokes || [], outlines: glyph.outlines || [], advanceWidth: glyph.advanceWidth }].slice(-50) }));
    setProject(previous => ({ ...previous, glyphs: { ...previous.glyphs, [activeCode]: { ...glyph, advanceWidth: width } } }));
    setMessage('Ширина символа подогнана. Действие можно отменить.');
  };
  const toolLabels = { pen: '✎ Перо', eraser: '⌫ Ластик', selection: '▱ Выделение' };

  return <div className="app-shell">
    <header className="topbar"><div className="brand-mark" aria-hidden="true">H</div><div className="brand-copy"><strong>HandFont Studio Pro</strong><span>СТУДИЯ РУКОПИСНЫХ ШРИФТОВ</span></div><div className="top-actions"><span className="save-indicator"><i /> Автосохранение</span><button className="button" onClick={exportProject}>⇩ Исходник</button><button className="button primary" onClick={() => exportFont('Regular')}>↓ TTF</button></div></header>
    <main className="workspace">
      <aside className="sidebar panel"><div className="section-heading"><div><small>БИБЛИОТЕКА</small><h2>Символы</h2></div><span className="count">{drawnCount}/{Object.keys(project.glyphs).length}</span></div><div className="group-tabs">{CHARSET_GROUPS.map(item => <button key={item.id} className={group === item.id ? 'selected' : ''} onClick={() => setGroup(item.id)}>{item.label}</button>)}</div><div className="glyph-grid">{Array.from(activeGroup.chars).map(char => { const code = char.codePointAt(0), complete = project.glyphs[code]?.strokes?.length > 0 || project.glyphs[code]?.outlines?.length > 0; return <button key={code} className={`glyph-tile ${activeCode === code ? 'active' : ''} ${complete ? 'complete' : ''}`} onClick={() => setActiveCode(code)} aria-label={char === ' ' ? 'Пробел' : `Символ ${char}`}><span>{char === ' ' ? '␠' : char}</span>{complete && <i />}</button>; })}</div><div className="sidebar-foot"><span className="dot" /> {drawnCount} символов нарисовано</div></aside>
      <section className="editor-column"><div className="panel editor-panel"><div className="editor-heading"><div><small>РЕДАКТОР</small><h1>Символ <span>{charOf(activeCode) === ' ' ? 'Пробел' : charOf(activeCode)}</span></h1></div><label className="guide-toggle"><input type="checkbox" checked={showGuides} onChange={event => setShowGuides(event.target.checked)} /> Направляющие</label></div><div className="canvas-instructions"><span>Рабочее поле</span><span>Мышь · палец · стилус</span></div><div className="canvas-stage"><GlyphCanvas glyph={glyph} penWidth={penWidth} penColor={penColor} eraserSize={eraserSize} eraserMode={eraserMode} toolMode={toolMode} showGuides={showGuides} onCommit={commitStrokes} /></div><div className="tool-help" role="status"><span className="tool-help-icon">{toolMode === 'pen' ? '✎' : toolMode === 'eraser' ? '⌫' : '▱'}</span><div><strong>Сейчас: {toolLabels[toolMode]}</strong><p>{toolHelp[toolMode]}</p></div></div><div className="tool-row"><div className="tool-mode-group" aria-label="Инструмент"><button type="button" className={toolMode === 'pen' ? 'selected' : ''} onClick={() => setToolMode('pen')}>✎ <span>Перо</span></button><button type="button" className={toolMode === 'eraser' ? 'selected' : ''} onClick={() => setToolMode('eraser')}>⌫ <span>Ластик</span></button><button type="button" className={toolMode === 'selection' ? 'selected' : ''} onClick={() => setToolMode('selection')}>▱ <span>Выделить</span></button></div>{toolMode === 'pen' ? <label className="range-control"><span>Толщина</span><input type="range" min="10" max="180" value={penWidth} onChange={event => setPenWidth(Number(event.target.value))} /><b>{penWidth}</b></label> : toolMode === 'eraser' ? <div className="eraser-controls"><div className="segmented-control"><button className={eraserMode === 'soft' ? 'selected' : ''} onClick={() => setEraserMode('soft')}>◌ Мягкий</button><button className={eraserMode === 'hard' ? 'selected' : ''} onClick={() => setEraserMode('hard')}>● Жёсткий</button></div><label className="range-control"><span>Размер</span><input type="range" min="12" max="200" value={eraserSize} onChange={event => setEraserSize(Number(event.target.value))} /><b>{eraserSize}</b></label></div> : <span className="selection-tip">Потяните по холсту, чтобы выбрать область</span>}</div><div className="palette-row"><span>Цвет пера</span>{PALETTE_COLORS.map(color => <button key={color} type="button" className={`swatch ${penColor === color ? 'active' : ''}`} style={{ background: color }} onClick={() => setPenColor(color)} aria-label={`Цвет ${color}`} />)}<label className="custom-color"><input type="color" value={penColor} onChange={event => setPenColor(event.target.value)} /> Свой</label></div><div className="tool-buttons"><button className="button" onClick={copyActiveGlyph}>⧉ Копировать знак</button><button className="button" onClick={copyGlyphData}>▣ Копировать данные</button><button className="button" onClick={pasteGlyphData}>⇧ Вставить данные</button><button className="button" onClick={undo} disabled={!history[activeCode]?.length}>↶ Отменить</button><button className="button" onClick={eraseLast} disabled={!glyph.strokes?.length && !glyph.outlines?.length}>⌫ Последний штрих</button><button className="button" onClick={fitWidth}>↔ Ширина</button><button className="button" onClick={() => setVectorOpen(true)}>✧ Векторный редактор</button><button className="button danger" onClick={clearGlyph} disabled={!glyph.strokes?.length && !glyph.outlines?.length}>Очистить символ</button></div><div className="metrics-row"><span>ВЫСОТА: 1000 UNITS</span><span>ШИРИНА: {glyph.advanceWidth}</span><span>ШТРИХОВ: {glyph.strokes?.length || 0}</span></div></div><div className="panel preview-panel"><div className="section-heading"><div><small>ПРОВЕРКА</small><h2>Предпросмотр</h2></div><span className="preview-note">Live</span></div><input className="preview-input" value={previewText} onChange={event => setPreviewText(event.target.value)} placeholder="Текст для проверки" aria-label="Текст для предпросмотра"/><div className="preview-output" style={fontUrl ? { fontFamily: '"HandFontLive"' } : {}} aria-live="polite">{previewText}</div>{fontUrl && <style>{`@font-face{font-family:"HandFontLive";src:url("${fontUrl}") format("truetype")}`}</style>}</div></section>
      <aside className="right-column"><div className="panel project-panel"><small>ПРОЕКТ И ПУБЛИКАЦИЯ</small><h2>Сведения о шрифте</h2><label className="field-label">Название семейства<input value={project.familyName} maxLength={60} onChange={event => setProject(previous => ({ ...previous, familyName: event.target.value }))}/></label><label className="field-label">Автор / правообладатель<input value={project.metadata?.author || ''} maxLength={100} onChange={event => updateMetadata('author', event.target.value)} placeholder="Имя автора"/></label><div className="metadata-grid"><label className="field-label">Версия<input value={project.metadata?.version || ''} onChange={event => updateMetadata('version', event.target.value)} placeholder="1.000"/></label><label className="field-label">Лицензия<select value={project.metadata?.license || 'SIL Open Font License 1.1'} onChange={event => updateMetadata('license', event.target.value)}><option>SIL Open Font License 1.1</option></select></label></div><label className="field-label">Описание<input value={project.metadata?.description || ''} maxLength={180} onChange={event => updateMetadata('description', event.target.value)} placeholder="Краткое описание"/></label><label className="field-label">Начертание для пакета<select value="Regular" disabled><option>Regular</option></select><small>Сейчас доступно начертание Regular. Bold и Italic добавим после полноценной разработки.</small></label><div className="info-card"><span>Нарисовано</span><strong>{drawnCount}/{Object.keys(project.glyphs).length}</strong></div><div className="info-card"><span>Качество</span><strong className={quality.errors.length ? 'quality-bad' : quality.warnings.length ? 'quality-warn' : 'quality-good'}>{quality.errors.length ? `${quality.errors.length} ошибок` : quality.warnings.length ? `${quality.warnings.length} предупреждений` : 'Проверено'}</strong></div><button className="button full" onClick={() => setQualityOpen(value => !value)}>⌕ {qualityOpen ? 'Скрыть проверку' : 'Проверить шрифт'}</button>{qualityOpen && <div className="quality-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setQualityOpen(false); }}><section className="quality-dialog" role="dialog" aria-modal="true" aria-labelledby="quality-title"><div className="quality-dialog-head"><div><small>КОНТРОЛЬ КАЧЕСТВА</small><h2 id="quality-title">Проверка шрифта</h2></div><button className="button" onClick={() => setQualityOpen(false)} aria-label="Закрыть проверку">✕</button></div><div className="quality-dialog-body"><strong>Проверено символов: {quality.checkedGlyphs}</strong>{quality.errors.map((item, index) => <p className="issue error" key={`e${index}`}>⛔ {item.title}<small>{item.detail}</small></p>)}{quality.warnings.map((item, index) => <p className="issue warning" key={`w${index}`}>⚠ {item.title}<small>{item.detail}</small></p>)}{!quality.errors.length && !quality.warnings.length && <p className="issue success">Ошибок и предупреждений не найдено.</p>}<small>Базовая проверка, не замена профессиональному font QA.</small></div><div className="quality-dialog-foot"><button className="button primary" onClick={() => setQualityOpen(false)}>Закрыть</button></div></section></div>}<div className="export-style-grid">{STYLES.map(style => <button key={style} className="button" onClick={() => exportFont(style)}>TTF {style}</button>)}</div><button className="button full primary" onClick={exportPackage}>▣ Собрать ZIP-пакет</button><button className="button full" onClick={() => openSpecimenPrint(project, previewText)}>▤ Образец / PDF</button><button className="button full" onClick={exportProject}>⇩ Исходники</button><label className="button full import-button">Загрузить JSON<input type="file" accept="application/json,.json" onChange={importProject}/></label><button className="button full danger" onClick={reset}>Очистить все рисунки</button><p className="publishing-note">ZIP не гарантирует принятие в Google Fonts.</p></div><FontPassport project={project} activeCode={activeCode} onChange={setProject}/><WorksheetImport onImport={importSheetGlyphs} onPrint={() => { try { openWorksheetPrint(); } catch (error) { setMessage(error.message); } }}/><ProjectLibrary project={project} onLoadProject={nextProject => { setProject(nextProject); setHistory({}); setMessage('Проект открыт из библиотеки.'); }}/><div className="panel help-panel"><small>ТЕКУЩЕЕ ДЕЙСТВИЕ</small><p>{toolHelp[toolMode]}</p></div><div className="status-line" role="status">{message}</div></aside>
    </main><footer>HANDfont STUDIO • Проект хранится на этом устройстве</footer>    {vectorOpen && <VectorEditor char={charOf(activeCode)} glyph={glyph} onApply={applyVector} onClose={() => setVectorOpen(false)} />}
  </div>;
}
