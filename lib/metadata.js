export const DEFAULT_FONT_LICENSE = 'SIL Open Font License 1.1';

const clean = value => typeof value === 'string' ? value.trim() : '';

export function resolveFontMetadata(project = {}) {
  const metadata = project.metadata && typeof project.metadata === 'object' ? project.metadata : {};
  const passport = project.passport && typeof project.passport === 'object' ? project.passport : {};
  const familyName = clean(project.familyName) || 'HandFont';
  const author = clean(passport.author) || clean(metadata.author);
  const description = clean(passport.description) || clean(metadata.description);
  const license = clean(passport.license) || clean(metadata.license) || DEFAULT_FONT_LICENSE;
  const version = clean(metadata.version) || '1.000';
  return { familyName, author, description, license, version };
}
