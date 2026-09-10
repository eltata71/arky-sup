import { describe, it, expect } from 'vitest';
import type { DiagramIR } from '../../lib/diagram';
import { migrateDiagramIR, IR_SCHEMA_VERSION } from '../../services/diagram/irMigration';

describe('Phase 2 — IR migration v3', () => {
    it('bumps schemaVersion to 3', () => {
        expect(IR_SCHEMA_VERSION).toBe(3);
    });

    it('migrates a legacy v1 IR without losing the new optional fields', () => {
        const legacy: DiagramIR = {
            nodes: [
                {
                    id: 'a',
                    label: 'Member',
                    kind: 'actor',
                    owner: 'CX',
                    compliance: ['HIPAA'],
                    dataClassification: 'phi',
                },
            ],
            edges: [
                { id: 'e1', source: 'a', target: 'a', label: 'self', relation: 'sync', sla: '99.9%' },
            ],
            groups: [
                { id: 'g1', label: 'Domain', nodeIds: ['a'], purpose: 'PHI zone' },
            ],
            metadata: {
                title: 'Legacy diagram',
            },
        };
        const result = migrateDiagramIR(legacy);
        expect(result.ir.metadata?.schemaVersion).toBe(IR_SCHEMA_VERSION);
        // node migrated, fields preserved
        const node = result.ir.nodes[0];
        expect(node.owner).toBe('CX');
        expect(node.compliance).toEqual(['HIPAA']);
        expect(node.dataClassification).toBe('phi');
        // kind normalised to canonical (actor → person)
        expect(node.kind).toBe('person');
        // edges keep sla
        expect(result.ir.edges[0].sla).toBe('99.9%');
        // groups keep purpose
        expect(result.ir.groups[0].purpose).toBe('PHI zone');
    });

    it('is idempotent for already-migrated v3 IRs', () => {
        const v3: DiagramIR = {
            nodes: [{ id: 'a', label: 'A', kind: 'system' }],
            edges: [],
            groups: [],
            metadata: {
                schemaVersion: IR_SCHEMA_VERSION,
                generatedAt: '2026-05-24T00:00:00Z',
                sourceFormat: 'mermaid',
            },
        };
        const result = migrateDiagramIR(v3);
        expect(result.migrated).toBe(false);
        expect(result.ir).toBe(v3);
    });
});
