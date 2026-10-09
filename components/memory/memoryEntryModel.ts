import type { MemoryEntry, MemoryPriority } from '../../types';

export interface RenderableEntry {
    entry: MemoryEntry;
    isDerived: boolean;
    derivedIndex?: number;
}

export const PREVIEW_LINES = 3;
export const PREVIEW_CHAR_LIMIT = 220;

export const buildPreviewMeta = (value: string): { chars: number; words: number; isLong: boolean } => {
    const trimmed = value.trim();
    const chars = trimmed.length;
    const words = trimmed ? trimmed.split(/\s+/).length : 0;
    const lineCount = trimmed.split(/\n/).length;
    return { chars, words, isLong: chars > PREVIEW_CHAR_LIMIT || lineCount > PREVIEW_LINES };
};

export const deriveEntryHeadline = (value: string): string => {
    const firstLine = value.trim().split(/\n/, 1)[0] ?? '';
    if (firstLine.length === 0) return 'Sin contenido';
    if (firstLine.length <= 90) return firstLine;
    return `${firstLine.slice(0, 87).trimEnd()}…`;
};

export const formatEntryTimestamp = (iso: string | null | undefined): string | null => {
    if (!iso) return null;
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
};

export const PRIORITY_BADGE_CLASSES: Record<MemoryPriority, string> = {
    high: 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-200',
    medium: 'bg-slate-200 text-slate-700 dark:bg-white/10 dark:text-slate-200',
    low: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200',
};

