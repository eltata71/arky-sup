/**
 * Pure utility functions extracted from services and contexts for testability.
 * These functions contain core business logic with no side effects.
 *
 * Lo que este fichero **no** es, desde F3-08: el sitio donde se componen los
 * prompts. `buildGlobalPrompt`, `buildBasePrompt`, `buildArtifactsContext` y
 * `buildSiblingDiagramsPromptBlock` leían el contexto y la memoria de un
 * proyecto para redactar lo que se manda a un modelo —capa de IA, escrita en la
 * raíz del repositorio— y por eso este fichero importaba `services/ai` y
 * `services/memory`. Están en `services/ai/prompts/projectPrompts.ts`.
 */

import type { Artifact, GroupedArtifacts } from './types';

// --- JSON Extraction (from geminiService) ---

/**
 * Extracts valid JSON from LLM responses that may contain markdown fences,
 * preamble text, or trailing content.
 */
export function cleanJsonString(text: string): string {
  if (!text) return "{}";

  // 1. Remove Markdown code blocks first
  let clean = text.replace(/```json\s*/g, "").replace(/```\s*$/g, "").replace(/```/g, "");

  // 2. Surgical extraction: Find the JSON object/array within the text
  const firstBrace = clean.indexOf('{');
  const firstBracket = clean.indexOf('[');

  let startIndex = -1;
  let endIndex = -1;

  // Determine if it's likely an Object or an Array
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIndex = firstBrace;
    endIndex = clean.lastIndexOf('}');
  } else if (firstBracket !== -1) {
    startIndex = firstBracket;
    endIndex = clean.lastIndexOf(']');
  }

  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    clean = clean.substring(startIndex, endIndex + 1);
  }

  return clean.trim();
}

// --- Prompt Builders (from geminiService) ---

export function getLatestArtifacts(artifacts: Artifact[]): Artifact[] {
  const map = new Map<string, Artifact>();
  for (const artifact of artifacts) {
    const existing = map.get(artifact.versionGroupId);
    if (!existing || artifact.version > existing.version) {
      map.set(artifact.versionGroupId, artifact);
    }
  }
  return Array.from(map.values());
}

/**
 * Groups latest-version artifacts by their architecturalView.
 */
export function groupArtifactsByView(artifacts: Artifact[]): GroupedArtifacts {
  if (!Array.isArray(artifacts)) return {};

  const latest = getLatestArtifacts(artifacts);
  const result: GroupedArtifacts = {};
  for (const artifact of latest) {
    const view = artifact.architecturalView;
    if (!result[view]) result[view] = [];
    result[view].push(artifact);
  }
  return result;
}

/**
 * Finds the latest version of an artifact matching the given name.
 */
export function findLatestArtifactByName(artifacts: Artifact[], name: string): Artifact | undefined {
  return artifacts
    .filter(a => a.name === name)
    .sort((a, b) => b.version - a.version)[0];
}

// --- Array Utilities (from LMSContext toggle patterns) ---

/**
 * Toggles an item in an array: adds if missing, removes if present.
 */
export function toggleInArray<T>(arr: T[], item: T): T[] {
  return arr.includes(item) ? arr.filter(i => i !== item) : [...arr, item];
}

// --- File Type Helpers (from ChatInterface) ---

/**
 * Maps a MIME type string to a file icon emoji.
 */
export function getFileIcon(type: string): string {
  if (type.startsWith('image/')) return '🖼️';
  if (type === 'application/pdf') return '📄';
  if (type.includes('spreadsheet') || type.includes('csv')) return '📊';
  if (type.includes('presentation')) return '📑';
  return '📎';
}

// --- Memory Cache ---

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/**
 * In-memory TTL cache. Extracted from firestoreService for testability.
 */
export class MemoryCache {
  private store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string, ttlMs: number = 5 * 60 * 1000): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > ttlMs) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T): void {
    this.store.set(key, { data, timestamp: Date.now() });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }
}
