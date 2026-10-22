import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
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
  it('removes complete and truncated PEM material from every free-text field in tree and JSON', () => {
    const pem = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey
      .export({ type: 'sec1', format: 'pem' }).toString();
    const variants = [pem, pem.split('-----END')[0], pem.trimEnd().slice(0, -3)];
    for (const secret of variants) {
      const o = outcome();
      o.framing = secret;
      o.team[0].rationale = secret;
      o.events[0].summary = secret;
      o.events[0].detail = secret;
      o.rejectedHandoffs = [{
        sourceAgentId: 'arky', targetAgentId: 'elena', kind: 'workstream',
        rejections: [{ code: 'topology-not-allowed', message: secret }],
      }];
      o.consolidationReview = { ok: false, gaps: [secret] };
      const tree = describeOperation(o);
      expect(tree.detail?.trim()).toBe('[credencial omitida]');
      expect(tree.children[0].detail?.trim()).toBe('[credencial omitida]');
      expect(tree.children[0].children[0].label.trim()).toBe('[credencial omitida]');
      expect(tree.children[0].children[0].detail?.trim()).toBe('[credencial omitida]');
      expect(tree.children.find((n) => n.kind === 'rejected-handoff')?.children[0].label.trim()).toBe('[credencial omitida]');
      expect(tree.children.find((n) => n.kind === 'review')?.children[0].label.trim()).toBe('[credencial omitida]');
      for (const serialized of [JSON.stringify(tree), exportOperationTrace(o)]) {
        for (const line of pem.trim().split('\n')) {
          expect(serialized.includes(line)).toBe(false);
        }
      }
    }
  });

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

  it('produce el mismo árbol ante eventos equivalentes en otro orden (forma neutral)', () => {
    const base = outcome();
    base.team = [
      { personaId: 'elena', role: 'specialist', rationale: 'dominio' },
      { personaId: 'lucia', role: 'coordinator', rationale: 'encuadra' },
    ] as typeof base.team;
    base.events = [
      { id: 'e2', kind: 'agent-reported', from: 'elena', to: 'alejandro', summary: 'Entrega', elapsedMs: 20 },
      { id: 'e1', kind: 'agent-started', from: 'elena', to: 'elena', summary: 'Empieza', elapsedMs: 10 },
      { id: 'e3', kind: 'request-received', from: null, to: 'lucia', summary: 'Solicitud', elapsedMs: 0 },
    ] as typeof base.events;
    // Los ids son la identidad de un evento; el orden de llegada no puede
    // cambiar el árbol que un lector reconstruye. Los ids de nodo se derivan
    // del evento, no de su posición.
    const shuffled: CoordinationOutcome = {
      ...base,
      events: [...base.events].reverse(),
      team: [...base.team].reverse(),
    } as CoordinationOutcome;
    expect(describeOperation(shuffled)).toEqual(describeOperation(base));
  });
});
