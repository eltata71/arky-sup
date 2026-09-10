import { describe, it, expect } from 'vitest';
import type { DiagramIR } from '../../lib/diagram';
import { migrateDiagramIR } from '../../services/diagram/irMigration';

describe('Phase 3 — group.kind backfill on migration', () => {
    it('assigns swimlane to groups labelled like BPMN participants', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'a', label: 'A', kind: 'task' },
                { id: 'b', label: 'B', kind: 'task' },
            ],
            edges: [],
            groups: [
                { id: 'g1', label: 'Carril Member', nodeIds: ['a'] },
                { id: 'g2', label: 'Provider Lane', nodeIds: ['b'] },
            ],
            metadata: {},
        };
        const { ir: migrated } = migrateDiagramIR(ir);
        expect(migrated.groups.find((g) => g.id === 'g1')?.kind).toBe('swimlane');
        expect(migrated.groups.find((g) => g.id === 'g2')?.kind).toBe('swimlane');
    });

    it('assigns data / cloud / integration / security / legacy when labels match', () => {
        const ir: DiagramIR = {
            nodes: [{ id: 'a', label: 'A', kind: 'system' }],
            edges: [],
            groups: [
                { id: 'g1', label: 'Data Warehouse', nodeIds: ['a'] },
                { id: 'g2', label: 'AWS Cloud', nodeIds: ['a'] },
                { id: 'g3', label: 'Integration iPaaS', nodeIds: ['a'] },
                { id: 'g4', label: 'Security Zone DMZ', nodeIds: ['a'] },
                { id: 'g5', label: 'Mainframe Legacy', nodeIds: ['a'] },
            ],
        };
        const { ir: migrated } = migrateDiagramIR(ir);
        const byId = new Map(migrated.groups.map((g) => [g.id, g.kind] as const));
        expect(byId.get('g1')).toBe('data');
        expect(byId.get('g2')).toBe('cloud');
        expect(byId.get('g3')).toBe('integration');
        expect(byId.get('g4')).toBe('security');
        expect(byId.get('g5')).toBe('legacy');
    });

    it('falls back to cluster when no heuristic matches', () => {
        const ir: DiagramIR = {
            nodes: [{ id: 'a', label: 'A', kind: 'system' }],
            edges: [],
            groups: [{ id: 'g1', label: 'Misc Stuff', nodeIds: ['a'] }],
        };
        const { ir: migrated } = migrateDiagramIR(ir);
        expect(migrated.groups[0].kind).toBe('cluster');
    });

    it('never overrides an explicit group.kind', () => {
        const ir: DiagramIR = {
            nodes: [{ id: 'a', label: 'A', kind: 'system' }],
            edges: [],
            groups: [{ id: 'g1', label: 'AWS Cloud', nodeIds: ['a'], kind: 'enterprise' }],
        };
        const { ir: migrated } = migrateDiagramIR(ir);
        expect(migrated.groups[0].kind).toBe('enterprise');
    });
});
