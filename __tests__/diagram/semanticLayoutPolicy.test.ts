import { describe, expect, it } from 'vitest';
import { inferSemanticDiagramType, resolveSemanticLayoutPolicy } from '../../lib/semanticLayoutPolicy';
import type { DiagramIR } from '../../lib/diagram';

const buildIR = (diagramType?: NonNullable<DiagramIR['metadata']>['diagramType']): DiagramIR => ({ nodes: [], edges: [], groups: [], metadata: { diagramType } });

describe('semanticLayoutPolicy', () => {
  it('maps BPMN to LR swimlanes policy', () => {
    const { policy } = resolveSemanticLayoutPolicy(buildIR('bpmn-process'));
    expect(inferSemanticDiagramType(buildIR('bpmn-process'))).toBe('bpmn');
    expect(policy.direction).toBe('LR');
    expect(policy.groupStrategy).toBe('swimlanes');
    expect(policy.requiresExpandedCanvas).toBe(true);
  });

  it('warns when compact density degrades integration readability', () => {
    const { policy, warnings } = resolveSemanticLayoutPolicy(buildIR('integration'), { density: 'compact' });
    expect(policy.density).toBe('compact');
    expect(warnings.length).toBeGreaterThan(0);
  });
});
