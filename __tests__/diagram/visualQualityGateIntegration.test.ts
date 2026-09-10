import { describe, expect, it } from 'vitest';
import { analyzeDiagramQuality } from '../../services/diagram/quality/diagramQualityService';
import type { DiagramIR } from '../../lib/diagram';

const ir: DiagramIR = {
  nodes: [
    { id: 'a', label: 'Portal', kind: 'system' },
    { id: 'b', label: 'API', kind: 'service' },
  ],
  edges: [{ id: 'e1', source: 'a', target: 'b', label: 'invoca' }],
  groups: [],
  metadata: { diagramType: 'integration' },
};

describe('analyzeDiagramQuality visual gate integration', () => {
  it('includes visualGate when runtime render signals are provided', () => {
    const report = analyzeDiagramQuality(ir, {
      recentRenderErrors: 1,
      exportPreflightOk: false,
      smartFitDecision: {
        readable: false,
        showExploreHint: true,
        showViewAllSecondary: true,
        reason: 'zoom-too-low',
      },
      layoutRects: [
        { id: 'a', x: 0, y: 0, width: 200, height: 100 },
        { id: 'b', x: 300, y: 0, width: 200, height: 100 },
      ],
    });
    expect(report.visualGate).toBeDefined();
    expect(report.visualGate?.state).not.toBe('ready');
    expect(report.visualGate?.signals.some((s) => s.code === 'RECENT_RENDER_ERRORS')).toBe(true);
  });
});
