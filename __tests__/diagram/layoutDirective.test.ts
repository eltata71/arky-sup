import { describe, expect, it } from 'vitest';
import type { DiagramIR } from '../../lib/diagram';
import { selectLayoutDirective } from '../../services/diagram/layoutDirective';

const baseIR = (overrides: Partial<DiagramIR> = {}): DiagramIR => ({
    nodes: [
        { id: 'a', label: 'A', kind: 'system' },
        { id: 'b', label: 'B', kind: 'system' },
        { id: 'c', label: 'C', kind: 'system' },
        { id: 'd', label: 'D', kind: 'system' },
    ],
    edges: [
        { id: 'e1', source: 'a', target: 'b', label: 'usa' },
        { id: 'e2', source: 'b', target: 'c', label: 'invoca' },
    ],
    groups: [],
    ...overrides,
});

describe('selectLayoutDirective', () => {
    it('returns horizontal for value stream maps', () => {
        const ir = baseIR({ metadata: { title: 'Mapa de Flujo de Valor — Reservas' } });
        const directive = selectLayoutDirective(ir);
        expect(directive.direction).toBe('LR');
        expect(directive.rationale).toMatch(/Value Stream/i);
    });

    it('returns horizontal for BPMN with lanes', () => {
        const ir = baseIR({
            metadata: { title: 'Proceso BPMN — Adjudicación' },
            groups: [
                { id: 'g1', label: 'Asegurado', nodeIds: ['a', 'b'] },
                { id: 'g2', label: 'PBM',       nodeIds: ['c', 'd'] },
            ],
        });
        const directive = selectLayoutDirective(ir);
        expect(directive.direction).toBe('LR');
        expect(directive.rationale).toMatch(/carriles/i);
    });

    it('returns vertical for BPMN without lanes', () => {
        const ir = baseIR({ metadata: { title: 'Proceso de Onboarding' } });
        const directive = selectLayoutDirective(ir);
        expect(directive.direction).toBe('TB');
    });

    it('returns vertical for integration diagrams', () => {
        const ir = baseIR({ metadata: { title: 'Diagrama de Integración — PBM' } });
        const directive = selectLayoutDirective(ir);
        expect(directive.direction).toBe('TB');
        expect(directive.rationale).toMatch(/capas/i);
    });

    it('returns horizontal for data flow diagrams', () => {
        const ir = baseIR({ metadata: { title: 'Flujo de Datos — Pipeline ETL' } });
        const directive = selectLayoutDirective(ir);
        expect(directive.direction).toBe('LR');
    });

    it('falls back to direction:null for generic diagrams', () => {
        const ir = baseIR({ metadata: { title: 'Otro diagrama cualquiera' } });
        const directive = selectLayoutDirective(ir);
        // Without an explicit archetype, the legacy heuristic should drive layout.
        expect(directive.direction).toBeNull();
    });

    it('uses density "spacious" for small C4 context diagrams', () => {
        const ir = baseIR({
            metadata: { title: 'Diagrama de Contexto C4' },
            nodes: [
                { id: 'p',  label: 'Asegurado', kind: 'person' },
                { id: 's',  label: 'Sistema PBM', kind: 'softwaresystem' },
                { id: 'ex', label: 'Farmacia',    kind: 'softwaresystem' },
            ],
        });
        const directive = selectLayoutDirective(ir);
        expect(directive.archetype).toBe('context');
        expect(directive.density).toBe('spacious');
    });

    it('compacts large integration diagrams', () => {
        const nodes = Array.from({ length: 22 }, (_, i) => ({
            id: `n${i}`,
            label: `Node ${i}`,
            kind: 'system',
        }));
        const ir = baseIR({
            metadata: { title: 'Diagrama de Integración Empresarial' },
            nodes,
            edges: [],
        });
        const directive = selectLayoutDirective(ir);
        expect(directive.density).toBe('compact');
    });
});
