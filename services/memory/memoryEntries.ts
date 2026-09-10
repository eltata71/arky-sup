/**
 * services/memory/memoryEntries — single source of truth for the structured
 * memory-note model (fecha/hora, autor, prioridad) used by every memory scope
 * of the Centro de Memoria.
 *
 * Storage model (backwards compatible):
 *  - The legacy `string[]` fields (`globalContext`, `projectContext`,
 *    `agentMemory`, `initialCapture`, `artifactMemory`) remain the canonical
 *    mirror of note TEXTS. Every existing consumer keeps working untouched.
 *  - The parallel `*Entries: MemoryEntry[]` fields carry the per-note
 *    metadata. `reconcileMemoryEntries` merges both at read time so writers
 *    that only know about the legacy arrays (older flows, guided creation…)
 *    never corrupt the metadata of the notes they didn't touch.
 *
 * Pure module: no I/O, no React, no Gemini.
 */

import type { MemoryEntry, MemoryPriority, MemoryScope } from '../../types';

export const MEMORY_PRIORITIES: readonly MemoryPriority[] = ['high', 'medium', 'low'] as const;

/** Toda nota nace con prioridad media; el usuario la puede subir o bajar. */
export const DEFAULT_MEMORY_PRIORITY: MemoryPriority = 'medium';

/** Peso relativo usado al ponderar notas dentro de un mismo ámbito. */
export const MEMORY_PRIORITY_WEIGHT: Record<MemoryPriority, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

export const MEMORY_PRIORITY_LABEL_ES: Record<MemoryPriority, string> = {
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
};

let memoryIdCounter = 0;

