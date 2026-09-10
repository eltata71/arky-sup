import { describe, it, expect } from 'vitest';
import type { DiagramIR } from '../../lib/diagram';
import { runDiagramQualityGate } from '../../services/diagram/qualityGate';
import { analyzeDiagramQuality } from '../../services/diagram/quality/diagramQualityService';

const artifact = {
    name: 'Mapa de Flujo de Valor — Reservas',
    type: 'mermaid-graph' as const,
    objective: 'Modelar el flujo de valor del proceso de reservas.',
    audience: 'technical' as const,
    theme: 'editorial' as const,
};

describe('runDiagramQualityGate', () => {
    it('lifts a low-quality IR over the world-class threshold when context allows', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'cliente', label: 'cliente', kind: 'person' },
                { id: 'g', label: 'API Gateway', kind: 'gateway' },
                { id: 's1', label: 'Reservas Svc', kind: 'service' },
                { id: 's2', label: 'Pagos Svc', kind: 'service' },
                { id: 'q', label: 'Eventos Reserva', kind: 'messaging' },
                { id: 'd', label: 'DB Reservas', kind: 'data' },
            ],
            edges: [
                { id: 'e1', source: 'cliente', target: 'g', label: '' },
                { id: 'e2', source: 'g', target: 's1', label: 'data' },
                { id: 'e3', source: 's1', target: 'q', label: '' },
                { id: 'e4', source: 'q', target: 's2', label: '' },
                { id: 'e5', source: 's2', target: 'd', label: 'data' },
            ],
            groups: [],
        };
        const before = analyzeDiagramQuality(ir);
        const result = runDiagramQualityGate(ir, { artifact, audience: 'technical', targetScore: 90 });
        expect(result.quality.score).toBeGreaterThan(before.score);
        // The gate produced repair history.
        expect(result.changes.length).toBeGreaterThan(0);
        expect(result.history.length).toBeGreaterThan(1);
    });

    it('returns the input unchanged when score already meets target', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'p', label: 'Cliente', kind: 'person', description: 'Usuario final.' },
                { id: 's', label: 'Reservas API', kind: 'service', description: 'API REST de reservas.' },
                { id: 'd', label: 'DB Reservas', kind: 'data', description: 'PostgreSQL con reservas.' },
            ],
            edges: [
                { id: 'e1', source: 'p', target: 's', label: 'Crea reserva REST/HTTPS', relation: 'sync' },
                { id: 'e2', source: 's', target: 'd', label: 'Persiste reserva JDBC', relation: 'sync' },
            ],
            groups: [{ id: 'g1', label: 'Capa de servicio', nodeIds: ['s', 'd'] }],
            metadata: {
                title: 'Reservas',
                audience: 'technical',
                theme: 'editorial',
                density: 'standard',
                narrative: 'Cliente crea reserva, API la persiste.',
                generatedAt: new Date().toISOString(),
            },
        };
        const result = runDiagramQualityGate(ir, { artifact, audience: 'technical' });
        expect(result.changes.length).toBe(0);
        expect(result.reachedTarget).toBe(true);
    });

    it('plateaus gracefully when no further repair is possible', () => {
        const ir: DiagramIR = { nodes: [], edges: [], groups: [] };
        const result = runDiagramQualityGate(ir, { artifact, audience: 'technical' });
        // Empty IR — score stays at 0 and no infinite loop. The first pass
        // may still fill metadata defaults, so we just guard against runaway
        // iteration.
        expect(result.history.length).toBeLessThanOrEqual(4);
        expect(result.quality.score).toBe(0);
    });

    it('enriches integration diagrams with protocol-aware edge metadata', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'user', label: 'Usuario', kind: 'person' },
                { id: 'gateway', label: 'API Gateway', kind: 'gateway' },
                { id: 'orders', label: 'Órdenes API', kind: 'service', technology: 'Node.js' },
                { id: 'events', label: 'Eventos', kind: 'messaging', technology: 'Kafka' },
                { id: 'store', label: 'PostgreSQL', kind: 'data', technology: 'PostgreSQL 15' },
            ],
            edges: [
                { id: 'e1', source: 'user', target: 'gateway', label: 'Usa' },
                { id: 'e2', source: 'gateway', target: 'orders', label: 'Enruta' },
                { id: 'e3', source: 'orders', target: 'events', label: 'Publica', relation: 'async' },
                { id: 'e4', source: 'orders', target: 'store', label: 'Guarda', relation: 'data-flow' },
            ],
            groups: [],
        };

        const result = runDiagramQualityGate(ir, {
            artifact,
            audience: 'technical',
            targetScore: 90,
            aggressive: true,
        });

        expect(result.ir.edges.every((edge) => edge.protocol && edge.protocol.length > 0)).toBe(true);
        expect(result.ir.edges.every((edge) => /http|rest|kafka|jdbc/i.test(`${edge.label} ${edge.protocol}`))).toBe(true);
        expect(result.quality.breakdown.preparacionTecnica).toBeGreaterThanOrEqual(85);
        expect(result.changes.some((change) => change.code === 'EDGE_PROTOCOL_INFERRED')).toBe(true);
    });

});
