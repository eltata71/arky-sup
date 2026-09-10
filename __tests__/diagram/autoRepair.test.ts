import { describe, it, expect } from 'vitest';
import { autoRepairIR } from '../../services/diagram/autoRepair';
import { detectArchitecturalViolations } from '../../services/diagram/guardrails';
import type { DiagramIR } from '../../lib/diagram';

const ctx = { type: 'mermaid-c4-container' as const, audience: 'technical' as const };

describe('autoRepairIR', () => {
    it('replaces generic edge labels with verb-driven phrases', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'svc', label: 'API', kind: 'service' },
                { id: 'db', label: 'Orders', kind: 'data' },
            ],
            edges: [{ id: 'e1', source: 'svc', target: 'db', label: 'data' }],
            groups: [],
        };
        const violations = detectArchitecturalViolations(ir, ctx);
        const result = autoRepairIR(ir, violations);
        const repairedEdge = result.ir.edges.find((e) => e.id === 'e1');
        expect(repairedEdge?.label).not.toBe('data');
        expect(result.applied.find((c) => c.code === 'EDGE_LABEL_GENERIC')).toBeTruthy();
    });

    it('inserts a synthetic gateway between an external system and a data store', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'partner', label: 'Stripe', kind: 'external' },
                { id: 'db', label: 'Orders', kind: 'data' },
            ],
            edges: [{ id: 'e1', source: 'partner', target: 'db', label: 'Lee pagos' }],
            groups: [],
        };
        const violations = detectArchitecturalViolations(ir, ctx);
        const result = autoRepairIR(ir, violations);
        expect(result.ir.nodes.length).toBeGreaterThan(2);
        const synthetic = result.ir.nodes.find((n) => n.kind === 'gateway');
        expect(synthetic).toBeTruthy();
        expect(result.ir.edges.length).toBeGreaterThan(1);
    });

    it('records repair history in metadata', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'svc', label: 'API', kind: 'service' },
                { id: 'db', label: 'Orders', kind: 'data' },
            ],
            edges: [{ id: 'e1', source: 'svc', target: 'db', label: 'data' }],
            groups: [],
        };
        const result = autoRepairIR(ir, detectArchitecturalViolations(ir, ctx));
        expect(result.ir.metadata?.repairHistory?.length).toBeGreaterThan(0);
    });
});
