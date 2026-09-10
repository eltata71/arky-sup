import { describe, it, expect } from 'vitest';
import { migrateDiagramIR, IR_SCHEMA_VERSION } from '../../services/diagram/irMigration';
import type { DiagramIR } from '../../lib/diagram';

describe('irMigration', () => {
    it('normalises non-canonical kinds (db → data, queue → messaging, ...)', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'a', label: 'Orders DB', kind: 'db' },
                { id: 'b', label: 'Events', kind: 'queue' },
                { id: 'c', label: 'API', kind: 'api' },
            ],
            edges: [],
            groups: [],
        };
        const result = migrateDiagramIR(ir);
        expect(result.ir.nodes[0].kind).toBe('data');
        expect(result.ir.nodes[1].kind).toBe('messaging');
        expect(result.ir.nodes[2].kind).toBe('gateway');
        expect(result.changes.length).toBeGreaterThan(0);
    });

    it('drops dangling edges and group references', () => {
        const ir: DiagramIR = {
            nodes: [{ id: 'a', label: 'A', kind: 'service' }],
            edges: [
                { id: 'e1', source: 'a', target: 'ghost', label: '...' },
                { id: 'e2', source: 'a', target: 'a', label: 'self' },
            ],
            groups: [{ id: 'g1', label: 'G', nodeIds: ['a', 'ghost'] }],
        };
        const result = migrateDiagramIR(ir);
        expect(result.ir.edges).toHaveLength(1);
        expect(result.ir.groups[0].nodeIds).toEqual(['a']);
    });

    it('marks IR with the current schema version', () => {
        const ir: DiagramIR = {
            nodes: [{ id: 'a', label: 'A', kind: 'service' }],
            edges: [],
            groups: [],
        };
        const result = migrateDiagramIR(ir);
        expect((result.ir.metadata as { schemaVersion?: number } | undefined)?.schemaVersion).toBe(IR_SCHEMA_VERSION);
    });

    it('is idempotent: re-running on a migrated IR makes no changes', () => {
        const ir: DiagramIR = {
            nodes: [{ id: 'a', label: 'A', kind: 'service' }],
            edges: [],
            groups: [],
        };
        const first = migrateDiagramIR(ir);
        const second = migrateDiagramIR(first.ir);
        expect(second.migrated).toBe(false);
        expect(second.changes).toHaveLength(0);
    });
});
