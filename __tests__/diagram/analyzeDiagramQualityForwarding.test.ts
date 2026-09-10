import { describe, it, expect } from 'vitest';
import { analyzeDiagramQuality } from '../../services/diagram/quality/diagramQualityService';
import type { DiagramIR } from '../../lib/diagram';

/**
 * Gap 1 — analyzeDiagramQuality must forward the extended layout snapshot
 * (nodeRects + groupRects + viewport + floatingObstacles + edgeSegments)
 * to computeLayoutQuality so the resulting issues / metrics reflect the
 * real canvas state, not an approximation.
 */

const baseIR = (over: Partial<DiagramIR> = {}): DiagramIR => ({
    nodes: over.nodes ?? [
        { id: 'a', label: 'Portal', kind: 'system', group: 'Frontend' },
        { id: 'b', label: 'API', kind: 'service', group: 'Backend' },
        { id: 'c', label: 'DB', kind: 'data', group: 'Backend' },
    ],
    edges: over.edges ?? [
        { id: 'e1', source: 'a', target: 'b', label: 'invoca' },
        { id: 'e2', source: 'b', target: 'c', label: 'lee' },
    ],
    groups: over.groups ?? [
        { id: 'gA', label: 'Frontend', nodeIds: ['a'] },
        { id: 'gB', label: 'Backend', nodeIds: ['b', 'c'] },
    ],
    metadata: over.metadata,
});

describe('analyzeDiagramQuality — extended snapshot forwarding (Gap 1)', () => {
    it('detects boundary containment breaches when groupRects are supplied', () => {
        const ir = baseIR();
        // Group "Backend" rect is small and the DB rect escapes it.
        const report = analyzeDiagramQuality(ir, {
            layoutRects: [
                { id: 'a', x: 0,   y: 0,   width: 200, height: 100 },
                { id: 'b', x: 300, y: 0,   width: 200, height: 100 },
                { id: 'c', x: 800, y: 0,   width: 200, height: 100 }, // outside Backend
            ],
            groupRects: [
                { id: 'gA', label: 'Frontend', x: -20,  y: -20, width: 240, height: 140, memberIds: ['a'] },
                { id: 'gB', label: 'Backend',  x: 280,  y: -20, width: 240, height: 140, memberIds: ['b', 'c'] },
            ],
        });
        expect(report.layoutMetrics).toBeDefined();
        expect(report.layoutMetrics!.boundaryContainmentBreaches.length).toBeGreaterThan(0);
        const breach = report.layoutMetrics!.boundaryContainmentBreaches.find((b) => b.groupId === 'gB');
        expect(breach?.nodeIds).toContain('c');
    });

    it('flags nodes outside the canvas viewport', () => {
        const ir = baseIR();
        const report = analyzeDiagramQuality(ir, {
            layoutRects: [
                { id: 'a', x: 0,   y: 0,   width: 200, height: 100 },
                { id: 'b', x: 300, y: 0,   width: 200, height: 100 },
                { id: 'c', x: 5000, y: 5000, width: 200, height: 100 }, // off-screen
            ],
            viewport: { x: -100, y: -100, width: 1000, height: 600 },
        });
        expect(report.layoutMetrics!.nodesOutsideViewport).toContain('c');
    });

    it('flags nodes obscured by floating obstacles (toolbar / panels)', () => {
        const ir = baseIR();
        const report = analyzeDiagramQuality(ir, {
            layoutRects: [
                { id: 'a', x: 0,   y: 0,   width: 200, height: 100 },
                { id: 'b', x: 300, y: 0,   width: 200, height: 100 },
                { id: 'c', x: 0,   y: 500, width: 200, height: 100 }, // under toolbar
            ],
            floatingObstacles: [
                { x: -20, y: 480, width: 800, height: 200, label: 'Toolbar inferior' },
            ],
        });
        const obstacles = report.layoutMetrics!.nodesObscuredByObstacles;
        expect(obstacles.some((o) => o.nodeId === 'c')).toBe(true);
        expect(obstacles.some((o) => o.obstacle === 'Toolbar inferior')).toBe(true);
    });

    it('uses provided edgeSegments waypoints to detect edges through other nodes', () => {
        const ir = baseIR({
            edges: [
                { id: 'e1', source: 'a', target: 'c', label: 'pasa' }, // goes through b
                { id: 'e2', source: 'b', target: 'b', label: 'self' },
            ],
        });
        const report = analyzeDiagramQuality(ir, {
            layoutRects: [
                { id: 'a', x: 0,   y: 0, width: 100, height: 100 },
                { id: 'b', x: 200, y: 0, width: 100, height: 100 },
                { id: 'c', x: 400, y: 0, width: 100, height: 100 },
            ],
            edgeSegments: [
                {
                    id: 'e1',
                    source: 'a',
                    target: 'c',
                    waypoints: [
                        { x: 50,  y: 50 },
                        { x: 450, y: 50 },
                    ],
                },
            ],
        });
        const through = report.layoutMetrics!.edgesCrossingNodes;
        const e1 = through.find((t) => t.edgeId === 'e1');
        expect(e1?.throughNodeIds).toContain('b');
    });

    it('falls back to IR-only lints when layoutRects are missing', () => {
        const ir = baseIR();
        const report = analyzeDiagramQuality(ir, {});
        expect(report.layoutMetrics).toBeUndefined();
    });
});
