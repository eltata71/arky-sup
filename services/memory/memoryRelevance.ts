/**
 * Which memory notes are relevant to a question, ranked (plan de calidad de
 * artefactos, 7.2a).
 *
 * This lived inside the agent's context composer, so only the chat could
 * rank memory by relevance, priority and recency: the AI layer — which
 * composes every artifact prompt — imports nothing from `services/agent`, and
 * sent the notes in stored order, the first eight or all of them. Selecting
 * notes is the memory module's own language; both layers already import it.
 *
 * Pure: no I/O, no model calls.
 */
import type { MemoryEntry } from '../../types';
import {
  formatMemoryEntryAnnotation,
  MEMORY_PRIORITY_WEIGHT,
  reconcileMemoryEntries,
  sortMemoryEntriesForContext,
} from './memoryEntries';

/**
 * Truncates a bullet to at most `charCap` characters, preserving word
 * boundaries when possible.
 */
export function compactBullet(value: string, charCap: number): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (trimmed.length <= charCap) return trimmed;
  // Try to cut at the last word boundary to avoid mid-word truncation.
  const slice = trimmed.slice(0, charCap - 1);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > Math.floor(charCap * 0.6) ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

/**
 * Score a single memory bullet against a free-form query. Higher = more
 * relevant. The scoring is deliberately conservative (stemmed token overlap +
 * length penalty + recency tie-breaker) so the composer stays sync and
 * cheap. Embeddings can replace this later without touching call sites.
 *
 * Matching is "semantic-lite": accents are folded, plurals collapse and a
 * light Spanish/English suffix stemmer makes word families match
 * ("integración" ↔ "integraciones" ↔ "integrar", "sistema" ↔ "sistemas",
 * "payment" ↔ "payments"). Deterministic, no AI calls.
 */

/** Removes diacritics so "integración" and "integracion" compare equal. */
function foldAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Derivational suffixes stripped (longest first) when the remaining stem
 * keeps ≥ 4 characters. Covers the most frequent Spanish word families in
 * architecture notes plus light English endings.
 */
const STEM_SUFFIXES = [
  'aciones', 'iciones', 'uciones', 'amientos', 'imientos',
  'amiento', 'imiento', 'adoras', 'adores', 'idades',
  'acion', 'icion', 'ucion', 'encias', 'encia', 'anzas', 'anza',
  'mente', 'adora', 'ador', 'antes', 'ante', 'ibles', 'ible', 'ables', 'able',
  'istas', 'ista', 'ciones', 'cion', 'siones', 'sion',
  'ation', 'ations', 'ments', 'ment', 'ings', 'ing',
  'ando', 'iendo', 'ados', 'adas', 'ado', 'ada', 'idos', 'idas', 'ido', 'ida',
];

/** Light stemmer: fold accents, lowercase, strip plural + derivational suffix. */
export function stemMatchToken(token: string): string {
  let stem = foldAccents(token.toLowerCase());
  for (const suffix of STEM_SUFFIXES) {
    if (stem.length - suffix.length >= 4 && stem.endsWith(suffix)) {
      stem = stem.slice(0, stem.length - suffix.length);
      break;
    }
  }
  // Plural collapse: "sistemas" → "sistema", "redes" → "red".
  if (stem.length >= 5 && stem.endsWith('es') && !/[aeiou]es$/.test(stem)) {
    stem = stem.slice(0, -2);
  } else if (stem.length >= 4 && stem.endsWith('s')) {
    stem = stem.slice(0, -1);
  }
  return stem;
}

function tokenizeForMatching(text: string): string[] {
  return Array.from(
    new Set(
      foldAccents(text.toLowerCase())
        .split(/[^a-z0-9ñ]+/iu)
        .filter((t) => t.length >= 3)
        .map((t) => stemMatchToken(t)),
    ),
  );
}

/** Two stems match exactly or by a shared prefix of ≥ 5 characters. */
function stemsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const min = Math.min(a.length, b.length);
  if (min < 5) return false;
  return a.startsWith(b) || b.startsWith(a);
}

export function scoreBulletForQuery(bullet: string, query: string): number {
  if (!query) return 0;
  const queryStems = tokenizeForMatching(query);
  if (queryStems.length === 0) return 0;
  const bulletStems = tokenizeForMatching(bullet);
  if (bulletStems.length === 0) return 0;
  let hits = 0;
  for (const queryStem of queryStems) {
    if (bulletStems.some((bulletStem) => stemsMatch(queryStem, bulletStem))) hits += 1;
  }
  if (hits === 0) return 0;
  // Normalise by query token count so a 6-token query matching 3 tokens
  // scores 0.5 — comparable across queries of different length.
  const coverage = hits / queryStems.length;
  // Mild length penalty: very long bullets contain more "noise"; we still
  // surface them, just slightly lower.
  const lengthPenalty = Math.max(0, (bullet.length - 220) / 4000);
  return Math.max(0, coverage - lengthPenalty);
}

export interface SelectRelevantMemoryOptions {
  items: string[];
  /** Free-form text used to score relevance (typically the user's question). */
  query?: string;
  /** Max bullets to keep. Higher-scoring bullets win; ties keep order. */
  limit: number;
  /** Per-bullet character cap. */
  bulletCharCap: number;
}

