const DB_NAME = 'handfont-studio-library';
const DB_VERSION = 1;
const PROJECT_STORE = 'projects';
const ASSET_STORE = 'assets';

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
  const packedAssets = await Promise.all(assets.map(async asset => ({
    id: asset.id, name: asset.name, type: asset.type, size: asset.size, updatedAt: asset.updatedAt, source: asset.source,
    data: toBase64(await asset.blob.arrayBuffer())
  })));
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
  for (const item of backup.projects) {
    if (!item || typeof item.id !== 'string' || !item.project?.glyphs || typeof item.project.glyphs !== 'object') {
      throw new Error('В резервной копии найден повреждённый проект.');
    }
  }
  if (backup.currentProject !== null && backup.currentProject !== undefined &&
      (!backup.currentProject.glyphs || typeof backup.currentProject.glyphs !== 'object')) {
    throw new Error('В резервной копии найден повреждённый текущий проект.');
  }
  const projectIds = new Set();
  for (const item of backup.projects) {
    if (projectIds.has(item.id)) throw new Error('В резервной копии повторяется идентификатор проекта.');
    projectIds.add(item.id);
  }
  const assetIds = new Set();
  for (const item of backup.assets) {
    if (!item || typeof item.id !== 'string' || typeof item.name !== 'string' ||
        typeof item.data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.data)) {
      throw new Error('В резервной копии найден повреждённый файл или некорректные данные.');
    }
    if (assetIds.has(item.id)) throw new Error('В резервной копии повторяется идентификатор файла.');
    assetIds.add(item.id);
  }
  const db = await openLibraryDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction([PROJECT_STORE, ASSET_STORE], 'readwrite');
    const projects = tx.objectStore(PROJECT_STORE), assets = tx.objectStore(ASSET_STORE);
    projects.clear();
    assets.clear();
    backup.projects.forEach(item => projects.put(item));
    backup.assets.forEach(item => {
      const bytes = fromBase64(item.data);
      assets.put({ ...item, blob: new Blob([bytes], { type: item.type || 'application/octet-stream' }) });
    });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('Не удалось восстановить библиотеку.'));
    tx.onabort = () => reject(tx.error || new Error('Восстановление библиотеки отменено.'));
  });
  db.close();
  return backup.currentProject || null;
}
