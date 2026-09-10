import { describe, expect, it } from 'vitest';
import type { DiagramIR } from '../../lib/diagram';
import { analyzeDiagramQuality } from '../../services/diagram/quality/diagramQualityService';

function buildIR(partial: Partial<DiagramIR>): DiagramIR {
    return {
        nodes: partial.nodes ?? [],
        edges: partial.edges ?? [],
        groups: partial.groups ?? [],
        metadata: partial.metadata,
    };
}

describe('analyzeDiagramQuality — real rubric heuristics', () => {
    it('rewards a richly annotated diagram above a blank one', () => {
        const blank: DiagramIR = buildIR({});
        const rich: DiagramIR = buildIR({
            nodes: [
                { id: 'user', label: 'Cliente', kind: 'Person', description: 'Asegurado que pide cotización.' },
                { id: 'api', label: 'API de Cotizaciones', kind: 'Service', description: 'Endpoint REST.' },
                { id: 'db', label: 'Base Actuarial', kind: 'Data', description: 'PostgreSQL 15 con tarifas.' },
            ],
            edges: [
                { id: 'e1', source: 'user', target: 'api', label: 'Solicita cotización', relation: 'sync' },
                { id: 'e2', source: 'api', target: 'db', label: 'Consulta tarifas REST/HTTPS', relation: 'sync' },
            ],
            groups: [{ id: 'g1', label: 'Sistemas Core', nodeIds: ['api', 'db'] }],
            metadata: { audience: 'technical', title: 'Cotización Grupal', generatedAt: new Date().toISOString() },
        });

        const blankReport = analyzeDiagramQuality(blank);
        const richReport = analyzeDiagramQuality(rich);

        expect(richReport.score).toBeGreaterThan(blankReport.score);
        expect(richReport.score).toBeGreaterThanOrEqual(60);
    });

    it('dimensions do not all move together (narrativa and preparacionTecnica decouple)', () => {
        // Narrative-heavy but technical-poor diagram.
        const ir = buildIR({
            nodes: [
                { id: 'a', label: 'Alpha', kind: 'Service' },
                { id: 'b', label: 'Beta', kind: 'Service' },
            ],
            edges: [
                { id: 'e1', source: 'a', target: 'b', label: 'Envía pedido confirmado' },
            ],
        });
        const r = analyzeDiagramQuality(ir);
        // narrativa > preparacionTecnica because edges are actionable but nodes
        // have no descriptions / tech badges.
        expect(r.breakdown.narrativa).toBeGreaterThan(r.breakdown.preparacionTecnica);
    });

    it('penalises orphan nodes with a high-severity issue', () => {
        const ir = buildIR({
            nodes: [
                { id: 'a', label: 'A', kind: 'Service' },
                { id: 'b', label: 'B', kind: 'Service' },
                { id: 'c', label: 'Huérfano', kind: 'Service' },
            ],
            edges: [{ id: 'e1', source: 'a', target: 'b', label: 'calls' }],
        });
        const r = analyzeDiagramQuality(ir);
        expect(r.issues.some(i => i.code === 'ORPHAN_NODE' && i.severity === 'high')).toBe(true);
    });

    it('gives preparacionEjecutiva a large score when node count is small and narrative is present', () => {
        const ir = buildIR({
            nodes: [
                { id: 'u', label: 'Cliente', kind: 'Person' },
                { id: 'api', label: 'API', kind: 'Service' },
                { id: 'db', label: 'DB', kind: 'Data' },
            ],
            edges: [
                { id: 'e1', source: 'u', target: 'api', label: 'Solicita' },
                { id: 'e2', source: 'api', target: 'db', label: 'Consulta' },
            ],
            metadata: { audience: 'executive', narrative: 'Resumen ejecutivo', title: 'Flujo clave' },
        });
        const r = analyzeDiagramQuality(ir);
        expect(r.breakdown.preparacionEjecutiva).toBeGreaterThanOrEqual(75);
    });
});
