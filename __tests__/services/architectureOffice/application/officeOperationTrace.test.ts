import { describe, it, expect } from 'vitest';
import {
  describeOperation,
  exportOperationTrace,
} from '../../../../services/architectureOffice/application/officeOperationTrace';
import type { CoordinationOutcome } from '../../../../services/architectureOffice/application/officeCoordination';

const KEY = 'AIza' + 'A'.repeat(35);

const outcome = (): CoordinationOutcome =>
  ({
    status: 'completed',
    team: [{ personaId: 'elena', role: 'specialist', rationale: `usa ${KEY}` }],
    events: [{ id: 'e1', kind: 'agent-started', from: 'elena', to: 'elena', summary: 'Empieza', detail: KEY }],
    contributions: [{ personaId: 'elena', status: 'completed' }],
    rejectedHandoffs: [],
    promptStamps: ['office.review@v1#3f2a9c1e'],
  }) as unknown as CoordinationOutcome;

describe('officeOperationTrace', () => {
  it('deriva un árbol con la operación en la raíz y un nodo por agente', () => {
    const tree = describeOperation(outcome());
    expect(tree.kind).toBe('operation');
    expect(tree.children.some((c) => c.kind === 'agent')).toBe(true);
  });

  it('nunca deja una credencial en el árbol ni en la exportación', () => {
    const o = outcome();
    expect(JSON.stringify(describeOperation(o))).not.toContain(KEY);
    const exported = exportOperationTrace(o);
    expect(exported).not.toContain(KEY);
    expect(exported).toContain('[credencial omitida]');
    expect(exported).toContain('office.review@v1#3f2a9c1e');
  });
});
