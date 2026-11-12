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
  const [message, setMessage] = useState('Все изменения сохраняются в этом браузере автоматически.');
  const [fontUrl, setFontUrl] = useState('');

  const activeGroup = CHARSET_GROUPS.find(g => g.id === group) || CHARSET_GROUPS[0];
  const glyph = project.glyphs[activeCode] || makeGlyph(charOf(activeCode));
  const drawnCount = useMemo(() => Object.values(project.glyphs).filter(g => g.strokes?.length).length, [project.glyphs]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...project, updatedAt: Date.now() })); }
      catch { setMessage('Не удалось сохранить: возможно, хранилище браузера заполнено. Экспортируйте JSON.'); }
    }, 350);
    return () => clearTimeout(timer);
  }, [project]);

  useEffect(() => {
    let url = '';
    try {
      const font = buildFont(project);
      const blob = new Blob([font.toArrayBuffer()], { type: 'font/otf' });
      url = URL.createObjectURL(blob);
      setFontUrl(url);
    } catch (err) {
      setMessage(`Предпросмотр пока недоступен: ${err.message}`);
    }
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [project]);

  const commitStrokes = useCallback(strokes => {
    setProject(prev => {
      const current = prev.glyphs[activeCode] || makeGlyph(charOf(activeCode));
      let advanceWidth = current.advanceWidth;
      if (!current.strokes?.length && strokes.length) {
        const maxX = Math.max(...strokes.flatMap(s => s.points.map(p => p.x)), 0);
        advanceWidth = Math.max(250, Math.min(1400, Math.round(maxX + 100)));
      }
      return { ...prev, glyphs: { ...prev.glyphs, [activeCode]: { ...current, strokes, advanceWidth } } };
    });
    setMessage('Символ обновлён.');
  }, [activeCode]);

  const exportFont = () => {
    try {
      const font = buildFont(project);
      downloadBlob(new Blob([font.toArrayBuffer()], { type: 'font/otf' }), `${safeFilename(project.familyName)}.otf`);
      setMessage('Шрифт OpenType экспортирован.');
    } catch (err) { setMessage(`Ошибка экспорта: ${err.message}`); }
  };
  const exportProject = () => {
    downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), `${safeFilename(project.familyName)}-project.json`);
    setMessage('Резервная копия проекта скачана.');
  };
  const importProject = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed.glyphs !== 'object') throw new Error('В JSON не найдена библиотека символов.');
      setProject({ ...defaultProject(), ...parsed, glyphs: { ...defaultProject().glyphs, ...parsed.glyphs } });
      setMessage('Проект импортирован.');
    } catch (err) { setMessage(`Не удалось импортировать: ${err.message}`); }
    e.target.value = '';
  };
  const reset = () => {
    if (!window.confirm('Очистить все нарисованные символы? Сначала скачайте JSON-копию, если она нужна.')) return;
    setProject(prev => {
      const glyphs = Object.fromEntries(Object.entries(prev.glyphs).map(([k, g]) => [k, { ...g, strokes: [] }]));
      return { ...prev, glyphs };
    });
    setMessage('Все символы очищены.');
  };
  const fitWidth = () => {
    const maxX = Math.max(...(glyph.strokes || []).flatMap(s => s.points.map(p => p.x)), 0);
    const width = Math.max(250, Math.min(1400, Math.round(maxX + 100)));
    setProject(p => ({ ...p, glyphs: { ...p.glyphs, [activeCode]: { ...glyph, advanceWidth: width } } }));
  };
  const installHint = () => setMessage('На Android откройте меню браузера Chrome и выберите «Установить приложение» или «Добавить на главный экран».');

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-mark">H</div>
      <div className="brand-copy"><strong>HandFont Studio Pro</strong><span>СТУДИЯ РУКОПИСНЫХ ШРИФТОВ</span></div>
      <div className="top-actions">
        <span className="save-indicator"><i /> Локальное сохранение</span>
        <button className="button ghost" onClick={installHint}>Установить</button>
        <button className="button" onClick={exportProject}>Экспорт проекта</button>
        <button className="button primary" onClick={exportFont}>Скачать OTF</button>
      </div>
    </header>

    <main className="workspace">
      <aside className="sidebar panel">
        <div className="section-heading"><div><small>БИБЛИОТЕКА</small><h2>Символы</h2></div><span className="count">{drawnCount}/{Object.keys(project.glyphs).length}</span></div>
        <div className="group-tabs">
          {CHARSET_GROUPS.map(g => <button key={g.id} className={group === g.id ? 'selected' : ''} onClick={() => setGroup(g.id)}>{g.label}</button>)}
        </div>
        <div className="glyph-grid">
          {Array.from(activeGroup.chars).map(ch => {
            const code = ch.codePointAt(0), complete = project.glyphs[code]?.strokes?.length > 0;
            return <button key={code} className={`glyph-tile ${activeCode === code ? 'active' : ''} ${complete ? 'complete' : ''}`} onClick={() => setActiveCode(code)}>
              <span>{ch === ' ' ? '␠' : ch}</span>{complete && <i />}
            </button>;
          })}
        </div>
        <div className="sidebar-foot"><span className="dot" /> {drawnCount} символов нарисовано</div>
      </aside>

      <section className="editor-column">
        <div className="panel editor-panel">
          <div className="editor-heading">
            <div><small>РЕДАКТОР ГЛИФОВ</small><h1>Символ <span>{charOf(activeCode) === ' ' ? 'Пробел' : charOf(activeCode)}</span></h1></div>
            <label className="guide-toggle"><input type="checkbox" checked={showGuides} onChange={e => setShowGuides(e.target.checked)} /> Направляющие</label>
          </div>
          <div className="canvas-stage"><GlyphCanvas glyph={glyph} penWidth={penWidth} showGuides={showGuides} onCommit={commitStrokes} /></div>
          <div className="tool-row">
            <label className="range-control"><span>Толщина пера</span><input type="range" min="20" max="150" value={penWidth} onChange={e => setPenWidth(Number(e.target.value))} /><b>{penWidth}</b></label>
            <div className="tool-buttons">
              <button className="button" onClick={() => commitStrokes((glyph.strokes || []).slice(0, -1))} disabled={!glyph.strokes?.length}>↶ Отменить штрих</button>
              <button className="button" onClick={fitWidth}>Подогнать ширину</button>
              <button className="button danger" onClick={() => commitStrokes([])} disabled={!glyph.strokes?.length}>Очистить</button>
            </div>
          </div>
          <div className="metrics-row"><span>ВЫСОТА: 1000 UNITS</span><span>ШИРИНА СИМВОЛА: {glyph.advanceWidth}</span><span>ШТРИХОВ: {glyph.strokes?.length || 0}</span></div>
        </div>

        <div className="panel preview-panel">
          <div className="section-heading"><div><small>ПРОВЕРКА НАБОРА</small><h2>Предпросмотр шрифта</h2></div><span className="preview-note">Обновляется автоматически</span></div>
          <input className="preview-input" value={previewText} onChange={e => setPreviewText(e.target.value)} placeholder="Введите текст для проверки..." />
          <div className="preview-output" style={fontUrl ? { fontFamily: '"HandFontLive", sans-serif' } : {}}>{previewText || 'Ваш текст появится здесь'}</div>
          {fontUrl && <style>{`@font-face { font-family: "HandFontLive"; src: url("${fontUrl}") format("opentype"); }`}</style>}
        </div>
      </section>

      <aside className="right-column">
        <div className="panel project-panel">
          <small>ТЕКУЩИЙ ПРОЕКТ</small><h2>Параметры</h2>
          <label className="field-label">Название семейства шрифта<input value={project.familyName} maxLength={60} onChange={e => setProject(p => ({ ...p, familyName: e.target.value }))} /></label>
          <div className="info-card"><span>Формат экспорта</span><strong>OpenType (.otf)</strong></div>
          <div className="info-card"><span>Единиц на em</span><strong>1000</strong></div>
          <div className="info-card"><span>Нарисовано глифов</span><strong>{drawnCount}</strong></div>
          <button className="button full" onClick={exportFont}>↓ Скачать шрифт</button>
          <button className="button full" onClick={exportProject}>Сохранить копию JSON</button>
          <label className="button full import-button">Импортировать JSON<input type="file" accept="application/json,.json" onChange={importProject} /></label>
          <button className="button full danger" onClick={reset}>Сбросить рисунки</button>
        </div>
        <div className="panel help-panel"><small>ПОДСКАЗКА</small><p>Выберите символ слева и нарисуйте его в рабочей области. На телефоне рисуйте пальцем или стилусом.</p><p>Экспортируйте JSON, чтобы иметь резервную копию проекта.</p></div>
        <div className="status-line">{message}</div>
      </aside>
    </main>
    <footer>HANDfont STUDIO PRO <span>•</span> Версия 1.0.0 <span>•</span> Ваши рисунки остаются на этом устройстве</footer>
  </div>;
}