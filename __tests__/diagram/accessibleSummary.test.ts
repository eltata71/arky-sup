import { describe, expect, it } from 'vitest';
import type { DiagramIR } from '../../lib/diagram';
import {
    buildAccessibleSummary,
    buildShortAriaDescription,
} from '../../services/diagram/accessibleSummary';

const baseIR = (overrides: Partial<DiagramIR> = {}): DiagramIR => ({
    nodes: [
        { id: 'p1', label: 'Asegurado',     kind: 'person',         semanticRole: 'person',  semanticType: 'human-actor' },
        { id: 's1', label: 'Portal Web',    kind: 'application',    semanticRole: 'system',  semanticType: 'portal' },
        { id: 'g1', label: 'API Gateway',   kind: 'gateway',        semanticRole: 'gateway', semanticType: 'integration-platform' },
        { id: 'd1', label: 'PostgreSQL',    kind: 'database',       semanticRole: 'data',    semanticType: 'database', technology: 'PostgreSQL 15' },
    ],
    edges: [
        { id: 'e1', source: 'p1', target: 's1', label: 'usa',         relation: 'sync',    protocol: 'HTTPS', criticality: 'high' },
        { id: 'e2', source: 's1', target: 'g1', label: 'invoca',      relation: 'sync',    protocol: 'REST' },
        { id: 'e3', source: 'g1', target: 'd1', label: 'consulta',    relation: 'data-flow', protocol: 'JDBC' },
    ],
    groups: [{ id: 'data', label: 'Capa de Datos', nodeIds: ['d1'] }],
    metadata: { title: 'PBM - Diagrama de Integración', audience: 'technical' },
    ...overrides,
});

describe('buildAccessibleSummary', () => {
    it('produces a non-empty summary for a typical diagram', () => {
        const summary = buildAccessibleSummary(baseIR());
        expect(summary.headline).toMatch(/PBM/);
        expect(summary.headline).toMatch(/4 elementos/);
        expect(summary.keyNodes.length).toBeGreaterThan(0);
        expect(summary.keyFlows.length).toBeGreaterThan(0);
        expect(summary.fullText).toContain('Asegurado');
        expect(summary.fullText).toContain('Capa de Datos');
        expect(summary.fullText).toContain('PostgreSQL');
    });

    it('orders nodes by semantic importance (person/external first)', () => {
        const summary = buildAccessibleSummary(baseIR());
        // The first key node should be the person actor (Asegurado).
        expect(summary.keyNodes[0]).toMatch(/Asegurado/);
    });

    it('renders edge labels with protocol and source/target', () => {
        const summary = buildAccessibleSummary(baseIR());
        // The critical sync edge should appear in keyFlows because it has
        // protocol + criticality, ranking it first.
        const first = summary.keyFlows[0];
        expect(first).toMatch(/Asegurado/);
        expect(first).toMatch(/Portal Web/);
        expect(first).toMatch(/HTTPS/);
    });

    it('caps the number of named nodes and tails the rest', () => {
        const nodes = Array.from({ length: 20 }, (_, i) => ({
            id: `n${i}`, label: `Node ${i}`, kind: 'service',
        }));
        const summary = buildAccessibleSummary({ nodes, edges: [], groups: [] }, { maxNamedNodes: 5 });
        expect(summary.keyNodes.length).toBe(6); // 5 + tail
        expect(summary.keyNodes[5]).toMatch(/15 elemento\(s\) adicional/);
    });

    it('returns an empty-state summary when the IR has no nodes', () => {
        const summary = buildAccessibleSummary({ nodes: [], edges: [], groups: [] });
        expect(summary.headline).toMatch(/vacío/);
        expect(summary.keyNodes).toEqual([]);
        expect(summary.keyFlows).toEqual([]);
    });

    it('mentions the narrative when present', () => {
        const ir = baseIR({
            metadata: {
                title: 'Test',
                narrative: 'El sistema PBM procesa reclamos farmacéuticos en tiempo real.',
            },
        });
        const summary = buildAccessibleSummary(ir);
        expect(summary.fullText).toContain('Narrativa');
        expect(summary.fullText).toContain('PBM procesa reclamos');
    });

    it('uses the audience to colour the opener verb', () => {
        const ir = baseIR({ metadata: { title: 'X', audience: 'executive' } });
        const summary = buildAccessibleSummary(ir);
        expect(summary.headline).toMatch(/ejecutiva/i);
    });
});

describe('buildShortAriaDescription', () => {
    it('returns a single-line description suitable for an ARIA attribute', () => {
        const desc = buildShortAriaDescription(baseIR());
        expect(desc.length).toBeLessThan(400);
        expect(desc).toMatch(/Descripción accesible/);
    });

    it('does not include the full bulleted detail', () => {
        const desc = buildShortAriaDescription(baseIR());
        // The short description should NOT include the bulleted lists
        // (newlines and the "•" character).
        expect(desc).not.toContain('•');
    });
});
