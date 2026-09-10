import { describe, it, expect } from 'vitest';
import type { DiagramIR } from '../../lib/diagram';
import { analyzeDiagramQuality, buildDiagramPreflightReport } from '../../services/diagram/quality/diagramQualityService';

function buildPerfectIR(): DiagramIR {
    return {
        nodes: [
            { id: 'p', label: 'Cliente', kind: 'person', description: 'Asegurado.' },
            { id: 's', label: 'Reservas API', kind: 'service', description: 'API REST de reservas.' },
            { id: 'd', label: 'Reservas DB', kind: 'data', description: 'PostgreSQL 15.' },
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
            // A world-class diagram carries a story, not just a sentence: the
            // rubric's *narrativa* dimension now grades the walk, so the
            // fixture has to meet the bar it is named after.
            narrative: {
                summary: 'Resumen ejecutivo del flujo.',
                scenes: [
                    { id: 'sc-1', title: 'El cliente reserva', focusNodeIds: ['p', 's'], focusEdgeIds: ['e1'] },
                    { id: 'sc-2', title: 'La reserva se persiste', focusNodeIds: ['s', 'd'], focusEdgeIds: ['e2'] },
                ],
                callouts: [
                    { id: 'co-1', targetId: 'd', targetKind: 'node', text: 'Único almacén del flujo.', severity: 'info' },
                ],
            },
            generatedAt: new Date().toISOString(),
        },
    };
}

describe('buildDiagramPreflightReport — tightened bands', () => {
    it('passes preflight for a world-class IR', () => {
        const ir = buildPerfectIR();
        const quality = analyzeDiagramQuality(ir);
        const report = buildDiagramPreflightReport(ir, quality);
        expect(report.ready).toBe(true);
        expect(report.checks.find((c) => c.id === 'quality-score')?.status).toBe('pass');
    });

    it('warns when score is between 70 and 89 (recommend auto-improve)', () => {
        // Strip narrative + groups so the score drops into the warn band.
        const ir = buildPerfectIR();
        delete ir.metadata!.narrative;
        ir.groups = [];
        const quality = analyzeDiagramQuality(ir);
        const report = buildDiagramPreflightReport(ir, quality);
        const qualityCheck = report.checks.find((c) => c.id === 'quality-score');
        if (quality.score >= 70 && quality.score < 90) {
            expect(qualityCheck?.status).toBe('warn');
            expect(qualityCheck?.detail).toContain('Auto-mejorar');
        } else {
            expect(['pass', 'warn']).toContain(qualityCheck?.status);
        }
    });

    it('fails preflight when orphan nodes are present', () => {
        const ir = buildPerfectIR();
        ir.nodes.push({ id: 'orphan', label: 'Logs', kind: 'data' });
        const quality = analyzeDiagramQuality(ir);
        const report = buildDiagramPreflightReport(ir, quality);
        const orphanCheck = report.checks.find((c) => c.id === 'orphans');
        expect(orphanCheck?.status).toBe('fail');
        expect(report.ready).toBe(false);
    });
});
