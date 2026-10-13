import { describe, expect, it, vi } from 'vitest';
import {
  buildScopeBriefing,
  coordinateRequest,
  teamFromPlan,
  type CoordinationEvent,
  type CoordinationScope,
} from '../../services/architectureOffice/application/officeCoordination';
import { planOfficeWorkstreams } from '../../services/architectureOffice/application/officeOrchestration';
import { buildCoordinationInvoker } from '../../services/architectureOffice/application/officeCoordinationInvoker';
import {
  createAgentProfileOverride,
  resolveAgentProfile,
} from '../../services/architectureOffice/domain/officeAgentProfile';

const scope: CoordinationScope = {
  level: 'project',
  id: 'proj-1',
  name: 'Núcleo de pólizas',
  briefing: ['Motor AS/400 expuesto como API', 'Cumplimiento HIPAA obligatorio'],
  ancestry: [{ level: 'initiative', name: 'Siniestros digitales', summary: 'Reducir el ciclo a 48 h' }],
};

/** A clock that advances a fixed step per read, so elapsed times are stable. */
const steppingClock = (step = 10) => {
  let value = 1_000;
  return () => {
    value += step;
    return value;
  };
};

describe('buildScopeBriefing', () => {
  it('names the level so an answer cannot be framed at the wrong one', () => {
    const text = buildScopeBriefing(scope);
    expect(text).toContain('proyecto de arquitectura');
    expect(text).toContain('Núcleo de pólizas');
  });

  it('carries the levels above, because a project without its initiative loses its reason', () => {
    const text = buildScopeBriefing(scope);
    expect(text).toContain('Siniestros digitales');
    expect(text).toContain('Reducir el ciclo a 48 h');
  });

  it('drops blank briefing lines rather than emitting empty bullets', () => {
    const text = buildScopeBriefing({ ...scope, briefing: ['Real', '   ', ''] });
    expect(text).toContain('· Real');
    expect(text.split('\n').filter((line) => line.trim() === '·')).toHaveLength(0);
  });
});

