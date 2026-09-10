const DEFAULT_BASENAME = 'artefacto';
const IOS_SAFE_MAX_LENGTH = 96;

const EXTENSION_ALIASES: Record<string, string> = {
  markdown: 'md',
  mermaid: 'mmd',
};

export interface SanitizeFileNameOptions {
  extension: string;
  maxLength?: number;
}

const normalizeExtension = (extension: string): string => {
  const cleaned = extension.replace(/^\.+/, '').trim().toLowerCase();
  return EXTENSION_ALIASES[cleaned] ?? cleaned;
};

export function sanitizeFileName(rawName: string, options: SanitizeFileNameOptions): string {
  const extension = normalizeExtension(options.extension);
  const maxLength = Math.max(24, options.maxLength ?? IOS_SAFE_MAX_LENGTH);
  const suffix = `.${extension}`;
  const normalized = rawName
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ')
    .replace(/[\s.]+$/g, '')
    .replace(/^\.+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
  const withoutExistingExtension = normalized.replace(new RegExp(`\\.${extension}$`, 'i'), '');
  const base = (withoutExistingExtension || DEFAULT_BASENAME).slice(0, Math.max(1, maxLength - suffix.length));
  return `${base.replace(/[-_.]+$/g, '') || DEFAULT_BASENAME}${suffix}`;
}
