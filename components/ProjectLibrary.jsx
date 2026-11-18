import { useEffect, useState } from 'react';
import { buildFont, safeFilename } from '../lib/font.js';
import { openWorksheetPrint } from '../lib/worksheet.js';
import { validateFontAsset } from '../lib/fontFile.js';
import { createProjectBackup, parseProjectBackup } from '../lib/projectBackup.js';
import {
  exportLibraryBackup, importLibraryBackup, listLibraryAssets, listLibraryProjects,
  removeLibraryAsset, removeLibraryProject, saveLibraryAsset, saveLibraryProject, updateLibraryProject
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
  const openBlankWorksheet = () => {
    try {
      openWorksheetPrint();
      setNote('Открыт пустой семистраничный бланк. В окне печати выберите «Сохранить как PDF» или отправьте на принтер. Заполненные листы загрузите в разделе «Бланк и скан» для распознавания.');
    } catch (error) { setNote(error.message || 'Не удалось открыть бланк.'); }
  };
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
      const prepared = [];
      for (const file of files) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (!['ttf', 'otf', 'woff', 'woff2', 'pdf', 'png', 'jpg', 'jpeg', 'webp'].includes(ext)) throw new Error(`Формат ${file.name} не поддерживается. Выберите шрифт TTF/OTF/WOFF/WOFF2 или бланк PDF/PNG/JPG/WebP.`);
        const fontMime = await validateFontAsset(file);
        const fallbackMime = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[ext];
        prepared.push({ file, mime: fontMime || file.type || fallbackMime });
      }
      for (const item of prepared) {
        await saveLibraryAsset({ name: item.file.name, type: item.mime, blob: item.file, source: 'uploaded' });
      }
      await refresh(); setNote(`Добавлено файлов: ${files.length}. Оригинальные бинарные данные сохранены без перекодирования.`);
    } catch (error) { setNote(error.message); } finally { setBusy(false); event.target.value = ''; }
  };
  const downloadAsset = async asset => {
    const item = assets.find(value => value.id === asset.id);
    if (item?.blob) downloadBlob(item.blob, item.name);
  };
  const exportOneProject = item => {
    try {
      const backup = createProjectBackup(item);
      downloadBlob(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }), `${safeFilename(item.name)}-project-backup.json`);
      setNote(`Резервная копия проекта «${item.name}» скачана. Остальная библиотека не затронута.`);
    } catch (error) { setNote(`Не удалось сохранить отдельный проект: ${error.message}`); }
  };
  const importOneProject = async event => {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error('Файл проекта слишком большой: максимум 25 МБ.');
      const parsed = parseProjectBackup(JSON.parse(await file.text()));
      setBusy(true);
      const restored = await saveLibraryProject({ ...parsed.project, familyName: `${parsed.project.familyName || parsed.name} — восстановлено` });
      await refresh();
      setNote(`Проект восстановлен как отдельная запись «${restored.name}». Остальные проекты и файлы библиотеки сохранены.`);
    } catch (error) { setNote(`Не удалось восстановить отдельный проект: ${error.message}`); }
    finally { setBusy(false); event.target.value = ''; }
  };
  const exportBackup = async () => {
    try {
      setBusy(true);
      const backup = await exportLibraryBackup(project);
      const backupBlob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
      if (backupBlob.size > 150 * 1024 * 1024) throw new Error('Полная резервная копия превышает лимит 150 МБ. Уменьшите объём библиотеки и повторите экспорт.');
      downloadBlob(backupBlob, 'handfont-studio-full-backup.json');
      setNote('Полная резервная копия создана: текущий проект, библиотека проектов, шрифты, PDF-бланки и сканы. Сохраните файл отдельно от устройства.');
    } catch (error) { setNote(error.message); } finally { setBusy(false); }
  };
  const importBackup = async event => {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      if (file.size > 150 * 1024 * 1024) throw new Error('Файл резервной копии слишком большой: максимум 150 МБ.');
      if (!window.confirm('Восстановление заменит ВСЕ проекты и файлы в текущей библиотеке данными из резервной копии. Сначала убедитесь, что у вас есть копия нынешней библиотеки. Продолжить?')) return;
      setBusy(true);
      const backup = JSON.parse(await file.text());
      const current = await importLibraryBackup(backup);
      await refresh();
      if (current?.glyphs) {
        onLoadProject(current);
        setNote('Резервная копия восстановлена: библиотека заменена, текущий проект загружен.');
      } else {
        setNote('Резервная копия восстановлена: библиотека заменена. Текущий проект в файле отсутствовал, поэтому он не изменён.');
      }
    } catch (error) { setNote(`Не удалось восстановить библиотеку: ${error.message}`); }
    finally { setBusy(false); event.target.value = ''; }
  };
  const duplicateProject = async item => {
    try {
      setBusy(true);
      const copy = await saveLibraryProject({ ...item.project, familyName: `${item.project.familyName || item.name} — копия` });
      await refresh();
      setNote(`Создана независимая копия «${copy.name}». Исходный проект не изменён.`);
    } catch (error) { setNote(`Не удалось скопировать проект: ${error.message}`); }
    finally { setBusy(false); }
  };
  const updateProject = async item => {
    if (!window.confirm(`Заменить содержимое проекта «${item.name}» текущей открытой работой? Идентификатор проекта сохранится, предыдущая версия будет перезаписана. Для страховки сначала создайте копию.`)) return;
    try {
      setBusy(true);
      const updated = await updateLibraryProject(item.id, project);
      await refresh();
      setNote(`Проект «${updated.name}» обновлён текущей работой.`);
    } catch (error) { setNote(`Не удалось обновить проект: ${error.message}`); }
    finally { setBusy(false); }
  };
  const deleteProject = async item => {
    if (!window.confirm(`Удалить «${item.name}» из библиотеки? Это не удалит уже скачанные резервные копии.`)) return;
    try { setBusy(true); await removeLibraryProject(item.id); await refresh(); setNote(`Проект «${item.name}» удалён из библиотеки.`); }
    catch (error) { setNote(`Не удалось удалить проект: ${error.message}`); }
    finally { setBusy(false); }
  };
  const deleteAsset = async item => {
    if (!window.confirm(`Удалить файл «${item.name}» из библиотеки? Если он нужен, сначала скачайте его или создайте резервную копию.`)) return;
    try { setBusy(true); await removeLibraryAsset(item.id); await refresh(); setNote(`Файл «${item.name}» удалён из библиотеки.`); }
    catch (error) { setNote(`Не удалось удалить файл: ${error.message}`); }
    finally { setBusy(false); }
  };
  const loadProject = item => {
    if (window.confirm(`Открыть «${item.name}»? Текущие изменения уже автоматически сохраняются в текущем проекте.`)) {
      onLoadProject(item.project); setNote(`Открыт проект «${item.name}».`);
    }
  };
  return <section className="panel library-panel">
    <div className="section-heading"><div><small>АРХИВ СТУДИИ</small><h2>Библиотека проектов и шрифтов</h2></div><span className="worksheet-icon">▤</span></div>
    <p className="worksheet-copy">Храните готовые проекты, созданные и загруженные шрифты, а также исходные PDF-бланки и сканы. Библиотека находится на этом устройстве; делайте резервную копию для переноса.</p>
    <div className="library-list"><strong>Пустой бланк для рукописного шрифта · 7 страниц</strong><p className="worksheet-copy">Скачайте бланк в PDF через окно печати или распечатайте его. Заполните от руки, затем загрузите один PDF или до 7 фотографий в блок «Бланк и скан» ниже для извлечения знаков.</p><button className="button full" type="button" onClick={openBlankWorksheet}>⇩ Скачать PDF / печать всех 7 листов</button></div>
    <button className="button full primary" disabled={busy} onClick={saveProject}>＋ Сохранить текущий проект в библиотеку</button>
    <button className="button full" disabled={busy} onClick={saveGeneratedFont}>＋ Создать TTF и добавить в библиотеку</button>
    <label className="button full import-button">Добавить файлы в библиотеку (шрифты и бланки)<input type="file" accept=".ttf,.otf,.woff,.woff2,.pdf,.png,.jpg,.jpeg,.webp,font/ttf,font/otf,font/woff,application/pdf,image/png,image/jpeg,image/webp" multiple onChange={uploadAssets}/></label>
    <div className="library-list"><strong>Проекты ({projects.length})</strong>
      {projects.length ? projects.map(item => <div className="library-item" key={item.id}><button className="library-item-name" disabled={busy} onClick={() => loadProject(item)}>{item.name}<small>{new Date(item.updatedAt).toLocaleString()}</small></button><button className="button" disabled={busy} title="Скачать резервную копию только этого проекта" aria-label={`Скачать резервную копию проекта ${item.name}`} onClick={() => exportOneProject(item)}>⇩</button><button className="button" disabled={busy} title="Обновить сохранённый проект текущей работой" aria-label={`Обновить проект ${item.name} текущей работой`} onClick={() => updateProject(item)}>↻</button><button className="button" disabled={busy} title="Создать независимую копию" aria-label={`Создать копию проекта ${item.name}`} onClick={() => duplicateProject(item)}>⧉</button><button className="button danger" disabled={busy} title="Удалить проект" aria-label={`Удалить проект ${item.name}`} onClick={() => deleteProject(item)}>×</button></div>) : <small className="library-empty">Пока нет сохранённых проектов.</small>}
    </div>
    <div className="library-list"><strong>Файлы и бланки ({assets.length})</strong>
      {assets.length ? assets.map(item => <div className="library-item" key={item.id}><button className="library-item-name" disabled={busy} onClick={() => downloadAsset(item)}>{item.name}<small>{item.source === 'generated' ? 'Создан в студии' : 'Загружен'} · {Math.max(1, Math.round(item.size / 1024))} КБ</small></button><button className="button danger" disabled={busy} title="Удалить файл" aria-label={`Удалить файл ${item.name}`} onClick={() => deleteAsset(item)}>×</button></div>) : <small className="library-empty">Пока нет файлов и бланков.</small>}
    </div>
    <label className={`button full import-button${busy ? " disabled" : ""}`}>Восстановить отдельный проект<input type="file" accept=".json,application/json" disabled={busy} onChange={importOneProject}/></label>
    <button className="button full" disabled={busy} onClick={exportBackup}>⇩ Создать полную резервную копию</button>
    <label className={`button full import-button${busy ? " disabled" : ""}`}>Восстановить резервную копию<input type="file" accept=".json,application/json" disabled={busy} onChange={importBackup}/></label>
    {note && <p className="worksheet-note" role="status">{note}</p>}
  </section>;
}
