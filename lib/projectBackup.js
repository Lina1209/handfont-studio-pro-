import { normalizeImportedProject } from './projectImport.js';

export const PROJECT_BACKUP_FORMAT = 'handfont-studio-project-backup';

export function createProjectBackup(item) {
  if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id ||
      typeof item.name !== 'string' || !item.name.trim() || !item.project || typeof item.project !== 'object') {
    throw new Error('Нельзя создать резервную копию: данные проекта повреждены.');
  }
  return {
    format: PROJECT_BACKUP_FORMAT,
    version: 1,
    createdAt: new Date().toISOString(),
    projectId: item.id,
    name: item.name,
    project: normalizeImportedProject(item.project)
  };
}

export function parseProjectBackup(backup) {
  if (!backup || backup.format !== PROJECT_BACKUP_FORMAT || backup.version !== 1 ||
      typeof backup.name !== 'string' || !backup.name.trim() || backup.name.length > 255 ||
      !backup.project || typeof backup.project !== 'object' || Array.isArray(backup.project)) {
    throw new Error('Файл не является корректной резервной копией отдельного проекта HandFont Studio.');
  }
  return { name: backup.name.trim(), project: normalizeImportedProject(backup.project) };
}
