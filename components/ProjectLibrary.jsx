import { useEffect, useState } from 'react';
import { buildFont, safeFilename } from '../lib/font.js';
import {
  exportLibraryBackup, importLibraryBackup, listLibraryAssets, listLibraryProjects,
  removeLibraryAsset, removeLibraryProject, saveLibraryAsset, saveLibraryProject
} from '../lib/library.js';

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default function ProjectLibrary({ project, onLoadProject, onStatus }) {
  const [projects, setProjects] = useState([]);
  const [assets, setAssets] = useState([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const refresh = async () => {
    const [nextProjects, nextAssets] = await Promise.all([listLibraryProjects(), listLibraryAssets()]);
    setProjects(nextProjects.sort((a, b) => b.updatedAt - a.updatedAt));
    setAssets(nextAssets.sort((a, b) => b.updatedAt - a.updatedAt));
  };
  useEffect(() => { refresh().catch(error => setNote(error.message)); }, []);
  const saveProject = async () => {
    try { setBusy(true); const item = await saveLibraryProject(project); await refresh(); setNote(`Проект «${item.name}» добавлен в библиотеку.`); }
    catch (error) { setNote(error.message); } finally { setBusy(false); }
  };
  const saveGeneratedFont = async () => {
    try {
      setBusy(true);
      const font = buildFont(project);
      const blob = new Blob([font.toArrayBuffer()], { type: 'font/ttf' });
      await saveLibraryAsset({ name: `${safeFilename(project.familyName)}.ttf`, type: 'font/ttf', blob, source: 'generated' });
      await refresh(); setNote('Созданный TTF добавлен в библиотеку шрифтов.');
    } catch (error) { setNote(error.message); } finally { setBusy(false); }
  };
  const uploadAssets = async event => {
    const files = [...(event.target.files || [])];
    try {
      setBusy(true);
      for (const file of files) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (!['ttf', 'otf', 'woff', 'woff2', 'pdf', 'png', 'jpg', 'jpeg', 'webp'].includes(ext)) throw new Error(`Формат ${file.name} не поддерживается. Выберите шрифт TTF/OTF/WOFF/WOFF2 или бланк PDF/PNG/JPG/WebP.`);
        const mime = file.type || ({ ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[ext]);
        await saveLibraryAsset({ name: file.name, type: mime, blob: file, source: 'uploaded' });
      }
      await refresh(); setNote(`Добавлено файлов: ${files.length}.`);
    } catch (error) { setNote(error.message); } finally { setBusy(false); event.target.value = ''; }
  };
  const downloadAsset = async asset => {
    const item = assets.find(value => value.id === asset.id);
    if (item?.blob) downloadBlob(item.blob, item.name);
  };
  const exportBackup = async () => {
    try {
      setBusy(true);
      const backup = await exportLibraryBackup(project);
      downloadBlob(new Blob([JSON.stringify(backup)], { type: 'application/json' }), 'handfont-studio-full-backup.json');
      setNote('Полная резервная копия создана: текущий проект, библиотека проектов, шрифты, PDF-бланки и сканы.');
    } catch (error) { setNote(error.message); } finally { setBusy(false); }
  };
  const importBackup = async event => {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      setBusy(true);
      const backup = JSON.parse(await file.text());
      const current = await importLibraryBackup(backup);
      await refresh();
      if (current?.glyphs) onLoadProject(current);
      setNote('Резервная копия восстановлена. Текущий проект загружен.');
    } catch (error) { setNote(`Не удалось восстановить библиотеку: ${error.message}`); }
    finally { setBusy(false); event.target.value = ''; }
  };
  const loadProject = item => {
    if (window.confirm(`Открыть «${item.name}»? Текущие изменения уже автоматически сохраняются в текущем проекте.`)) {
      onLoadProject(item.project); setNote(`Открыт проект «${item.name}».`);
    }
  };
  return <section className="panel library-panel">
    <div className="section-heading"><div><small>АРХИВ СТУДИИ</small><h2>Библиотека проектов и шрифтов</h2></div><span className="worksheet-icon">▤</span></div>
    <p className="worksheet-copy">Храните готовые проекты, созданные и загруженные шрифты, а также исходные PDF-бланки и сканы. Библиотека находится на этом устройстве; делайте резервную копию для переноса.</p>
    <button className="button full primary" disabled={busy} onClick={saveProject}>＋ Сохранить текущий проект в библиотеку</button>
    <button className="button full" disabled={busy} onClick={saveGeneratedFont}>＋ Создать TTF и добавить в библиотеку</button>
    <label className="button full import-button">Добавить файлы в библиотеку (шрифты и бланки)<input type="file" accept=".ttf,.otf,.woff,.woff2,.pdf,.png,.jpg,.jpeg,.webp,font/ttf,font/otf,font/woff,application/pdf,image/png,image/jpeg,image/webp" multiple onChange={uploadAssets}/></label>
    <div className="library-list"><strong>Проекты ({projects.length})</strong>
      {projects.length ? projects.map(item => <div className="library-item" key={item.id}><button className="library-item-name" onClick={() => loadProject(item)}>{item.name}<small>{new Date(item.updatedAt).toLocaleString()}</small></button><button className="button danger" onClick={async () => { if (window.confirm(`Удалить «${item.name}» из библиотеки?`)) { await removeLibraryProject(item.id); await refresh(); } }}>×</button></div>) : <small className="library-empty">Пока нет сохранённых проектов.</small>}
    </div>
    <div className="library-list"><strong>Файлы и бланки ({assets.length})</strong>
      {assets.length ? assets.map(item => <div className="library-item" key={item.id}><button className="library-item-name" onClick={() => downloadAsset(item)}>{item.name}<small>{item.source === 'generated' ? 'Создан в студии' : 'Загружен'} · {Math.max(1, Math.round(item.size / 1024))} КБ</small></button><button className="button danger" onClick={async () => { if (window.confirm(`Удалить файл «${item.name}»?`)) { await removeLibraryAsset(item.id); await refresh(); } }}>×</button></div>) : <small className="library-empty">Пока нет файлов и бланков.</small>}
    </div>
    <button className="button full" disabled={busy} onClick={exportBackup}>⇩ Создать полную резервную копию</button>
    <label className="button full import-button">Восстановить резервную копию<input type="file" accept=".json,application/json" onChange={importBackup}/></label>
    {note && <p className="worksheet-note" role="status">{note}</p>}
  </section>;
}
