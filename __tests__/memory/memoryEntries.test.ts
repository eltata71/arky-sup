import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MEMORY_PRIORITY,
  appendMemoryNotes,
  createMemoryEntry,
  formatMemoryEntryAnnotation,
  formatMemoryTextsForPrompt,
  memoryEntriesToTexts,
  normalizeMemoryPriority,
  reconcileMemoryEntries,
  resolveMemoryExtractionScope,
  sanitizeMemoryEntryList,
  sortMemoryEntriesByRecency,
  sortMemoryEntriesForContext,
} from '../../services/memory/memoryEntries';
import type { MemoryEntry } from '../../types';

const entry = (overrides: Partial<MemoryEntry> & { text: string }): MemoryEntry => ({
  id: overrides.id ?? `id-${overrides.text}`,
  text: overrides.text,
  priority: overrides.priority ?? DEFAULT_MEMORY_PRIORITY,
  createdAt: overrides.createdAt ?? null,
  updatedAt: overrides.updatedAt ?? null,
  authorId: overrides.authorId ?? null,
  authorName: overrides.authorName ?? null,
});

describe('memoryEntries', () => {
  describe('createMemoryEntry', () => {
    it('defaults to prioridad media with a timestamp and the given author', () => {
      const created = createMemoryEntry('Usar Kafka', { authorId: 'u1', authorName: 'Ana' });
      expect(created.priority).toBe('medium');
      expect(created.createdAt).toBeTruthy();
      expect(created.authorId).toBe('u1');
      expect(created.authorName).toBe('Ana');
      expect(created.id).toBeTruthy();
    });

    it('accepts explicit priority and null createdAt', () => {
      const created = createMemoryEntry('Nota legacy', { priority: 'high', createdAt: null });
      expect(created.priority).toBe('high');
      expect(created.createdAt).toBeNull();
    });
  });

  describe('normalizeMemoryPriority', () => {
    it('falls back to medium on unknown values', () => {
      expect(normalizeMemoryPriority('urgent')).toBe('medium');
      expect(normalizeMemoryPriority(undefined)).toBe('medium');
      expect(normalizeMemoryPriority('low')).toBe('low');
      expect(normalizeMemoryPriority('high')).toBe('high');
    });
  });

  describe('sanitizeMemoryEntryList', () => {
    it('drops malformed items and repairs missing fields', () => {
      const sane = sanitizeMemoryEntryList([
        { text: 'ok', priority: 'high', createdAt: '2026-01-01T00:00:00Z' },
        { noText: true },
        'just a string',
        null,
      ]);
      expect(sane).toHaveLength(1);
      expect(sane[0].text).toBe('ok');
      expect(sane[0].priority).toBe('high');
      expect(sane[0].id).toBeTruthy();
    });
  });

  describe('reconcileMemoryEntries', () => {
    it('treats the text mirror as canonical and matches entries by text', () => {
      const entries = [
        entry({ text: 'A', priority: 'high', createdAt: '2026-01-01T00:00:00Z', authorName: 'Ana' }),
        entry({ text: 'B', priority: 'low' }),
      ];
      const result = reconcileMemoryEntries(['A', 'C'], entries);
      expect(result).toHaveLength(2);
      expect(result[0].priority).toBe('high');
      expect(result[0].authorName).toBe('Ana');
      // 'C' was added by a legacy writer → metadata-less entry.
      expect(result[1].text).toBe('C');
      expect(result[1].priority).toBe('medium');
      expect(result[1].createdAt).toBeNull();
    });

    it('handles duplicated texts by consuming entries at most once', () => {
      const entries = [
        entry({ id: 'one', text: 'X', priority: 'high' }),
        entry({ id: 'two', text: 'X', priority: 'low' }),
      ];
      const result = reconcileMemoryEntries(['X', 'X'], entries);
      expect(result.map((e) => e.id)).toEqual(['one', 'two']);
    });

    it('returns legacy entries for plain string arrays', () => {
      const result = reconcileMemoryEntries(['uno', 'dos'], undefined);
      expect(result).toHaveLength(2);
      expect(result.every((e) => e.createdAt === null && e.priority === 'medium')).toBe(true);
    });
  });

  describe('sortMemoryEntriesByRecency', () => {
    it('orders newest → oldest with undated notes last (stable)', () => {
      const result = sortMemoryEntriesByRecency([
        entry({ id: 'legacy-1', text: 'legacy 1' }),
        entry({ id: 'old', text: 'old', createdAt: '2025-01-01T00:00:00Z' }),
        entry({ id: 'new', text: 'new', createdAt: '2026-06-01T00:00:00Z' }),
        entry({ id: 'legacy-2', text: 'legacy 2' }),
      ]);
      expect(result.map((e) => e.id)).toEqual(['new', 'old', 'legacy-1', 'legacy-2']);
    });

    it('uses updatedAt over createdAt when present', () => {
      const result = sortMemoryEntriesByRecency([
        entry({ id: 'a', text: 'a', createdAt: '2026-01-01T00:00:00Z' }),
        entry({ id: 'b', text: 'b', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z' }),
      ]);
      expect(result.map((e) => e.id)).toEqual(['b', 'a']);
    });
  });

  describe('sortMemoryEntriesForContext', () => {
    it('orders by prioridad (alta > media > baja) and then by recency', () => {
      const result = sortMemoryEntriesForContext([
        entry({ id: 'low-new', text: 'low new', priority: 'low', createdAt: '2026-06-01T00:00:00Z' }),
        entry({ id: 'med-old', text: 'med old', createdAt: '2025-01-01T00:00:00Z' }),
        entry({ id: 'high-old', text: 'high old', priority: 'high', createdAt: '2024-01-01T00:00:00Z' }),
        entry({ id: 'med-new', text: 'med new', createdAt: '2026-01-01T00:00:00Z' }),
      ]);
      expect(result.map((e) => e.id)).toEqual(['high-old', 'med-new', 'med-old', 'low-new']);
    });
  });

  describe('formatMemoryEntryAnnotation', () => {
    it('returns empty for default-priority undated anonymous notes', () => {
      expect(formatMemoryEntryAnnotation(entry({ text: 'plain' }))).toBe('');
    });

    it('includes prioridad, fecha y autor when present', () => {
      const annotated = formatMemoryEntryAnnotation(
        entry({ text: 'x', priority: 'high', createdAt: '2026-06-01T10:30:00Z', authorName: 'Ana' }),
      );
      expect(annotated).toContain('prioridad alta');
      expect(annotated).toContain('2026-06-01');
      expect(annotated).toContain('Ana');
    });
  });

  describe('formatMemoryTextsForPrompt', () => {
    it('is byte-identical to the input for legacy data (no metadata)', () => {
      const texts = ['uno', 'dos', 'tres'];
      expect(formatMemoryTextsForPrompt(texts, undefined)).toEqual(texts);
    });

    it('reorders and annotates when metadata exists', () => {
      const entries = [
        entry({ text: 'baja', priority: 'low', createdAt: '2026-06-01T00:00:00Z' }),
        entry({ text: 'alta', priority: 'high', createdAt: '2025-01-01T00:00:00Z' }),
      ];
      const lines = formatMemoryTextsForPrompt(['baja', 'alta'], entries);
      expect(lines[0]).toContain('alta');
      expect(lines[0]).toContain('prioridad alta');
      expect(lines[1]).toContain('baja');
    });

    it('omits annotations when annotate=false but keeps ordering', () => {
      const entries = [
        entry({ text: 'baja', priority: 'low' }),
        entry({ text: 'alta', priority: 'high' }),
      ];
      const lines = formatMemoryTextsForPrompt(['baja', 'alta'], entries, { annotate: false });
      expect(lines).toEqual(['alta', 'baja']);
    });
  });

  describe('resolveMemoryExtractionScope', () => {
    it('maps agent-base and chat-history to the project agent scope', () => {
      expect(resolveMemoryExtractionScope('agent-base')).toBe('agent');
      expect(resolveMemoryExtractionScope('chat-history')).toBe('agent');
    });

    it('passes the supported scopes through unchanged', () => {
      expect(resolveMemoryExtractionScope('global')).toBe('global');
      expect(resolveMemoryExtractionScope('project')).toBe('project');
      expect(resolveMemoryExtractionScope('agent')).toBe('agent');
      expect(resolveMemoryExtractionScope('initial-capture')).toBe('initial-capture');
      expect(resolveMemoryExtractionScope('artifact')).toBe('artifact');
    });
  });

  describe('appendMemoryNotes', () => {
    it('stamps author + timestamp on new notes and dedupes case-insensitively', () => {
      const existingEntries = [entry({ text: 'Usar Kafka', priority: 'high' })];
      const result = appendMemoryNotes({
        existingTexts: ['Usar Kafka'],
        existingEntries,
        newTexts: ['usar kafka', 'Nueva decisión: OAuth regional'],
        authorId: 'agent',
        authorName: 'Arquitecto Agente',
      });
      expect(result.added).toEqual(['Nueva decisión: OAuth regional']);
      expect(result.texts).toEqual(['Usar Kafka', 'Nueva decisión: OAuth regional']);
      expect(result.entries[0].priority).toBe('high');
      expect(result.entries[1].authorName).toBe('Arquitecto Agente');
      expect(result.entries[1].createdAt).toBeTruthy();
      expect(memoryEntriesToTexts(result.entries)).toEqual(result.texts);
    });
  });
});
