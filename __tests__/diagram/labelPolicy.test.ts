import { describe, expect, it } from 'vitest';
import { resolveEdgeLabelDecision, resolveNodeLabelDecision } from '../../services/diagram/labelPolicy';

describe('labelPolicy', () => {
  it('creates compact node title with tooltip context', () => {
    const decision = resolveNodeLabelDecision({
      id: 'n1',
      label: 'Servicio de autorización y orquestación de reclamos en tiempo real para afiliados',
      kind: 'service',
      technology: 'Node.js',
      description: 'Gestiona autorización y reglas.'
    } as any);
    expect(decision.title.length).toBeLessThanOrEqual(57);
    expect(decision.tooltip).toContain('Gestiona autorización');
  });

  it('strips protocol suffix from visible edge label', () => {
    const decision = resolveEdgeLabelDecision({
      id: 'e1', source: 'a', target: 'b',
      label: 'Consulta elegibilidad · HTTPS',
      protocol: 'HTTPS'
    } as any);
    expect(decision.visibleLabel).toBe('Consulta elegibilidad');
    expect(decision.protocolBadge).toBe('HTTPS');
  });
});
