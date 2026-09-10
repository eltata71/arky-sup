import { describe, it, expect } from 'vitest';
import { buildDiagramPreflightReport, analyzeDiagramQuality } from '../../services/diagram/quality/diagramQualityService';
import type { LayoutQualityMetrics } from '../../services/diagram/layoutQualityService';
import type { DiagramIR } from '../../lib/diagram';

const baseIR = (): DiagramIR => ({
    nodes: [
        { id: 'a', label: 'Cliente', kind: 'person' },
        { id: 'b', label: 'Sistema', kind: 'system' },
        { id: 'c', label: 'Externo', kind: 'external' },
    ],
    edges: [
        { id: 'e1', source: 'a', target: 'b', label: 'Usa', protocol: 'HTTPS' },
        { id: 'e2', source: 'b', target: 'c', label: 'Integra', protocol: 'REST' },
    ],
    groups: [],
    metadata: { diagramType: 'integration', title: 'Test' },
});

const baseMetrics = (over: Partial<LayoutQualityMetrics> = {}): LayoutQualityMetrics => ({
    hasLayout: true,
    nodeCount: 3,
    boundingBox: { x: 0, y: 0, width: 400, height: 200 },
    aspectRatio: 2,
    density: 0.2,
    overlappingNodePairs: [],
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
    ...over,
});

describe('buildDiagramPreflightReport — layout checks (Gap 14)', () => {
    it('passes a clean diagram without layout metrics', () => {
        const ir = baseIR();
        const quality = analyzeDiagramQuality(ir);
        const report = buildDiagramPreflightReport(ir, quality);
        expect(report.ready).toBe(true);
    });

    it('adds a fail check when nodes overlap', () => {
        const ir = baseIR();
        const quality = analyzeDiagramQuality(ir);
        const report = buildDiagramPreflightReport(ir, quality, {
            layoutMetrics: baseMetrics({ overlappingNodePairs: [{ a: 'a', b: 'b' }] }),
        });
        expect(report.checks.some((c) => c.id === 'layout-overlap' && c.status === 'fail')).toBe(true);
        expect(report.ready).toBe(false);
    });

    it('adds a fail check when boundaries are breached', () => {
        const ir = baseIR();
        const quality = analyzeDiagramQuality(ir);
        const report = buildDiagramPreflightReport(ir, quality, {
            layoutMetrics: baseMetrics({ boundaryContainmentBreaches: [{ groupId: 'g', nodeIds: ['a'] }] }),
        });
        expect(report.checks.some((c) => c.id === 'layout-boundary-breach' && c.status === 'fail')).toBe(true);
    });

    it('adds a fail check on export clip risk and excessive density', () => {
        const ir = baseIR();
        const quality = analyzeDiagramQuality(ir);
        const report = buildDiagramPreflightReport(ir, quality, {
            layoutMetrics: baseMetrics({ exportClipRisk: true, density: 0.65 }),
        });
        expect(report.checks.some((c) => c.id === 'layout-export-crop-risk' && c.status === 'fail')).toBe(true);
        expect(report.checks.some((c) => c.id === 'layout-density' && c.status === 'fail')).toBe(true);
    });

    it('does not add layout checks when no layout metrics were supplied', () => {
        const ir = baseIR();
        const quality = analyzeDiagramQuality(ir);
        const report = buildDiagramPreflightReport(ir, quality);
        const layoutIds = report.checks.map((c) => c.id).filter((id) => id.startsWith('layout-'));
        expect(layoutIds).toEqual([]);
    });
});