/**
 * Picks the most relevant bullets for a query. When `query` is empty (or no
 * bullets hit the query) we fall back to the natural order so the user sees
 * a stable, predictable subset rather than a random sample.
 *
 * Pure: no I/O, no Gemini calls.
 */
export function selectRelevantMemory(opts: SelectRelevantMemoryOptions): string[] {
  const { items, query, limit, bulletCharCap } = opts;
  const cleaned = (items ?? [])
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
  if (cleaned.length === 0 || limit <= 0) return [];

  if (!query?.trim()) {
    return cleaned.slice(0, limit).map((b) => compactBullet(b, bulletCharCap));
  }

  // Score each bullet, then sort by score descending while preserving the
  // original order on ties (stable sort via index tiebreaker).
  const indexed = cleaned.map((value, index) => ({
    value,
    index,
    score: scoreBulletForQuery(value, query),
  }));
  const positive = indexed.filter((entry) => entry.score > 0);

  if (positive.length === 0) {
    // No semantic hit — fall back to natural order (recency is implicit in
    // how memories are appended) rather than skipping the section entirely.
    return cleaned.slice(0, limit).map((b) => compactBullet(b, bulletCharCap));
  }

  positive.sort((a, b) => (b.score - a.score) || (a.index - b.index));
  return positive.slice(0, limit).map((entry) => compactBullet(entry.value, bulletCharCap));
}

export interface SelectRelevantMemoryEntriesOptions {
  /** Legacy text mirror of the scope (canonical list of notes). */
  texts: string[] | null | undefined;
  /** Structured metadata entries of the scope (fecha, autor, prioridad). */
  entries: MemoryEntry[] | null | undefined;
  /** Free-form text used to score relevance (typically the user's question). */
  query?: string;
  /** Max bullets to keep. */
  limit: number;
  /** Per-bullet character cap. */
  bulletCharCap: number;
  /**
   * An extra score per note, added to relevance, priority and recency — a
   * profile's own signal (the diagram profile favours notes that name a
   * technology or a regulation). With it, notes are ranked even without a query.
   */
  extraScore?: (text: string) => number;
}

/** A selected note: the entry, and the line a prompt shows for it. */
export interface RankedMemoryNote {
  entry: MemoryEntry;
  /** Annotation (prioridad · fecha · autor) plus the note, capped. */
  rendered: string;
}

/**
 * The ranking behind {@link selectRelevantMemoryEntries}, keeping the entry so
 * a caller can compare notes across scopes by their text rather than by an
 * annotated line (the artifact context bundle drops a note repeated in two
 * scopes).
 */
export function rankRelevantMemoryEntries(opts: SelectRelevantMemoryEntriesOptions): RankedMemoryNote[] {
  const { texts, entries, query, limit, bulletCharCap, extraScore } = opts;
  if (limit <= 0) return [];
  const reconciled = reconcileMemoryEntries(texts, entries).filter((entry) => entry.text.trim().length > 0);
  if (reconciled.length === 0) return [];

  const ordered = sortMemoryEntriesForContext(reconciled);
  const rank = (entry: MemoryEntry): RankedMemoryNote => ({
    entry,
    rendered: `${formatMemoryEntryAnnotation(entry)}${compactBullet(entry.text, bulletCharCap)}`,
  });

  if (!query?.trim() && !extraScore) {
    return ordered.slice(0, limit).map(rank);
  }

  // Rank-based recency boost computed over the dated notes only.
  const dated = [...reconciled]
    .filter((entry) => entry.createdAt !== null)
    .sort((a, b) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? ''));
  const recencyRank = new Map(dated.map((entry, index) => [entry.id, index]));
  const recencyBoost = (entry: MemoryEntry): number => {
    const position = recencyRank.get(entry.id);
    if (position === undefined || dated.length === 0) return 0;
    return 0.2 * (1 - position / dated.length);
  };
  const priorityBoost = (entry: MemoryEntry): number =>
    (MEMORY_PRIORITY_WEIGHT[entry.priority] - MEMORY_PRIORITY_WEIGHT.low) * 0.2;

  const scored = ordered.map((entry, index) => ({
    entry,
    index,
    score: scoreBulletForQuery(entry.text, query ?? '') + priorityBoost(entry) + recencyBoost(entry) + (extraScore?.(entry.text) ?? 0),
  }));
  scored.sort((a, b) => (b.score - a.score) || (a.index - b.index));
  return scored.slice(0, limit).map((item) => rank(item.entry));
}

/**
 * Metadata-aware evolution of `selectRelevantMemory`. The composite score per
 * note is:
 *
 *   relevance (0..1, token overlap with the query)
 *   + priority boost   (alta +0.40 · media +0.20 · baja +0)
 *   + recency boost    (0..0.20, rank-based on createdAt; sin fecha = 0)
 *
 * so a highly relevant low-priority note still beats an irrelevant
 * high-priority one, while ties resolve by prioridad del usuario y después
 * por fecha (más reciente primero) — exactly the ordering contract of the
 * Centro de Memoria. Without a query the notes are ordered by prioridad +
 * recencia. Each selected note is rendered with its compact metadata
 * annotation so the model can also weigh fecha/autor/prioridad.
 *
 * Pure: no I/O, no Gemini calls.
 */
export function selectRelevantMemoryEntries(opts: SelectRelevantMemoryEntriesOptions): string[] {
  return rankRelevantMemoryEntries(opts).map((note) => note.rendered);
}
