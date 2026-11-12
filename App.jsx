import { useCallback, useEffect, useMemo, useState } from 'react';
import GlyphCanvas from './components/GlyphCanvas.jsx';
import { buildFont, downloadBlob, safeFilename } from './lib/font.js';
import { CHARSET_GROUPS, STORAGE_KEY, charOf, defaultProject, loadProject, makeGlyph } from './lib/project.js';

export default function App() {
  const [project, setProject] = useState(loadProject);
  const [group, setGroup] = useState('cyrillic');
  const [activeCode, setActiveCode] = useState('А'.codePointAt(0));
  const [penWidth, setPenWidth] = useState(72);
  const [showGuides, setShowGuides] = useState(true);
  const [previewText, setPreviewText] = useState('Привет! Hello, мир 123');
  const [message, setMessage] = useState('Изменения автоматически сохраняются на этом устройстве.');
  const [fontUrl, setFontUrl] = useState('');

  const activeGroup = CHARSET_GROUPS.find(item => item.id === group) || CHARSET_GROUPS[0];
  const glyph = project.glyphs[activeCode] || makeGlyph(charOf(activeCode));
  const drawnCount = useMemo(() => Object.values(project.glyphs).filter(item => item.strokes?.length).length, [project.glyphs]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...project, updatedAt: Date.now() }));
      } catch {
        setMessage('Не удалось сохранить данные. Скачайте резервную копию проекта.');
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [project]);

  useEffect(() => {
    let url = '';
    try {
      const font = buildFont(project);
      url = URL.createObjectURL(new Blob([font.toArrayBuffer()], { type: 'font/otf' }));
      setFontUrl(url);
    } catch (error) {
      setMessage(`Предпросмотр недоступен: ${error.message}`);
    }
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [project]);

  const commitStrokes = useCallback(strokes => {
    setProject(previous => {
      const current = previous.glyphs[activeCode] || makeGlyph(charOf(activeCode));
      let advanceWidth = current.advanceWidth;
      if (!current.strokes?.length && strokes.length) {
        const maxX = Math.max(...strokes.flatMap(stroke => stroke.points.map(point => point.x)), 0);
        advanceWidth = Math.max(250, Math.min(1400, Math.round(maxX + 100)));
      }
      return { ...previous, glyphs: { ...previous.glyphs, [activeCode]: { ...current, strokes, advanceWidth } } };
    });
    setMessage('Символ обновлён.');
  }, [activeCode]);

  const exportFont = () => {
    try {
      const font = buildFont(project);
      downloadBlob(new Blob([font.toArrayBuffer()], { type: 'font/otf' }), `${safeFilename(project.familyName)}.otf`);
      setMessage('Шрифт OTF скачан.');
    } catch (error) {
      setMessage(`Не удалось создать шрифт: ${error.message}`);
    }
  };

  const exportProject = () => {
    downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), `${safeFilename(project.familyName)}-project.json`);
    setMessage('Резервная копия проекта скачана.');
  };

  const importProject = async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed.glyphs !== 'object' || Array.isArray(parsed.glyphs)) throw new Error('В файле не найдена библиотека символов.');
      const base = defaultProject();
      setProject({ ...base, ...parsed, glyphs: { ...base.glyphs, ...parsed.glyphs } });
      setMessage('Проект загружен.');
    } catch (error) {
      setMessage(`Не удалось загрузить проект: ${error.message}`);
    }
    event.target.value = '';
  };

  const reset = () => {
    if (!window.confirm('Очистить все нарисованные символы?')) return;
    setProject(previous => ({
      ...previous,
      glyphs: Object.fromEntries(Object.entries(previous.glyphs).map(([key, item]) => [key, { ...item, strokes: [] }]))
    }));
    setMessage('Рисунки очищены.');
  };

  const fitWidth = () => {
    const maxX = Math.max(...(glyph.strokes || []).flatMap(stroke => stroke.points.map(point => point.x)), 0);
    const width = Math.max(250, Math.min(1400, Math.round(maxX + 100)));
    setProject(previous => ({ ...previous, glyphs: { ...previous.glyphs, [activeCode]: { ...glyph, advanceWidth: width } } }));
  };

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-mark" aria-hidden="true">H</div>
      <div className="brand-copy"><strong>HandFont Studio</strong><span>СТУДИЯ РУКОПИСНЫХ ШРИФТОВ</span></div>
      <div className="top-actions">
        <span className="save-indicator"><i /> Сохранение на устройстве</span>
        <button className="button" onClick={exportProject}>Сохранить проект</button>
        <button className="button primary" onClick={exportFont}>Скачать OTF</button>
      </div>
    </header>

    <main className="workspace">
      <aside className="sidebar panel">
        <div className="section-heading"><div><small>БИБЛИОТЕКА</small><h2>Символы</h2></div><span className="count">{drawnCount}/{Object.keys(project.glyphs).length}</span></div>
        <div className="group-tabs">
          {CHARSET_GROUPS.map(item => <button key={item.id} className={group === item.id ? 'selected' : ''} onClick={() => setGroup(item.id)}>{item.label}</button>)}
        </div>
        <div className="glyph-grid">
          {Array.from(activeGroup.chars).map(char => {
            const code = char.codePointAt(0), complete = project.glyphs[code]?.strokes?.length > 0;
            return <button key={code} className={`glyph-tile ${activeCode === code ? 'active' : ''} ${complete ? 'complete' : ''}`} onClick={() => setActiveCode(code)} aria-label={char === ' ' ? 'Пробел' : `Символ ${char}`}>
              <span>{char === ' ' ? '␠' : char}</span>{complete && <i />}
            </button>;
          })}
        </div>
        <div className="sidebar-foot"><span className="dot" /> {drawnCount} символов нарисовано</div>
      </aside>

      <section className="editor-column">
        <div className="panel editor-panel">
          <div className="editor-heading">
            <div><small>РЕДАКТОР</small><h1>Символ <span>{charOf(activeCode) === ' ' ? 'Пробел' : charOf(activeCode)}</span></h1></div>
            <label className="guide-toggle"><input type="checkbox" checked={showGuides} onChange={event => setShowGuides(event.target.checked)} /> Направляющие</label>
          </div>
          <div className="canvas-stage"><GlyphCanvas glyph={glyph} penWidth={penWidth} showGuides={showGuides} onCommit={commitStrokes} /></div>
          <div className="tool-row">
            <label className="range-control"><span>Толщина пера</span><input type="range" min="20" max="150" value={penWidth} onChange={event => setPenWidth(Number(event.target.value))} /><b>{penWidth}</b></label>
            <div className="tool-buttons">
              <button className="button" onClick={() => commitStrokes((glyph.strokes || []).slice(0, -1))} disabled={!glyph.strokes?.length}>↶ Отменить штрих</button>
              <button className="button" onClick={fitWidth}>Подогнать ширину</button>
              <button className="button danger" onClick={() => commitStrokes([])} disabled={!glyph.strokes?.length}>Очистить</button>
            </div>
          </div>
          <div className="metrics-row"><span>ВЫСОТА: 1000 UNITS</span><span>ШИРИНА: {glyph.advanceWidth}</span><span>ШТРИХОВ: {glyph.strokes?.length || 0}</span></div>
        </div>

        <div className="panel preview-panel">
          <div className="section-heading"><div><small>ПРОВЕРКА</small><h2>Предпросмотр</h2></div><span className="preview-note">Обновляется автоматически</span></div>
          <input className="preview-input" value={previewText} onChange={event => setPreviewText(event.target.value)} placeholder="Введите текст для проверки..." aria-label="Текст предпросмотра" />
          <div className="preview-output" style={fontUrl ? { fontFamily: 'HandFontLive, sans-serif' } : {}}>{previewText || 'Ваш текст появится здесь'}</div>
          {fontUrl && <style>{`@font-face { font-family: "HandFontLive"; src: url("${fontUrl}") format("opentype"); }`}</style>}
        </div>
      </section>

      <aside className="right-column">
        <div className="panel project-panel">
          <small>ПАРАМЕТРЫ ШРИФТА</small><h2>Настройки</h2>
          <label className="field-label">Название шрифта<input value={project.familyName} maxLength={60} onChange={event => setProject(previous => ({ ...previous, familyName: event.target.value }))} /></label>
          <div className="info-card"><span>Формат</span><strong>OpenType (.otf)</strong></div>
          <div className="info-card"><span>Единиц на em</span><strong>1000</strong></div>
          <div className="info-card"><span>Нарисовано символов</span><strong>{drawnCount}</strong></div>
          <button className="button full primary" onClick={exportFont}>↓ Скачать шрифт</button>
          <button className="button full" onClick={exportProject}>Сохранить копию проекта</button>
          <label className="button full import-button">Загрузить проект JSON<input type="file" accept="application/json,.json" onChange={importProject} /></label>
          <button className="button full danger" onClick={reset}>Очистить все рисунки</button>
        </div>
        <div className="panel help-panel"><small>КАК ПОЛЬЗОВАТЬСЯ</small><p>Выберите символ, нарисуйте его на холсте и скачайте готовый шрифт. Проект хранится в браузере на этом устройстве; используйте JSON для переноса.</p></div>
        <div className="status-line" role="status">{message}</div>
      </aside>
    </main>
    <footer>HANDfont STUDIO <span>•</span> Проект хранится на этом устройстве</footer>
  </div>;
}
