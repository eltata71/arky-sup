import { describe, expect, it } from 'vitest';
import type { Node } from 'reactflow';
import { computeSmartViewportDecision } from '../../services/diagram/smartViewportFit';

const nodes: Node[] = [
  { id: 'a', type: 'custom', data: { label: 'A' }, position: { x: 0, y: 0 }, width: 260, height: 160 },
  { id: 'b', type: 'custom', data: { label: 'B' }, position: { x: 1400, y: 0 }, width: 260, height: 160 },
];

describe('smartViewportFit', () => {
  it('shows exploration hint for large content and preserves readability clamp', () => {
    const d = computeSmartViewportDecision(nodes, { viewportWidth: 800, viewportHeight: 500, iPadMode: true }, { minZoom: 0.5 });
    expect(d.viewport).not.toBeNull();
    expect(d.showExploreHint).toBe(true);
    expect(d.showViewAllSecondary).toBe(true);
  });

  it('flags readability reason when labels become too small', () => {
    const dense: Node[] = [
      { id: 'a', type: 'custom', data: { label: 'Canal de atención omnicanal y coordinación de transacciones en línea' }, position: { x: 0, y: 0 }, width: 260, height: 160 },
      { id: 'b', type: 'custom', data: { label: 'Sistema central de orquestación de servicios y políticas de seguridad' }, position: { x: 3000, y: 0 }, width: 260, height: 160 },
    ];
    const d = computeSmartViewportDecision(dense, { viewportWidth: 720, viewportHeight: 420, iPadMode: true }, { minZoom: 0.45 });
    expect(d.readable).toBe(false);
    expect(d.reason).toBeDefined();
    expect(d.showViewAllSecondary).toBe(true);
  });
});
