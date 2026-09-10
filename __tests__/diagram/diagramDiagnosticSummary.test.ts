import { describe, it, expect } from 'vitest';
import { buildDiagramDiagnosticSummary } from '../../services/diagram/diagramDiagnosticSummary';
import type { DiagramQualityReport, DiagramPreflightReport } from '../../services/diagram/quality/diagramQualityService';
import type { DiagramIR } from '../../lib/diagram';

const baseIR = (over: Partial<DiagramIR> = {}): DiagramIR => ({
    nodes: over.nodes ?? [
        { id: 'a', label: 'Portal', kind: 'system' },
        { id: 'b', label: 'API', kind: 'service' },
    ],
    edges: over.edges ?? [{ id: 'e1', source: 'a', target: 'b', label: 'invoca' }],
    groups: over.groups ?? [],
    metadata: over.metadata,
});

const baseQuality = (over: Partial<DiagramQualityReport> = {}): DiagramQualityReport => ({
    score: 85,
    breakdown: {
        claridadSemantica: 80, consistenciaArquitectonica: 80, jerarquiaVisual: 80,
        legibilidad: 80, narrativa: 80, atractivoVisual: 80, preparacionEjecutiva: 80,
        preparacionTecnica: 80, exportabilidad: 80, mantenibilidadPipeline: 80,
    },
    issues: over.issues ?? [],
    summary: '',
    ...over,
});

const ready: DiagramPreflightReport = { ready: true, checks: [] };
const blocked: DiagramPreflightReport = {
    ready: false,
    checks: [{ id: 'integrity', label: 'Integridad estructural', status: 'fail', detail: 'Hay 1 referencia inválida.' }],
};

describe('buildDiagramDiagnosticSummary', () => {
    it('returns a green headline when preflight is ready and there are no critical issues', () => {
        const summary = buildDiagramDiagnosticSummary({
            ir: baseIR(),
            quality: baseQuality(),
            preflight: ready,
            source: 'ir-direct',
        });
        expect(summary.headline).toMatch(/listo/i);
        expect(summary.ready).toBe(true);
        expect(summary.source).toBe('ir-direct');
    });

    it('surfaces the blocking preflight check when export is gated', () => {
        const summary = buildDiagramDiagnosticSummary({
            ir: baseIR(),
            quality: baseQuality(),
            preflight: blocked,
        });
        expect(summary.ready).toBe(false);
        expect(summary.headline).toMatch(/bloqueada/i);
        expect(summary.headline).toContain('Integridad estructural'.toLowerCase());
    });

    it('groups issues by validation family and orders by total descending', () => {
        const issues = [
            { id: 'c1', code: 'C4_LEVEL_MIX', severity: 'high' as const, message: '', recommendation: '' },
            { id: 'c2', code: 'C4_INTERNAL_OUT_OF_BOUNDS', severity: 'medium' as const, message: '', recommendation: '' },
            { id: 'h1', code: 'HC_MISSING_PHI_CLASSIFICATION', severity: 'critical' as const, message: '', recommendation: '' },
        ];
        const summary = buildDiagramDiagnosticSummary({
            ir: baseIR(),
            quality: baseQuality({ issues }),
            preflight: ready,
        });
        const c4 = summary.validations.find((v) => v.family === 'c4');
        const hc = summary.validations.find((v) => v.family === 'healthcare-insurance');
        expect(c4?.total).toBe(2);
        expect(hc?.total).toBe(1);
        expect(hc?.bySeverity.critical).toBe(1);
    });

    it('recommends apply-elk-layout when there are overlaps in the metrics', () => {
        const summary = buildDiagramDiagnosticSummary({
            ir: baseIR(),
            quality: baseQuality({
                layoutMetrics: {
                    hasLayout: true,
                    nodeCount: 2,
                    boundingBox: { x: 0, y: 0, width: 100, height: 100 },
                    aspectRatio: 1,
                    density: 0.5,
                    overlappingNodePairs: [{ a: 'a', b: 'b' }],
                    edgeLabelCollisions: [],
                    overflowingLabels: [],
                    edgeCrossings: 0,
                    aspectStrip: null,
                    exportCropRisk: 'none',
                    overlappingGroupPairs: [],
                    boundaryContainmentBreaches: [],
                    nodesOutsideViewport: [],
                    edgesCrossingNodes: [],
                    nodesObscuredByObstacles: [],
                    excessiveEmptySpace: false,
                    exportClipRisk: false,
                },
            }),
            preflight: ready,
        });
        const kinds = summary.recommendedActions.map((a) => a.kind);
        expect(kinds).toContain('apply-elk-layout');
    });

    it('recommends tag-phi-pii and add-security-controls when healthcare issues exist', () => {
        const summary = buildDiagramDiagnosticSummary({
            ir: baseIR(),
            quality: baseQuality({
                issues: [
                    { id: 'h1', code: 'HC_MISSING_PHI_CLASSIFICATION', severity: 'critical', message: '', recommendation: '' },
                    { id: 'h2', code: 'HC_SENSITIVE_EDGE_MISSING_SECURITY', severity: 'high', message: '', recommendation: '' },
                ],
            }),
            preflight: ready,
        });
        const kinds = summary.recommendedActions.map((a) => a.kind);
        expect(kinds).toContain('tag-phi-pii');
        expect(kinds).toContain('add-security-controls');
    });

    it('recommends assign-group-kind when groups lack a kind', () => {
        const summary = buildDiagramDiagnosticSummary({
            ir: baseIR({ groups: [{ id: 'g', label: 'Domain', nodeIds: ['a'] }] }),
            quality: baseQuality(),
            preflight: ready,
        });
        const kinds = summary.recommendedActions.map((a) => a.kind);
        expect(kinds).toContain('assign-group-kind');
    });

    it('surfaces the persisted layout plan with userOverride flag', () => {
        const summary = buildDiagramDiagnosticSummary({
            ir: baseIR({
                metadata: {
                    layoutPlan: {
                        backend: 'elk', algorithm: 'layered', direction: 'LR',
                        density: 'compact', orthogonal: true, rationale: 'r', userOverride: true,
                    },
                },
            }),
            quality: baseQuality(),
            preflight: ready,
        });
        expect(summary.layout.backend).toBe('elk');
        expect(summary.layout.direction).toBe('LR');
        expect(summary.layout.userOverride).toBe(true);
    });

    it('returns empty metrics when there is no layout snapshot', () => {
        const summary = buildDiagramDiagnosticSummary({
            ir: baseIR(),
            quality: baseQuality(),
            preflight: ready,
        });
        expect(summary.metrics.hasLayout).toBe(false);
        expect(summary.metrics.nodeCount).toBe(baseIR().nodes.length);
    });
});