/** Stable, collision-resistant id for a memory note. */
export function createMemoryEntryId(): string {
  memoryIdCounter = (memoryIdCounter + 1) % 1_000_000;
  return `mem-${Date.now().toString(36)}-${memoryIdCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeMemoryPriority(value: unknown): MemoryPriority {
  return value === 'high' || value === 'low' || value === 'medium' ? value : DEFAULT_MEMORY_PRIORITY;
}

export interface CreateMemoryEntryOptions {
  priority?: MemoryPriority;
  authorId?: string | null;
  authorName?: string | null;
  /** ISO timestamp override; defaults to now. */
  createdAt?: string | null;
}

/** Builds a brand-new note with metadata (default priority: media, fecha: ahora). */
export function createMemoryEntry(text: string, opts: CreateMemoryEntryOptions = {}): MemoryEntry {
  return {
    id: createMemoryEntryId(),
    text: typeof text === 'string' ? text : String(text ?? ''),
    priority: normalizeMemoryPriority(opts.priority),
    createdAt: opts.createdAt !== undefined ? opts.createdAt : new Date().toISOString(),
    updatedAt: null,
    authorId: opts.authorId ?? null,
    authorName: opts.authorName ?? null,
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Sanitizes a raw value (Firestore read, localStorage rehydration) into a
 * `MemoryEntry`, or `null` when the shape is unrecoverable.
 */
export function sanitizeMemoryEntry(raw: unknown): MemoryEntry | null {
  if (!isObject(raw)) return null;
  const text = typeof raw.text === 'string' ? raw.text : null;
  if (text === null) return null;
  return {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : createMemoryEntryId(),
    text,
    priority: normalizeMemoryPriority(raw.priority),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : null,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    authorId: typeof raw.authorId === 'string' ? raw.authorId : null,
    authorName: typeof raw.authorName === 'string' ? raw.authorName : null,
  };
}

/** Sanitizes a raw list, dropping unrecoverable items. */
export function sanitizeMemoryEntryList(raw: unknown): MemoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => sanitizeMemoryEntry(item))
    .filter((item): item is MemoryEntry => item !== null);
}

/**
 * Reconciles the legacy text mirror with the structured entries.
 *
 * The TEXT list decides WHICH notes exist (legacy writers only touch it);
 * the entries list contributes metadata, matched by exact trimmed text and
 * consumed at most once each (duplicated texts keep distinct entries).
 * Texts without a matching entry become "legacy" entries (sin fecha, sin
 * autor, prioridad media). Entries whose text disappeared from the mirror
 * are dropped — the mirror is canonical.
 *
 * Always returns one entry per non-empty text, in mirror order.
 */
export function reconcileMemoryEntries(
  texts: string[] | null | undefined,
  entries: MemoryEntry[] | null | undefined,
): MemoryEntry[] {
  const cleanTexts = (Array.isArray(texts) ? texts : [])
    .map((item) => (typeof item === 'string' ? item : ''))
    .filter((item) => item.trim().length > 0);
  const pool = sanitizeMemoryEntryList(entries);
  const consumed = new Set<number>();

  return cleanTexts.map((text) => {
    const key = text.trim();
    const matchIndex = pool.findIndex((entry, index) => !consumed.has(index) && entry.text.trim() === key);
    if (matchIndex >= 0) {
      consumed.add(matchIndex);
      return pool[matchIndex];
    }
    // Legacy note — keep it usable but explicitly metadata-less so the UI can
    // show "Sin fecha" instead of inventing a timestamp at read time.
    return {
      id: createMemoryEntryId(),
      text,
      priority: DEFAULT_MEMORY_PRIORITY,
      createdAt: null,
      updatedAt: null,
      authorId: null,
      authorName: null,
    };
  });
}

/** Projects the entries back into the legacy text mirror. */
export function memoryEntriesToTexts(entries: MemoryEntry[]): string[] {
  return entries.map((entry) => entry.text);
}

const entryTime = (entry: MemoryEntry): number => {
  const stamp = entry.updatedAt ?? entry.createdAt;
  if (!stamp) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(stamp);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
};

/**
 * Display order required by the Centro de Memoria: cronológico, de la más
 * reciente a la más antigua. Notas legacy sin fecha van al final, preservando
 * su orden relativo original. Stable.
 */
export function sortMemoryEntriesByRecency(entries: MemoryEntry[]): MemoryEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const timeA = entryTime(a.entry);
      const timeB = entryTime(b.entry);
      // Dated notes first (newest → oldest); undated keep insertion order.
      if (timeA !== timeB) return timeB > timeA ? 1 : -1;
      return a.index - b.index;
    })
    .map(({ entry }) => entry);
}

/**
 * Context-assembly order WITHIN a single scope: prioridad del usuario primero
 * (alta > media > baja) y, a igual prioridad, la más reciente primero. Las
 * notas sin fecha conservan su orden de inserción al final de su banda de
 * prioridad. Stable.
 */
export function sortMemoryEntriesForContext(entries: MemoryEntry[]): MemoryEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const weight = MEMORY_PRIORITY_WEIGHT[b.entry.priority] - MEMORY_PRIORITY_WEIGHT[a.entry.priority];
      if (weight !== 0) return weight;
      const timeA = entryTime(a.entry);
      const timeB = entryTime(b.entry);
      if (timeA !== timeB) return timeB > timeA ? 1 : -1;
      return a.index - b.index;
    })
    .map(({ entry }) => entry);
}

/**
 * Compact metadata annotation rendered before a note inside an AI prompt,
 * e.g. `[prioridad alta · 2026-06-01 · Ana Pérez]`. Returns an empty string
 * when the note carries no signal beyond the defaults, so legacy prompts
 * stay byte-identical for legacy data.
 */
export function formatMemoryEntryAnnotation(entry: MemoryEntry): string {
  const parts: string[] = [];
  if (entry.priority !== DEFAULT_MEMORY_PRIORITY) {
    parts.push(`prioridad ${MEMORY_PRIORITY_LABEL_ES[entry.priority].toLowerCase()}`);
  }
  if (entry.createdAt) {
    const date = entry.createdAt.slice(0, 10);
    if (date) parts.push(date);
  }
  if (entry.authorName) parts.push(entry.authorName);
  return parts.length > 0 ? `[${parts.join(' · ')}] ` : '';
}

/**
 * Convenience for prompt builders that only have the legacy mirror at hand:
 * reconciles, orders by prioridad + recencia and returns annotated texts.
 * With legacy data (no entries) the output equals the input order/text, so
 * existing prompts and their tests stay stable.
 */
export function formatMemoryTextsForPrompt(
  texts: string[] | null | undefined,
  entries: MemoryEntry[] | null | undefined,
  opts: { limit?: number; annotate?: boolean } = {},
): string[] {
  const reconciled = reconcileMemoryEntries(texts, entries);
  const hasMetadata = reconciled.some(
    (entry) => entry.createdAt !== null || entry.priority !== DEFAULT_MEMORY_PRIORITY,
  );
  const ordered = hasMetadata ? sortMemoryEntriesForContext(reconciled) : reconciled;
  const limited = typeof opts.limit === 'number' && opts.limit >= 0 ? ordered.slice(0, opts.limit) : ordered;
  const annotate = opts.annotate !== false;
  return limited.map((entry) => (annotate ? `${formatMemoryEntryAnnotation(entry)}${entry.text}` : entry.text));
}

/**
 * Appends agent/user-authored notes to a scope, deduplicating by text
 * (case-insensitive) against what already exists. Returns the merged entries
 * plus the texts mirror, ready for a single persistence call.
 */
export function appendMemoryNotes(input: {
  existingTexts: string[] | null | undefined;
  existingEntries: MemoryEntry[] | null | undefined;
  newTexts: string[];
  authorId?: string | null;
  authorName?: string | null;
  priority?: MemoryPriority;
}): { entries: MemoryEntry[]; texts: string[]; added: string[] } {
  const reconciled = reconcileMemoryEntries(input.existingTexts, input.existingEntries);
  const seen = new Set(reconciled.map((entry) => entry.text.trim().toLowerCase()));
  const added: string[] = [];
  const appended = [...reconciled];
  for (const raw of input.newTexts) {
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    added.push(text);
    appended.push(createMemoryEntry(text, {
      priority: input.priority,
      authorId: input.authorId,
      authorName: input.authorName,
    }));
  }
  return { entries: appended, texts: memoryEntriesToTexts(appended), added };
}

/**
 * The document-extraction prompt (`extractMemoryEntriesFromDocument`) accepts
 * only a subset of the memory scopes: `global`, `project`, `agent`,
 * `initial-capture` and `artifact`. The base agent identity (`agent-base`) and
 * the chat history hold no project context of their own, so a document
 * extracted there lands in the project-scoped agent memory (`agent`) instead.
 * Lives here — not in the UI — so the mapping is a domain decision, testable in
 * isolation and shared by any future consumer.
 */
export function resolveMemoryExtractionScope(scope: MemoryScope): 'global' | 'project' | 'agent' | 'initial-capture' | 'artifact' {
  if (scope === 'agent-base' || scope === 'chat-history') return 'agent';
  return scope;
}
