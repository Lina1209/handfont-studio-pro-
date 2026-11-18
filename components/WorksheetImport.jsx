import { useEffect, useState } from 'react';
import { scanWorksheetFile, previewWorksheetFile, SHEET_PAGES } from '../lib/worksheet.js';
import { buildFont, downloadBlob, safeFilename } from '../lib/font.js';

export default function WorksheetImport({ onImport, onPrint }) {
  const [file, setFile] = useState(null);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [note, setNote] = useState('');
  const [scanResult, setScanResult] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setPreviewUrl('');
    setScanResult(null);
    if (!file) return () => { cancelled = true; };
    previewWorksheetFile(file, page).then(url => {
      if (!cancelled) setPreviewUrl(url);
    }).catch(error => {
      if (!cancelled) setNote(error.message || 'Не удалось показать страницу файла.');
    });
    return () => { cancelled = true; };
  }, [file, page]);

  const chooseFile = event => {
    const next = event.target.files?.[0] || null;
    setFile(next);
    setScanResult(null);
    setNote('');
  };
  const importPage = async () => {
    if (!file) { setNote('Сначала выберите фото или скан бланка.'); return; }
    setBusy(true); setNote('Распознаю контрастные штрихи…');
    try {
      const scan = await scanWorksheetFile(file, page);
      const glyphs = Array.isArray(scan?.glyphs) ? scan.glyphs : [];
      if (!glyphs.length) throw new Error('На выбранной странице не найдено символов.');
      onImport(scan);
      setScanResult(scan);
      const skipped = Array.isArray(scan.skipped) ? scan.skipped : [];
      const alignment = scan.aligned ? 'Угловые метки найдены.' : 'Внимание: лист обработан без угловых меток, точность может быть ниже.';
      setNote(`Импортировано символов: ${glyphs.length}. ${alignment}${skipped.length ? ` Пропущены пустые/нечёткие ячейки: ${skipped.join(' ')}.` : ''} Проверьте каждый знак в библиотеке.`);
    } catch (error) { setNote(error.message || 'Не удалось обработать изображение.'); }
    finally { setBusy(false); }
  };

  const downloadRecognizedFont = () => {
    if (!scanResult?.glyphs?.length) return;
    try {
      const familyName = `HandFont-Page-${page + 1}`;
      const glyphs = Object.fromEntries(scanResult.glyphs.map(item => [item.code, item]));
      const font = buildFont({ familyName, glyphs });
      downloadBlob(new Blob([font.toArrayBuffer()], { type: 'font/ttf' }), `${safeFilename(familyName)}.ttf`);
      setNote(`TTF-файл страницы ${page + 1} скачан. В нём ${scanResult.glyphs.length} распознанных символов. Проверьте каждый знак перед использованием.`);
    } catch (error) {
      setNote(`Не удалось создать TTF: ${error.message}`);
    }
  };

  return <section className="panel worksheet-panel">
    <div className="section-heading"><div><small>РУКОПИСНЫЙ ВВОД</small><h2>Бланк и скан</h2></div><span className="worksheet-icon">▦</span></div>
    <p className="worksheet-copy">Распечатайте PDF-бланк, впишите символы от руки и загрузите заполненный PDF (или фото/скан отдельной страницы). Выберите номер страницы, распознайте ячейки и скачайте полученный TTF-шрифт.</p>
    <button className="button full" type="button" onClick={onPrint}>▤ Скачать / распечатать бланк</button>
    <label className="field-label worksheet-file">PDF, фото или скан<input type="file" accept="application/pdf,.pdf,image/png,image/jpeg,image/webp" onChange={chooseFile}/></label>
    <label className="field-label">Страница бланка<select value={page} onChange={event => setPage(Number(event.target.value))}>{SHEET_PAGES.map((chars, index) => <option value={index} key={index}>Страница {index + 1} — {chars[0]}…{chars.at(-1)}</option>)}</select></label>
    {previewUrl && <img className="worksheet-preview" src={previewUrl} alt={`Предпросмотр страницы ${page + 1} загруженного бланка`}/>}
    <button className="button full primary" type="button" disabled={busy || !file} onClick={importPage}>{busy ? 'Обработка…' : '⇧ Распознать страницу'}</button>
    {scanResult?.glyphs?.length > 0 && <button className="button full" type="button" onClick={downloadRecognizedFont}>↓ Скачать распознанные символы как TTF</button>}
    {note && <p className="worksheet-note" role="status">{note}</p>}
    <small className="worksheet-warning">PDF автоматически преобразуется в изображение выбранной страницы. Для фото нужны все четыре чёрные угловые метки; перспектива, тени, обрезанные края и сильные линии могут ухудшить распознавание. Импортированные пиксельные контуры требуют ручной проверки и очистки. Экспорт не гарантирует соответствие требованиям Google Fonts.</small>
  </section>;
}