describe('coordinateRequest', () => {
  it('always assembles a team, even for a request that names no domain', async () => {
    const invoke = vi.fn(async () => 'respuesta');
    const outcome = await coordinateRequest({
      request: 'Ayúdame con esto',
      scope,
      invoke,
      now: steppingClock(),
    });

    // The team is the default, not an opt-in: a coordinator and a consolidator
    // are structural, and at least one specialist always carries the work.
    expect(outcome.team.filter((member) => member.role === 'coordinator')).toHaveLength(1);
    expect(outcome.team.filter((member) => member.role === 'consolidator')).toHaveLength(1);
    expect(outcome.team.filter((member) => member.role === 'specialist').length).toBeGreaterThan(0);
  });

  it('never lets the same persona coordinate and consolidate', () => {
    const plan = planOfficeWorkstreams('modernizar el AS/400 con MuleSoft y AWS');
    const team = teamFromPlan(plan);
    const coordinator = team.find((member) => member.role === 'coordinator');
    const consolidator = team.find((member) => member.role === 'consolidator');
    expect(coordinator?.personaId).not.toBe(consolidator?.personaId);
  });

  it('attaches the scope briefing to every prompt exactly once', async () => {
    const invoke = vi.fn(async (_personaId: string, _instruction: string) => 'respuesta');
    await coordinateRequest({
      request: 'Evalúa la integración con MuleSoft',
      scope,
      invoke,
      now: steppingClock(),
    });

    expect(invoke.mock.calls.length).toBeGreaterThan(0);
    for (const [, instruction] of invoke.mock.calls) {
      const occurrences = (instruction as string).split('Núcleo de pólizas').length - 1;
      expect(occurrences).toBe(1);
    }
  });

  it('emits the coordination as it happens, not reconstructed afterwards', async () => {
    const seen: CoordinationEvent[] = [];
    const invoke = vi.fn(async () => 'respuesta');
    const outcome = await coordinateRequest({
      request: 'Evalúa la integración con MuleSoft',
      scope,
      invoke,
      onEvent: (event) => seen.push(event),
      now: steppingClock(),
    });

    // Every event reached the listener while the work ran, and the returned
    // list is the same stream — a panel and an audit trail cannot disagree.
    expect(seen.map((event) => event.id)).toEqual(outcome.events.map((event) => event.id));
    expect(seen[0].kind).toBe('request-received');
    expect(outcome.events.at(-1)?.phase).toBe('closed');

    const kinds = outcome.events.map((event) => event.kind);
    expect(kinds).toContain('team-assembled');
    expect(kinds).toContain('assignment');
    expect(kinds).toContain('agent-reported');
    expect(kinds).toContain('recommendation');
  });

  it('reports elapsed time monotonically so the timeline cannot run backwards', async () => {
    const invoke = vi.fn(async () => 'respuesta');
    const outcome = await coordinateRequest({
      request: 'Revisa cumplimiento regulatorio',
      scope,
      invoke,
      now: steppingClock(),
    });
    const times = outcome.events.map((event) => event.elapsedMs);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('surfaces a failed specialist without losing the rest of the operation', async () => {
    const invoke = vi.fn(async (personaId: string) => {
      if (personaId === 'mauricio') throw new Error('proveedor caído');
      return 'respuesta';
    });
    const outcome = await coordinateRequest({
      request: 'Evalúa la integración MuleSoft y el cumplimiento regulatorio',
      scope,
      invoke,
      now: steppingClock(),
    });

    expect(outcome.status).toBe('partial');
    expect(outcome.events.some((event) => event.kind === 'agent-failed')).toBe(true);
    expect(outcome.answer).not.toBe('');
  });

  it('does not let a throwing listener take the operation down', async () => {
    const invoke = vi.fn(async () => 'respuesta');
    const outcome = await coordinateRequest({
      request: 'Evalúa la integración con MuleSoft',
      scope,
      invoke,
      onEvent: () => { throw new Error('render explotó'); },
      now: steppingClock(),
    });
    expect(outcome.status).toBe('completed');
  });

  it('fails closed when the coordinator itself cannot answer, and says why', async () => {
    const invoke = vi.fn(async () => { throw new Error('sin proveedor'); });
    const outcome = await coordinateRequest({
      request: 'Evalúa la integración con MuleSoft',
      scope,
      invoke,
      now: steppingClock(),
    });

    expect(outcome.status).toBe('failed');
    // A failed operation still explains itself: the status is what the UI keys
    // off to avoid presenting this as a recommendation, but leaving the reader
    // with an empty panel would tell them nothing about what went wrong.
    expect(outcome.answer).toMatch(/coordinaci/i);
    expect(outcome.contributions).toHaveLength(0);
    expect(outcome.events.some((event) => event.kind === 'agent-failed')).toBe(true);
  });
});

describe('coordinateRequest · las fichas configuradas', () => {
  /*
   * La ficha ya no se antepone al mensaje (plan de agentes, 16.0): llega al
   * prompt de sistema de cada agente a través del invocador. Anteponerla le daba
   * a un agente personalizado dos identidades.
   */
  const mauProfile = (() => {
    const created = createAgentProfileOverride({
      agentId: 'mauricio',
      userId: 'u1',
      alias: 'Mau',
      knowledge: ['Esta compañía integra por Anypoint desde 2023.'],
    });
    if (created.outcome !== 'created') throw new Error(created.message);
    return resolveAgentProfile('mauricio', created.override);
  })();

  const chatSpy = () => vi.fn(async (..._args: unknown[]) => 'respuesta');

  it('la ficha de un agente llega a su llamada, no al mensaje', async () => {
    const chat = chatSpy();
    await coordinateRequest({
      request: 'Evalúa la integración con MuleSoft',
      scope,
      invoke: buildCoordinationInvoker({ chat, settings: {} as never, scope, profiles: [mauProfile] }),
      now: steppingClock(),
    });

    const mauricioCalls = chat.mock.calls.filter((args) => args[4] === 'mauricio');
    expect(mauricioCalls.length).toBeGreaterThan(0);
    for (const args of mauricioCalls) {
      // Configurar una ficha y que el agente siguiera hablando igual sería una
      // configuración decorativa.
      expect(args[6]).toBe(mauProfile);
      expect(args[1] as string).not.toContain('Anypoint desde 2023');
    }
  });

  it('no le pasa a un agente la ficha de otro', async () => {
    const chat = chatSpy();
    await coordinateRequest({
      request: 'Evalúa la integración con MuleSoft y el cumplimiento regulatorio',
      scope,
      invoke: buildCoordinationInvoker({ chat, settings: {} as never, scope, profiles: [mauProfile] }),
      now: steppingClock(),
    });

    for (const args of chat.mock.calls) {
      if (args[4] === 'mauricio') continue;
      expect(args[6]).toBeUndefined();
    }
  });

  it('no convoca a un agente que el usuario desactivó', async () => {
    const invoke = vi.fn(async (_personaId: string, _instruction: string) => 'respuesta');
    const outcome = await coordinateRequest({
      request: 'Evalúa la integración con MuleSoft',
      scope,
      invoke,
      now: steppingClock(),
      unavailableAgents: ['mauricio'],
    });

    expect(outcome.team.map((member) => member.personaId)).not.toContain('mauricio');
    expect(outcome.team.filter((member) => member.role === 'specialist').length).toBeGreaterThan(0);
  });
});
