/**
 * Deterministic text-normalization and similarity helpers for the Architecture
 * Knowledge Graph.
 *
 * These helpers underpin entity deduplication (Task 5): they strip accents,
 * normalize casing/whitespace, slugify names for stable ids and compute a
 * token-overlap similarity so equivalent entities ("API Gateway" vs
 * "Gateway API") can be merged carefully — without losing evidence.
 */

import type { ArchitectureEntityType } from './ArchitectureKnowledgeGraphTypes';

/** Removes diacritics so "Pagos" and "Págos" compare equal. */
export const stripAccents = (value: string): string =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Lowercased, accent-free, single-spaced form used for comparison. */
export const normalizeName = (value: string): string =>
  stripAccents(String(value ?? ''))
    .toLowerCase()
    .replace(/[`'"“”’]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** URL/id-safe slug. Always returns a non-empty token. */
export const slugify = (value: string): string => {
  const slug = normalizeName(value).replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return slug.length > 0 ? slug.slice(0, 64) : 'item';
};

/** Collapses whitespace and trims; safe on `null`/`undefined`. */
export const cleanText = (value: string | null | undefined): string =>
  String(value ?? '').replace(/\s+/g, ' ').trim();

/** Truncates a snippet for storage in a source ref excerpt. */
export const truncate = (value: string, max = 220): string => {
  const text = cleanText(value);
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
};

const STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'y', 'o', 'para', 'por',
  'con', 'sin', 'the', 'a', 'an', 'of', 'and', 'or', 'to', 'for', 'in', 'on',
]);

/** Splits a normalized name into meaningful tokens (stopwords removed). */
export const tokenize = (value: string): string[] =>
  normalizeName(value)
    .split(/[\s-]+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));

/**
 * Token-overlap (Jaccard) similarity in [0..1]. Robust to word order so
 * "API Gateway" and "Gateway API" score 1, while unrelated names score ~0.
 */
export const tokenSimilarity = (a: string, b: string): number => {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  tokensA.forEach((token) => {
    if (tokensB.has(token)) intersection += 1;
  });
  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
};

/**
 * Decides whether two names are similar enough to be considered the *same*
 * entity. Exact normalized match always wins; otherwise a high token overlap
 * is required so distinct-but-related names ("BFF Gateway" vs "API Gateway")
 * are kept apart and only flagged as candidate duplicates elsewhere.
 */
export const isSameEntityName = (a: string, b: string): boolean => {
  const normA = normalizeName(a);
  const normB = normalizeName(b);
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  // Singular/plural tolerance for short names.
  if (normA.replace(/s$/, '') === normB.replace(/s$/, '')) return true;
  return false;
};

/**
 * Whether two entity types are compatible enough to merge. Some types are
 * deliberately interchangeable when extraction is uncertain (e.g. `system`
 * and `application`); `unknown` merges into anything.
 */
const TYPE_FAMILIES: ArchitectureEntityType[][] = [
  ['system', 'application', 'externalSystem'],
  ['container', 'component', 'module'],
  ['dataStore', 'database'],
  ['requirement', 'functionalRequirement'],
  ['event', 'domainEvent', 'topic'],
];

export const areEntityTypesCompatible = (
  a: ArchitectureEntityType,
  b: ArchitectureEntityType,
): boolean => {
  if (a === b) return true;
  if (a === 'unknown' || b === 'unknown') return true;
  return TYPE_FAMILIES.some((family) => family.includes(a) && family.includes(b));
};

/** Picks the more specific of two compatible types (prefers non-`unknown`). */
export const pickMoreSpecificType = (
  a: ArchitectureEntityType,
  b: ArchitectureEntityType,
): ArchitectureEntityType => {
  if (a === 'unknown') return b;
  if (b === 'unknown') return a;
  // Prefer the more specific member of a family (later entries are broader).
  const family = TYPE_FAMILIES.find((f) => f.includes(a) && f.includes(b));
  if (family) return family.indexOf(a) <= family.indexOf(b) ? a : b;
  return a;
};

/** Deterministic entity id — stable across rebuilds for the same name+type. */
export const buildEntityId = (type: ArchitectureEntityType, normalizedName: string): string =>
  `ake-${type}-${slugify(normalizedName)}`;

/** Deterministic relation id. */
export const buildRelationId = (
  type: string,
  sourceEntityId: string,
  targetEntityId: string,
): string => `akr-${type}-${sourceEntityId}__${targetEntityId}`;

/** Clamps a confidence value into the [0..1] range. */
export const clampConfidence = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
};
