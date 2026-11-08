import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import {
  describeOperation,
  exportOperationTrace,
} from '../../../../services/architectureOffice/application/officeOperationTrace';
import type { CoordinationOutcome } from '../../../../services/architectureOffice/application/officeCoordination';
import type { OfficeInvocationRecord } from '../../../../services/architectureOffice/application/officeOrchestrationTypes';
import type { OperationTraceSource } from '../../../../services/architectureOffice/application/officeOperationTrace';

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
  it('canonicalizes invocation, handoff, event and trace identities without mutating semantic sequences', () => {
    const permutations = <T,>(items: T[]): T[][] => items.length === 0 ? [[]]
      : items.flatMap((item, index) => permutations(items.filter((_, i) => i !== index)).map((rest) => [item, ...rest]));
    const freeze = (value: unknown): void => {
      if (value && typeof value === 'object') {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      }
    };
    const invocations: OfficeInvocationRecord[] = ['c', 'b', 'a'].map((id) => ({
      invocationId: id, personaId: 'elena', role: 'specialist', promptId: 'test', promptStamp: `stamp:${id}`,
      handoffId: id === 'c' ? undefined : 'handoff:a', attempt: 'primary', status: 'completed', startedAtMs: 0,
      measurement: { aiCalls: 1, model: 'test', usage: null, latencyMs: 1, traceId: `trace:${id}`,
        estimatedCostUsd: null, toolCalls: ['second', 'first'] },
    }));
    const events = invocations.flatMap(({ invocationId }) => ['2', '1'].map((suffix) => ({
      id: `${invocationId}:${suffix}`, invocationId, kind: 'agent-started' as const,
      from: 'elena' as const, to: 'elena' as const, summary: suffix,
      phase: 'working' as const, elapsedMs: 0,
    })));
    const base: OperationTraceSource = { ...outcome(), team: [], invocations, events,
      promptStamps: ['second', 'first'] };
    const before = JSON.stringify(base);
    freeze(base);
    const expected = describeOperation(base);
    const exported = exportOperationTrace(base);
    expect(expected.children.map((node) => node.id)).toEqual(['handoff:a', 'unattributed:c']);
    expect(expected.children[0].children.map((node) => node.id)).toEqual(['a', 'b']);
    expect(expected.children[0].children[0].children.map((node) => node.id)).toEqual(['a:model', 'a:1', 'a:2']);
    expect(expected.traceIds).toEqual(['trace:a', 'trace:b', 'trace:c']);
    expect(expected.children[0].children[0].measurement?.toolCalls).toEqual(['second', 'first']);
    expect(JSON.parse(exported).promptStamps).toEqual(['second', 'first']);
    for (const reordered of permutations(invocations)) {
      for (const reorderedEvents of [events, [...events].reverse(), [...events.slice(2), ...events.slice(0, 2)]]) {
        const candidate = { ...base, invocations: reordered, events: reorderedEvents };
        freeze(candidate);
        expect(describeOperation(candidate)).toEqual(expected);
        expect(exportOperationTrace(candidate)).toBe(exported);
      }
    }
    for (const traceIds of permutations(['trace:c', 'trace:a', 'trace:b'])) {
      freeze(traceIds);
      expect(describeOperation({ ...base, traceIds })).toEqual(expected);
      expect(exportOperationTrace({ ...base, traceIds })).toBe(exported);
    }
    expect(describeOperation({ ...base, traceIds: [] }).traceIds).toEqual([]);
    expect(JSON.stringify(base)).toBe(before);
  });

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
