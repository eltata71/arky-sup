import { describe, it, expect } from 'vitest';
import {
    createChatMessage,
    ensureMessageIds,
    groupMessagesIntoSessions,
    filterSessions,
    getSessionTitle,
    removeMessagesById,
    spliceCompactionMarker,
} from '../chatHistory';
import type { ChatMessage } from '../ChatTypes';

const t = (offsetMinutes: number, base = new Date('2026-05-15T10:00:00.000Z')): string => {
    const d = new Date(base);
    d.setMinutes(d.getMinutes() + offsetMinutes);
    return d.toISOString();
};

const make = (role: ChatMessage['role'], content: string, timestamp: string): ChatMessage =>
    createChatMessage(role, content, { timestamp });

describe('createChatMessage', () => {
    it('populates id and timestamp by default', () => {
        const m = createChatMessage('user', 'hola');
        expect(m.id).toBeDefined();
        expect(m.timestamp).toBeDefined();
        expect(new Date(m.timestamp!).getTime()).not.toBeNaN();
    });

    it('respects provided overrides', () => {
        const m = createChatMessage('model', 'x', { id: 'fixed', timestamp: '2026-01-01T00:00:00.000Z' });
        expect(m.id).toBe('fixed');
        expect(m.timestamp).toBe('2026-01-01T00:00:00.000Z');
    });

    it('attaches meta when provided', () => {
        const m = createChatMessage('model', 'x', { meta: { kind: 'compaction', compactedCount: 5 } });
        expect(m.meta?.kind).toBe('compaction');
        expect(m.meta?.compactedCount).toBe(5);
    });

    it('produces unique ids across rapid calls', () => {
        const ids = Array.from({ length: 50 }, () => createChatMessage('user', 'x').id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('ensureMessageIds', () => {
    it('preserves existing ids', () => {
        const list: ChatMessage[] = [{ role: 'user', content: 'a', id: 'keep' }];
        const out = ensureMessageIds(list);
        expect(out[0].id).toBe('keep');
    });

    it('assigns deterministic legacy ids when missing', () => {
        const list: ChatMessage[] = [
            { role: 'user', content: 'hello' },
            { role: 'model', content: 'world' },
        ];
        const out1 = ensureMessageIds(list);
        const out2 = ensureMessageIds(list);
        expect(out1[0].id).toBeDefined();
        expect(out1[0].id).toBe(out2[0].id);
        expect(out1[0].id).not.toBe(out1[1].id);
    });
});

describe('groupMessagesIntoSessions', () => {
    it('returns empty when given no messages', () => {
        expect(groupMessagesIntoSessions([])).toEqual([]);
    });

    it('groups contiguous messages within the same day and gap', () => {
        const msgs = [
            make('user', 'q1', t(0)),
            make('model', 'a1', t(2)),
            make('user', 'q2', t(5)),
        ];
        const sessions = groupMessagesIntoSessions(msgs);
        expect(sessions).toHaveLength(1);
        expect(sessions[0].messages).toHaveLength(3);
        expect(sessions[0].stats.userMessages).toBe(2);
        expect(sessions[0].stats.modelMessages).toBe(1);
    });

    it('splits when the gap exceeds 30 minutes', () => {
        const msgs = [
            make('user', 'q1', t(0)),
            make('model', 'a1', t(2)),
            make('user', 'q2', t(45)),
        ];
        const sessions = groupMessagesIntoSessions(msgs);
        expect(sessions).toHaveLength(2);
        expect(sessions[0].messages).toHaveLength(2);
        expect(sessions[1].messages).toHaveLength(1);
    });

    it('splits across day boundaries', () => {
        const msgs = [
            make('user', 'q1', t(0, new Date('2026-05-15T22:00:00.000Z'))),
            make('user', 'q2', t(0, new Date('2026-05-16T00:30:00.000Z'))),
        ];
        const sessions = groupMessagesIntoSessions(msgs);
        // Both day boundary and a >30min gap force a split — at least 2 sessions.
        expect(sessions.length).toBeGreaterThanOrEqual(2);
    });

    it('isolates compaction markers into their own session', () => {
        const compaction = createChatMessage('model', '📦 resumen', {
            timestamp: t(1),
            meta: { kind: 'compaction', compactedCount: 4 },
        });
        const msgs = [
            make('user', 'q', t(0)),
            compaction,
            make('user', 'siguiente', t(2)),
        ];
        const sessions = groupMessagesIntoSessions(msgs);
        // Compaction sits on its own session even though times are contiguous.
        expect(sessions.length).toBeGreaterThanOrEqual(2);
        expect(sessions.some((s) => s.stats.hasCompaction)).toBe(true);
    });

    it('handles legacy messages without timestamps', () => {
        const legacy: ChatMessage[] = [
            { role: 'user', content: 'hola' },
            { role: 'model', content: 'mundo' },
        ];
        const sessions = groupMessagesIntoSessions(legacy);
        expect(sessions).toHaveLength(1);
        expect(sessions[0].day).toBe('sin-fecha');
    });
});

describe('filterSessions', () => {
    const sessions = groupMessagesIntoSessions([
        make('user', 'Hablemos de PostgreSQL', t(0)),
        make('model', 'Claro, PostgreSQL es relacional', t(1)),
        make('user', 'Y de Kubernetes?', t(5)),
    ]);

    it('returns all sessions when no filters are set', () => {
        expect(filterSessions(sessions, {})).toEqual(sessions);
    });

    it('filters by keyword (case-insensitive)', () => {
        const out = filterSessions(sessions, { query: 'POSTGRES' });
        expect(out.length).toBeGreaterThan(0);
        const fail = filterSessions(sessions, { query: 'mongodb' });
        expect(fail).toHaveLength(0);
    });

    it('filters by role', () => {
        const userOnly = filterSessions(sessions, { role: 'user' });
        expect(userOnly).toHaveLength(1);
        const modelOnly = filterSessions(sessions, { role: 'model' });
        expect(modelOnly).toHaveLength(1);
    });

    it('respects fromDate (inclusive)', () => {
        const out = filterSessions(sessions, { fromDate: '2026-05-14' });
        expect(out.length).toBeGreaterThan(0);
        const empty = filterSessions(sessions, { fromDate: '2030-01-01' });
        expect(empty).toHaveLength(0);
    });

    it('respects toDate (end-of-day inclusive)', () => {
        const out = filterSessions(sessions, { toDate: '2026-05-15' });
        expect(out.length).toBeGreaterThan(0);
        const empty = filterSessions(sessions, { toDate: '2020-01-01' });
        expect(empty).toHaveLength(0);
    });
});

describe('getSessionTitle', () => {
    it('returns the first user message truncated', () => {
        const sessions = groupMessagesIntoSessions([
            make('model', 'Hola', t(0)),
            make('user', 'Mi pregunta de hoy es sobre Kubernetes', t(1)),
        ]);
        expect(getSessionTitle(sessions[0])).toContain('Kubernetes');
    });

    it('falls back to first message when no user message exists', () => {
        const sessions = groupMessagesIntoSessions([make('model', 'Hola, soy el Arquitecto Jefe', t(0))]);
        expect(getSessionTitle(sessions[0])).toContain('Arquitecto');
    });
});

describe('removeMessagesById', () => {
    it('removes only the specified ids', () => {
        const msgs = [
            createChatMessage('user', 'a', { id: 'A', timestamp: t(0) }),
            createChatMessage('model', 'b', { id: 'B', timestamp: t(1) }),
            createChatMessage('user', 'c', { id: 'C', timestamp: t(2) }),
        ];
        const out = removeMessagesById(msgs, new Set(['B']));
        expect(out).toHaveLength(2);
        expect(out.map((m) => m.id)).toEqual(['A', 'C']);
    });

    it('tolerates legacy messages without ids', () => {
        const msgs: ChatMessage[] = [
            { role: 'user', content: 'a' },
            { role: 'model', content: 'b' },
        ];
        const withIds = ensureMessageIds(msgs);
        const ids = withIds.map((m) => m.id!).filter(Boolean);
        const out = removeMessagesById(msgs, new Set([ids[0]]));
        expect(out).toHaveLength(1);
    });
});

describe('spliceCompactionMarker', () => {
    it('replaces selected messages with the marker at the first removed slot', () => {
        const msgs = [
            createChatMessage('user', 'a', { id: 'A', timestamp: t(0) }),
            createChatMessage('model', 'b', { id: 'B', timestamp: t(1) }),
            createChatMessage('user', 'c', { id: 'C', timestamp: t(2) }),
            createChatMessage('model', 'd', { id: 'D', timestamp: t(3) }),
        ];
        const marker = createChatMessage('model', 'resumen', {
            id: 'M',
            timestamp: t(10),
            meta: { kind: 'compaction', compactedCount: 2 },
        });
        const out = spliceCompactionMarker(msgs, new Set(['B', 'C']), marker);
        expect(out.map((m) => m.id)).toEqual(['A', 'M', 'D']);
        expect(out[1].meta?.kind).toBe('compaction');
    });

    it('appends the marker when no messages match (defensive)', () => {
        const msgs = [createChatMessage('user', 'a', { id: 'A', timestamp: t(0) })];
        const marker = createChatMessage('model', 'resumen', { id: 'M', meta: { kind: 'compaction' } });
        const out = spliceCompactionMarker(msgs, new Set(['unknown']), marker);
        expect(out[out.length - 1].id).toBe('M');
    });
});
