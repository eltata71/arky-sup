import { describe, it, expect } from 'vitest';
import { detectArchitecturalViolations, passesArchitecturalGate } from '../../services/diagram/guardrails';
import type { DiagramIR } from '../../lib/diagram';

const baseIR: DiagramIR = { nodes: [], edges: [], groups: [] };

const ctx = { type: 'mermaid-c4-container' as const, audience: 'technical' as const };

describe('guardrails: detectArchitecturalViolations', () => {
    it('flags a UI bypassing the service layer', () => {
        const ir: DiagramIR = {
            ...baseIR,
            nodes: [
                { id: 'user', label: 'Customer', kind: 'person' },
                { id: 'db', label: 'Orders DB', kind: 'data' },
            ],
            edges: [{ id: 'e1', source: 'user', target: 'db', label: 'Reads orders' }],
        };
        const v = detectArchitecturalViolations(ir, ctx);
        expect(v.some((x) => x.code === 'C4_UI_BYPASSES_SERVICE')).toBe(true);
    });

    it('flags external systems touching internal data stores', () => {
        const ir: DiagramIR = {
            ...baseIR,
            nodes: [
                { id: 'partner', label: 'Stripe Cloud', kind: 'external' },
                { id: 'db', label: 'Orders DB', kind: 'data' },
            ],
            edges: [{ id: 'e1', source: 'partner', target: 'db', label: 'Reads orders' }],
        };
        const v = detectArchitecturalViolations(ir, ctx);
        expect(v.some((x) => x.code === 'C4_EXTERNAL_TOUCHES_DATA')).toBe(true);
    });

    it('flags generic edge labels', () => {
        const ir: DiagramIR = {
            ...baseIR,
            nodes: [
                { id: 'a', label: 'API', kind: 'service' },
                { id: 'b', label: 'Worker', kind: 'service' },
            ],
            edges: [{ id: 'e1', source: 'a', target: 'b', label: 'data' }],
        };
        const v = detectArchitecturalViolations(ir, ctx);
        expect(v.some((x) => x.code === 'EDGE_LABEL_GENERIC')).toBe(true);
    });

    it('does not flag protocol-rich technical edges', () => {
        const ir: DiagramIR = {
            ...baseIR,
            nodes: [
                { id: 'a', label: 'API', kind: 'service' },
                { id: 'b', label: 'Worker', kind: 'service' },
            ],
            edges: [{ id: 'e1', source: 'a', target: 'b', label: 'Llama vía HTTPS' }],
        };
        const v = detectArchitecturalViolations(ir, ctx);
        expect(v.some((x) => x.code === 'EDGE_MISSING_PROTOCOL')).toBe(false);
    });

    it('passesArchitecturalGate is true for clean IRs', () => {
        const ir: DiagramIR = {
            ...baseIR,
            nodes: [
                { id: 'a', label: 'API', kind: 'service' },
                { id: 'b', label: 'Worker', kind: 'service' },
            ],
            edges: [{ id: 'e1', source: 'a', target: 'b', label: 'Publica vía HTTPS' }],
        };
        expect(passesArchitecturalGate(ir, ctx)).toBe(true);
    });

    it('flags missing grouping when ≥5 ungrouped nodes', () => {
        const ir: DiagramIR = {
            ...baseIR,
            nodes: Array.from({ length: 6 }).map((_, i) => ({
                id: `n${i}`,
                label: `Service ${i}`,
                kind: 'service',
            })),
            edges: [],
        };
        const v = detectArchitecturalViolations(ir, ctx);
        expect(v.some((x) => x.code === 'GROUPING_RECOMMENDED')).toBe(true);
    });
});
