import { useState } from 'react';
import { scanWorksheetFile, SHEET_PAGES } from '../lib/worksheet.js';

export default function WorksheetImport({ onImport, onPrint }) {
  const [file, setFile] = useState(null);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [note, setNote] = useState('');

  const chooseFile = event => {
    const next = event.target.files?.[0] || null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(next); setPreviewUrl(next ? URL.createObjectURL(next) : ''); setNote('');
  };
  const importPage = async () => {
    if (!file) { setNote('Сначала выберите фото или скан бланка.'); return; }
    setBusy(true); setNote('Распознаю контрастные штрихи…');
    try {
      const glyphs = await scanWorksheetFile(file, page);
      onImport(glyphs);
      setNote(`Импортировано символов: ${glyphs.length}. Проверьте каждый знак и поправьте контуры в редакторе.`);
    } catch (error) { setNote(error.message || 'Не удалось обработать изображение.'); }
    finally { setBusy(false); }
  };

  return <section className="panel worksheet-panel">
    <div className="section-heading"><div><small>РУКОПИСНЫЙ ВВОД</small><h2>Бланк и скан</h2></div><span className="worksheet-icon">▦</span></div>
    <p className="worksheet-copy">Распечатайте листы с ячейками, впишите символы от руки, затем загрузите скан. Распознавание экспериментальное: используйте тёмную ручку, снимайте страницу целиком и ровно.</p>
    <button className="button full" type="button" onClick={onPrint}>▤ Скачать / распечатать бланк</button>
    <label className="field-label worksheet-file">Фото или скан<input type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseFile}/></label>
    <label className="field-label">Страница бланка<select value={page} onChange={event => setPage(Number(event.target.value))}>{SHEET_PAGES.map((chars, index) => <option value={index} key={index}>Страница {index + 1} — {chars[0]}…{chars.at(-1)}</option>)}</select></label>
    {previewUrl && <img className="worksheet-preview" src={previewUrl} alt="Предпросмотр загруженного скана"/>}
    <button className="button full primary" type="button" disabled={busy || !file} onClick={importPage}>{busy ? 'Обработка…' : '⇧ Распознать страницу'}</button>
    {note && <p className="worksheet-note" role="status">{note}</p>}
    <small className="worksheet-warning">Скан масштабируется на формат бланка; снимок с перспективой, тенями, обрезанными краями или сильными линиями может распознаться неточно. Импортированные пиксельные контуры требуют ручной проверки и очистки. Экспорт не гарантирует соответствие требованиям Google Fonts.</small>
  </section>;
}
