import { useEffect, useMemo, useState } from 'react';
import { scanWorksheetFile, previewWorksheetFile, SHEET_PAGES, getWorksheetPdfPageCount } from '../lib/worksheet.js';
import { buildFont, downloadBlob, safeFilename } from '../lib/font.js';

export default function WorksheetImport({ onImport, onPrint }) {
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(0);
  const [page, setPage] = useState(0);
  const [threshold, setThreshold] = useState(128);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [note, setNote] = useState('');
  const [scanResult, setScanResult] = useState(null);
  const activeFile = files[selectedFile] || null;
  const pageOptions = useMemo(() => SHEET_PAGES.map((chars, index) => ({ index, chars })), []);

  useEffect(() => {
    let cancelled = false;
    setPreviewUrl('');
    if (!activeFile) return () => { cancelled = true; };
    const previewPage = files.length > 1 ? selectedFile : page;
    previewWorksheetFile(activeFile, previewPage).then(url => {
      if (!cancelled) setPreviewUrl(url);
    }).catch(error => {
      if (!cancelled) setNote(error.message || 'Не удалось показать страницу файла.');
    });
    return () => { cancelled = true; };
  }, [activeFile, selectedFile, page, files.length]);

  const chooseFiles = event => {
    const selected = [...(event.target.files || [])];
    if (selected.length > 7) {
      setNote('Можно загрузить не более 7 файлов за один раз.');
      setFiles(selected.slice(0, 7));
    } else {
      setFiles(selected);
      setNote(selected.length ? `Выбрано файлов: ${selected.length}. Порядок файлов соответствует страницам бланка.` : '');
    }
    setSelectedFile(0);
    setPage(0);
    setScanResult(null);
    event.target.value = '';
  };

  const importAll = async () => {
    if (!files.length) { setNote('Сначала выберите заполненный PDF или до 7 фото/сканов страниц.'); return; }
    setBusy(true);
    setScanResult(null);
    const collected = [], errors = [], skipped = [], alignmentModes = [];
    let processed = 0;
    let extraPdfPages = 0;
    try {
      if (files.length > 1) {
        for (let index = 0; index < files.length; index++) {
          try {
            setNote(`Распознаю файл ${index + 1} из ${files.length}…`);
            const result = await scanWorksheetFile(files[index], index, { threshold });
            collected.push(...(result.glyphs || []));
            skipped.push(...(result.skipped || []));
            if (result.alignmentMode) alignmentModes.push(result.alignmentMode);
            processed++;
          } catch (error) { errors.push(`Страница ${index + 1}: ${error.message}`); }
        }
      } else {
        const file = files[0];
        const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
        if (isPdf) {
          const pageCount = await getWorksheetPdfPageCount(file);
          const total = Math.min(pageCount, SHEET_PAGES.length);
          extraPdfPages = Math.max(0, pageCount - SHEET_PAGES.length);
          for (let index = 0; index < total; index++) {
            try {
              setNote(`Распознаю страницу ${index + 1} из ${total}…`);
              const result = await scanWorksheetFile(file, index, { threshold });
              collected.push(...(result.glyphs || []));
              skipped.push(...(result.skipped || []));
              if (result.alignmentMode) alignmentModes.push(result.alignmentMode);
              processed++;
            } catch (error) { errors.push(`Страница ${index + 1}: ${error.message}`); }
          }
        } else {
          const result = await scanWorksheetFile(file, page, { threshold });
          collected.push(...(result.glyphs || []));
          skipped.push(...(result.skipped || []));
          if (result.alignmentMode) alignmentModes.push(result.alignmentMode);
          processed++;
        }
      }
      if (!collected.length) throw new Error(errors[0] || 'Не удалось распознать символы. Проверьте качество сканов и угловые метки.');
      const combined = { glyphs: collected, skipped, pagesProcessed: processed, pageErrors: errors, alignmentModes, extraPdfPages };
      onImport(combined);
      setScanResult(combined);
      const alignmentNote = alignmentModes.includes('three-mark-affine')
        ? ' Использовано выравнивание по трём меткам — особенно внимательно проверьте контуры.'
        : ' Выравнивание по четырём меткам выполнено.';
      setNote(`Импортировано символов: ${collected.length}. Обработано страниц: ${processed}.${skipped.length ? ` Пропущено пустых/нечётких знаков: ${skipped.join(' ')}.` : ''}${errors.length ? ` Не обработаны: ${errors.map(item => item.split(':')[0]).join(', ')}.` : ''}${extraPdfPages ? ` В PDF ещё ${extraPdfPages} стр. сверх семистраничного бланка — они не обрабатывались.` : ''}${alignmentNote} Проверьте каждый знак в редакторе.`);
    } catch (error) { setNote(error.message || 'Не удалось обработать файлы.'); }
    finally { setBusy(false); }
  };

  const downloadRecognizedFont = () => {
    if (!scanResult?.glyphs?.length) return;
    try {
      const familyName = 'HandFont-Recognized-Pages';
      const glyphs = Object.fromEntries(scanResult.glyphs.map(item => [item.code, item]));
      const font = buildFont({ familyName, glyphs });
      downloadBlob(new Blob([font.toArrayBuffer()], { type: 'font/ttf' }), `${safeFilename(familyName)}.ttf`);
      setNote(`TTF-файл скачан. В нём ${scanResult.glyphs.length} распознанных символов. Проверьте каждый знак перед использованием.`);
    } catch (error) { setNote(`Не удалось создать TTF: ${error.message}`); }
  };

  return <section className="panel worksheet-panel">
    <div className="section-heading"><div><small>РУКОПИСНЫЙ ВВОД</small><h2>Бланк и скан</h2></div><span className="worksheet-icon">▦</span></div>
    <p className="worksheet-copy">Скачайте пустой бланк из библиотеки или откройте его здесь. Сохраните все 7 листов в PDF через окно печати, заполните от руки и загрузите один многостраничный PDF или до 7 отдельных фото/сканов. При загрузке отдельных файлов соблюдайте порядок страниц.</p>
    <button className="button full" type="button" onClick={onPrint}>⇩ Скачать PDF / печать всех 7 страниц</button>
    <label className="field-label worksheet-file">PDF или до 7 фото/сканов<input type="file" accept="application/pdf,.pdf,image/png,image/jpeg,image/webp" multiple onChange={chooseFiles}/></label>
    {files.length > 0 && <div className="worksheet-file-list"><strong>Загружено: {files.length}/7</strong>{files.map((file, index) => <button type="button" key={`${file.name}-${index}`} className={selectedFile === index ? 'selected' : ''} onClick={() => { setSelectedFile(index); if (files.length > 1) setPage(index); }}><span>{index + 1}. {file.name}</span><small>{Math.max(1, Math.round(file.size / 1024))} КБ</small></button>)}</div>}
    {files.length === 1 && !(activeFile?.type === 'application/pdf' || /\.pdf$/i.test(activeFile?.name || '')) && <label className="field-label">Страница бланка<select value={page} onChange={event => setPage(Number(event.target.value))}>{pageOptions.map(({ index, chars }) => <option value={index} key={index}>Страница {index + 1} — {chars[0]}…{chars.at(-1)}</option>)}</select></label>}
    {previewUrl && <img className="worksheet-preview" src={previewUrl} alt="Предпросмотр загруженной страницы"/>}
    <label className="field-label">Чувствительность распознавания: {threshold}
      <input type="range" min="60" max="200" step="1" value={threshold} onChange={event => setThreshold(Number(event.target.value))}/>
      <small>Оставьте 128 для обычного скана. Если тонкие штрихи пропадают, постепенно повышайте значение; если появляются пятна и фон — снижайте.</small>
    </label>
    <button className="button full primary" type="button" disabled={busy || !files.length} onClick={importAll}>{busy ? 'Обработка…' : files.length > 1 ? '⇧ Распознать все загруженные страницы' : '⇧ Распознать бланк / все страницы PDF'}</button>
    {scanResult?.glyphs?.length > 0 && <button className="button full" type="button" onClick={downloadRecognizedFont}>↓ Скачать распознанные символы как TTF</button>}
    {note && <p className="worksheet-note" role="status">{note}</p>}
    <small className="worksheet-warning">Для точного выравнивания нужны четыре угловые метки. При трёх метках применяется резервное аффинное выравнивание; при сильной перспективе точность ниже. Импортированные контуры обязательно проверьте перед экспортом.</small>
  </section>;
}
