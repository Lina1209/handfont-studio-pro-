import { normalizeImportedProject } from './projectImport.js';
import { crc32 } from './checksum.js';

const DB_NAME = 'handfont-studio-library';
const DB_VERSION = 1;
const PROJECT_STORE = 'projects';
const ASSET_STORE = 'assets';
const MAX_BACKUP_ASSETS = 1000;
const MAX_BACKUP_ENCODED_BYTES = 100 * 1024 * 1024;
const MAX_BACKUP_PROJECTS = 5000;
const MAX_SINGLE_ASSET_BYTES = 50 * 1024 * 1024;
const MAX_LIBRARY_NAME_LENGTH = 255;

function validateLibraryLabel(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_LIBRARY_NAME_LENGTH || value.includes(String.fromCharCode(0))) {
    throw new Error(`${label} в резервной копии имеет неверное имя.`);
  }
}

function makeId(prefix) {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid || `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function cloneData(value) {
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function openLibraryDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('IndexedDB недоступен в этом браузере.'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECT_STORE)) db.createObjectStore(PROJECT_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(ASSET_STORE)) db.createObjectStore(ASSET_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Не удалось открыть библиотеку.'));
  });
}

async function withStore(storeName, mode, callback) {
  const db = await openLibraryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try { result = callback(store); } catch (error) { db.close(); reject(error); return; }
    tx.oncomplete = () => { db.close(); resolve(result?.result ?? result); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error('Ошибка записи библиотеки.')); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error('Операция библиотеки отменена.')); };
  });
}

export async function listLibraryProjects() {
  return withStore(PROJECT_STORE, 'readonly', store => store.getAll());
}
export async function saveLibraryProject(project) {
  const item = { id: makeId('project'), name: project.familyName || 'Без названия', updatedAt: Date.now(), project: cloneData(project) };
  await withStore(PROJECT_STORE, 'readwrite', store => store.put(item));
  return item;
}
export async function updateLibraryProject(id, project) {
  if (typeof id !== 'string' || !id || id.length > 160) throw new Error('Не удалось определить проект для обновления.');
  const item = { id, name: project.familyName || 'Без названия', updatedAt: Date.now(), project: cloneData(project) };
  await withStore(PROJECT_STORE, 'readwrite', store => store.put(item));
  return item;
}
export async function removeLibraryProject(id) {
  return withStore(PROJECT_STORE, 'readwrite', store => store.delete(id));
}
export async function listLibraryAssets() {
  return withStore(ASSET_STORE, 'readonly', store => store.getAll());
}
export async function saveLibraryAsset({ name, type, blob, source = 'uploaded' }) {
  const item = { id: makeId('asset'), name, type: type || blob?.type || 'application/octet-stream', size: blob?.size || 0, updatedAt: Date.now(), source, blob };
  await withStore(ASSET_STORE, 'readwrite', store => store.put(item));
  return item;
}
export async function removeLibraryAsset(id) {
  return withStore(ASSET_STORE, 'readwrite', store => store.delete(id));
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}
function fromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
export async function exportLibraryBackup(currentProject) {
  const [projects, assets] = await Promise.all([listLibraryProjects(), listLibraryAssets()]);
  if (projects.length > MAX_BACKUP_PROJECTS) throw new Error(`В библиотеке слишком много проектов для резервной копии: максимум ${MAX_BACKUP_PROJECTS}.`);
  if (assets.length > MAX_BACKUP_ASSETS) throw new Error(`В библиотеке слишком много файлов для резервной копии: максимум ${MAX_BACKUP_ASSETS}.`);
  let encodedBytes = 0;
  const packedAssets = [];
  for (const asset of assets) {
    if (!asset?.blob || typeof asset.blob.arrayBuffer !== 'function') {
      throw new Error(`Файл «${asset?.name || 'без названия'}» нельзя включить в резервную копию: данные недоступны.`);
    }
    if (asset.blob.size > MAX_SINGLE_ASSET_BYTES) throw new Error(`Файл «${asset.name}» превышает лимит 50 МБ и не может быть включён в резервную копию.`);
    const buffer = await asset.blob.arrayBuffer();
    const data = toBase64(buffer);
    encodedBytes += data.length;
    if (encodedBytes > MAX_BACKUP_ENCODED_BYTES) throw new Error('Общий объём файлов в резервной копии превышает 100 МБ в кодированном виде. Создайте резервные копии меньшими частями.');
    packedAssets.push({
      id: asset.id, name: asset.name, type: asset.type, size: buffer.byteLength,
      updatedAt: asset.updatedAt, source: asset.source, checksum: crc32(new Uint8Array(buffer)), data
    });
  }
  return {
    format: 'handfont-studio-library-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    currentProject: currentProject || null,
    projects,
    assets: packedAssets
  };
}
export async function importLibraryBackup(backup) {
  if (!backup || backup.format !== 'handfont-studio-library-backup' || backup.version !== 1 ||
      !Array.isArray(backup.projects) || !Array.isArray(backup.assets)) {
    throw new Error('Файл не является резервной копией библиотеки HandFont Studio.');
  }
  if (backup.projects.length > MAX_BACKUP_PROJECTS) throw new Error(`В резервной копии слишком много проектов: максимум ${MAX_BACKUP_PROJECTS}.`);
  const preparedProjects = backup.projects.map(item => {
    if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 160 ||
        !item.project || typeof item.project !== 'object' || Array.isArray(item.project) ||
        (item.updatedAt !== undefined && (!Number.isFinite(item.updatedAt) || item.updatedAt < 0))) {
      throw new Error('В резервной копии найден повреждённый проект.');
    }
    validateLibraryLabel(item.name, 'Название проекта');
    return { ...item, project: normalizeImportedProject(item.project) };
  });
  const preparedCurrentProject = backup.currentProject == null
    ? null
    : normalizeImportedProject(backup.currentProject);
  const projectIds = new Set();
  for (const item of preparedProjects) {
    if (projectIds.has(item.id)) throw new Error('В резервной копии повторяется идентификатор проекта.');
    projectIds.add(item.id);
  }
  if (backup.assets.length > MAX_BACKUP_ASSETS) throw new Error(`В резервной копии слишком много файлов: максимум ${MAX_BACKUP_ASSETS}.`);
  let encodedBytes = 0;
  const assetIds = new Set();
  for (const item of backup.assets) {
    if (typeof item?.data === 'string') {
      encodedBytes += item.data.length;
      if (item.data.length > Math.ceil(MAX_SINGLE_ASSET_BYTES * 4 / 3)) {
        throw new Error('Один из файлов в резервной копии превышает лимит 50 МБ.');
      }
      if (encodedBytes > MAX_BACKUP_ENCODED_BYTES) {
        throw new Error('Общий объём файлов в резервной копии превышает безопасный лимит 100 МБ в кодированном виде.');
      }
    }
    if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 160 ||
        typeof item.data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.data) ||
        (item.type !== undefined && (typeof item.type !== 'string' || item.type.length > 200)) ||
        (item.source !== undefined && (typeof item.source !== 'string' || item.source.length > 40)) ||
        (item.updatedAt !== undefined && (!Number.isFinite(item.updatedAt) || item.updatedAt < 0)) ||
        (item.size !== undefined && (!Number.isSafeInteger(item.size) || item.size < 0))) {
      throw new Error('В резервной копии найден повреждённый файл или некорректные данные.');
    }
    validateLibraryLabel(item.name, 'Название файла');
    if (assetIds.has(item.id)) throw new Error('В резервной копии повторяется идентификатор файла.');
    assetIds.add(item.id);
  }
  // Декодируем и подготавливаем данные до открытия транзакции: ошибка формата
  // не должна привести к очистке существующей библиотеки.
  const preparedAssets = backup.assets.map(item => {
    const bytes = fromBase64(item.data);
    if (bytes.byteLength > MAX_SINGLE_ASSET_BYTES ||
        (item.size !== undefined && (!Number.isSafeInteger(item.size) || item.size < 0 || item.size !== bytes.byteLength))) {
      throw new Error(`Размер файла «${item.name}» в резервной копии не совпадает с данными.`);
    }
    if (item.checksum !== undefined &&
        (typeof item.checksum !== 'string' || !/^[a-f0-9]{8}$/.test(item.checksum) || crc32(bytes) !== item.checksum)) {
      throw new Error(`Контрольная сумма файла «${item.name}» не совпадает. Резервная копия повреждена.`);
    }
    return { ...item, size: bytes.byteLength, blob: new Blob([bytes], { type: item.type || 'application/octet-stream' }) };
  });
  const db = await openLibraryDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction([PROJECT_STORE, ASSET_STORE], 'readwrite');
      const projects = tx.objectStore(PROJECT_STORE), assets = tx.objectStore(ASSET_STORE);
      projects.clear();
      assets.clear();
      preparedProjects.forEach(item => projects.put(item));
      preparedAssets.forEach(item => assets.put(item));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Не удалось восстановить библиотеку.'));
      tx.onabort = () => reject(tx.error || new Error('Восстановление библиотеки отменено.'));
    });
  } finally {
    db.close();
  }
  return preparedCurrentProject;
}
