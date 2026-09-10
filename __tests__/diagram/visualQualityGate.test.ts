import { describe, expect, it } from 'vitest';
import type { Node } from 'reactflow';
import { runVisualQualityGate } from '../../services/diagram/visualQualityGate';
import type { DiagramIR } from '../../lib/diagram';

const baseIR: DiagramIR = {
  nodes: [{ id: 'n1', label: 'App', kind: 'service' }],
  edges: [],
  groups: [],
  metadata: { diagramType: 'integration' },
};

const baseNodes: Node[] = [{ id: 'n1', type: 'custom', data: { label: 'App' }, position: { x: 0, y: 0 }, width: 240, height: 120 }];

describe('visualQualityGate', () => {
  it('blocks when multiple high-severity signals are detected', () => {
    const result = runVisualQualityGate({
      ir: baseIR,
      nodes: baseNodes,
      recentRenderErrors: 2,
      exportPreflightOk: false,
      layoutMetrics: {
        hasLayout: true,
        nodeCount: 1,
        boundingBox: { x: 0, y: 0, width: 100, height: 100 },
        aspectRatio: 1,
        density: 0.6,
        overlappingNodePairs: [],
        edgeLabelCollisions: [],
        overflowingLabels: [],
        edgeCrossings: 0,
        aspectStrip: null,
        exportCropRisk: 'none',
        overlappingGroupPairs: [{ a: 'g1', b: 'g2' }],
        boundaryContainmentBreaches: [],
        nodesOutsideViewport: [],
        edgesCrossingNodes: [{ edgeId: 'e1', throughNodeIds: ['n1'] }],
        nodesObscuredByObstacles: [{ nodeId: 'n1', obstacle: 'inspector' }],
        excessiveEmptySpace: false,
        exportClipRisk: false,
      },
    });

    expect(result.state).toBe('blocked');
    expect(result.score).toBeLessThan(60);
  });

  it('returns ready with no issues on clean input', () => {
    const result = runVisualQualityGate({ ir: baseIR, nodes: baseNodes, recentRenderErrors: 0, exportPreflightOk: true });
    expect(result.state).toBe('ready');
    expect(result.score).toBe(100);
  });

  it('flags canvas expansion mismatch when logical bounds do not include content', () => {
    const result = runVisualQualityGate({
      ir: baseIR,
      nodes: baseNodes,
      canvasState: {
        visibleViewport: { minX: 0, minY: 0, maxX: 400, maxY: 300 },
        contentBounds: { minX: -100, minY: -50, maxX: 900, maxY: 700 },
        logicalCanvasBounds: { minX: 0, minY: 0, maxX: 400, maxY: 300 },
        safeInteractionBounds: { minX: 0, minY: 0, maxX: 400, maxY: 300 },
        exportBounds: { minX: -100, minY: -50, maxX: 900, maxY: 700 },
      },
    });
    expect(result.signals.some((s) => s.code === 'CANVAS_NOT_EXPANDED')).toBe(true);
  });

  it('flags initial readability even for small node counts when smart-fit is unreadable', () => {
    const result = runVisualQualityGate({
      ir: baseIR,
      nodes: baseNodes,
      smartFit: {
        readable: false,
        showExploreHint: true,
        showViewAllSecondary: true,
        reason: 'label-too-small',
      },
    });
    expect(result.signals.some((s) => s.code === 'INITIAL_ZOOM_ILLEGIBLE')).toBe(true);
  });
});
