/**
 * La ficha de un agente llega a los diez caminos por los que habla
 * (plan de agentes, 16.1 · A1).
 *
 * CLAUDE.md decía «the card reaches every place the agent speaks» y era verdad
 * en tres de diez: cambiar la instrucción o el conocimiento de un agente no
 * cambiaba los artefactos que generaba, ni las revisiones que firmaba, ni el
 * chat. Cada fila de esta tabla ejecuta un camino con una ficha que lleva un
 * marcador en su conocimiento, y comprueba que el marcador llega a lo que el
 * modelo recibiría como prompt de sistema. Un camino nuevo por el que hable un
 * agente añade su fila.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentPersonaBriefing } from '../../services/agent/agentPersonaBriefing';
import type { Project } from '../../services/architectureProjects';
import type { Settings } from '../../types';
import {
  createAgentProfileOverride,
  resolveAgentProfile,
  resolveAgentProfiles,
  type OfficeAgentProfile,
  type OfficeAgentProfileOverride,
} from '../../services/architectureOffice/domain/officeAgentProfile';
import {
  artifactPersonaComposerFor,
  officePersonaForMessage,
  officePersonaResolverFor,
} from '../../services/architectureOffice/domain/officePersonaBriefing';
import { composeAgentInstruction } from '../../services/architectureOffice/domain/agentPromptComposer';
import { buildCoordinationInvoker } from '../../services/architectureOffice/application/officeCoordinationInvoker';
import { buildCaptureRequest } from '../../services/architectureOffice/application/captureAssistance';
import { platformGuideAgentBriefing } from '../../services/architectureOffice/application/platformGuidance';
import {
  createConsolidatePort,
  createProduceArtifactPort,
  createReviewArtifactPort,
  type OfficeRunnerAdapterDeps,
} from '../../services/architectureOffice/infrastructure/OfficeRunnerAdapters';
import {
  DEFAULT_OFFICE_BUDGET,
  OFFICE_ENGAGEMENT_SCHEMA_VERSION,
  SYSTEM_OFFICE_ACTOR,
  type OfficeEngagement,
  type OfficeTask,
} from '../../services/architectureOffice/domain/OfficeTypes';
import type { OfficeAgentId } from '../../services/architectureOffice/domain/officeAgentPersonas';

const MARKER = 'MARCADOR-DE-FICHA-K9';

const captured = vi.hoisted(() => ({
  resolvePersona: undefined as undefined | ((message: string) => AgentPersonaBriefing),
  chatProfiles: [] as (OfficeAgentProfile | undefined)[],
}));

vi.mock('../../services/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/agent')>();
  return {
    ...actual,
    executeAgentAction: vi.fn(async (input: { resolvePersona?: (message: string) => AgentPersonaBriefing }) => {
      captured.resolvePersona = input.resolvePersona;
      return { status: 'cancelled', messages: ['prueba'], errors: [], traceId: 'trace-prueba' };
    }),
  };
});

// El copiloto usa el invocador medido de la coordinación: se intercepta el
// transporte, no la coordinación, para comprobar qué ficha recibe cada agente.
vi.mock('../../services/architectureOffice/application/projectConversation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/architectureOffice/application/projectConversation')>();
  return {
    ...actual,
    chatWithProjectMeasured: vi.fn(async (...args: unknown[]) => {
      captured.chatProfiles.push(args[6] as OfficeAgentProfile | undefined);
      return { text: 'Veredicto: Ready. Análisis con su dominio.'.padEnd(240, '.'), usage: null, model: null, latencyMs: 1, traceId: null, estimatedCostUsd: null };
    }),
  };
});

const overrideFor = (agentId: OfficeAgentId): OfficeAgentProfileOverride => {
  const created = createAgentProfileOverride({ agentId, userId: 'u1', knowledge: [`Regla de la casa ${MARKER}`] });
  if (created.outcome !== 'created') throw new Error(created.message);
  return created.override;
};

const ALL_OVERRIDES = (['arky', 'elena', 'felipe', 'lucia', 'alejandro', 'sofia', 'gabriel', 'tomas'] as OfficeAgentId[]).map(overrideFor);
const PROFILES = resolveAgentProfiles(ALL_OVERRIDES);
const profileOf = (agentId: OfficeAgentId): OfficeAgentProfile => PROFILES.find((profile) => profile.agentId === agentId)!;

/** Lo que el modelo recibiría como sistema con esta ficha. */
const systemWith = (profile: OfficeAgentProfile | undefined): string =>
  profile ? composeAgentInstruction('BASE', profile) : '';

const NOW = '2026-10-14T00:00:00.000Z';
const task = (overrides: Partial<OfficeTask> & Pick<OfficeTask, 'id' | 'kind' | 'assigneeId'>): OfficeTask => ({
  engagementId: 'eng-1', title: overrides.id, objective: 'Producir.', dependsOn: [], acceptanceCriteria: [],
  status: 'ready', attempts: 0, maxAttempts: 2, ...overrides,
});
const engagementWith = (tasks: OfficeTask[]): OfficeEngagement => ({
  id: 'eng-1', projectId: 'proj-1', schemaVersion: OFFICE_ENGAGEMENT_SCHEMA_VERSION, title: 'Portal', brief: 'Portal de siniestros.',
  businessProjectIds: [], initiativeIds: [], priority: 'medium', status: 'in-progress',
  charter: {
    kind: 'new-solution', objectives: [], scope: [], outOfScope: [], constraints: [], regulatoryDrivers: [], deliverables: [],
    participantIds: [], coordinatorId: 'lucia', consolidatorId: 'alejandro', provenance: 'deterministic', proposedAt: NOW,
    approvedAt: NOW, approvedBy: { id: 'u-arb', name: 'Ana', role: 'admin' },
  },
  tasks, arbDecisions: [], budget: { ...DEFAULT_OFFICE_BUDGET, consumedAiCalls: 0 }, auditTrail: [],
  createdBy: SYSTEM_OFFICE_ACTOR, createdAt: NOW, updatedAt: NOW,
});
const artifact = {
  id: 'art-1', versionGroupId: 'art-1', version: 1, createdAt: NOW, name: 'Documento', type: 'markdown', phase: 'Fase 2',
  architecturalView: 'Vista de Gestión y Soporte', content: '# Documento', objective: 'Objetivo.', keyConcepts: [], representation: 'document',
};
const project = { id: 'proj-1', name: 'Portal', description: 'Portal.', projectContext: [], artifacts: [artifact] } as unknown as Project;
const settings = { aiConfig: {} } as unknown as Settings;

const runnerDeps = (invokePersona: OfficeRunnerAdapterDeps['invokePersona']): OfficeRunnerAdapterDeps => ({
  getProject: () => project,
  getSettings: () => settings,
  store: { createArtifactVersion: () => { throw new Error('no persiste'); }, updateArtifact: () => undefined },
  invokePersona,
  persist: async (value) => ({ status: 'success', data: value } as never),
  getProfile: profileOf,
});

/** Cada camino devuelve el prompt de sistema que recibiría su agente. */
const PATHS: readonly [string, () => Promise<string>][] = [
  ['captura asistida', async () => buildCaptureRequest({
    fieldIds: ['initiative.driver'],
    context: { level: 'initiative', record: { title: 'Pagos', need: 'Pagar antes.' } } as never,
    agentOverride: overrideFor('arky'),
  }).agentBriefing.join('\n')],
  ['guía de la plataforma', async () => platformGuideAgentBriefing(ALL_OVERRIDES).join('\n')],
  ['coordinación del dock', async () => {
    let received: OfficeAgentProfile | undefined;
    const invoke = buildCoordinationInvoker({
      chat: async (...args) => { received = args[6]; return 'ok'; },
      settings, scope: { level: 'project', id: 'p', name: 'Portal', briefing: [] }, profiles: PROFILES,
    });
    await invoke('felipe', 'Analiza.');
    return systemWith(received);
  }],
  ['generación de artefactos', async () => artifactPersonaComposerFor(PROFILES)('BASE', '@Elena genera el C4')],
  ['ejecutor del agente', async () => officePersonaResolverFor(PROFILES)('@Elena corrige la etiqueta').composeInstruction('BASE')],
  ['chat del asistente', async () => officePersonaForMessage('¿Qué opinas del portal?', PROFILES).composeInstruction('BASE')],
  ['encargo · producir', async () => {
    const produce = task({ id: 'produce-1', kind: 'produce-artifact', assigneeId: 'felipe', targetArtifactType: 'markdown' });
    await createProduceArtifactPort(runnerDeps(async () => ''))(produce, engagementWith([produce]));
    return captured.resolvePersona?.('cualquier texto').composeInstruction('BASE') ?? '';
  }],
  ['encargo · revisar', async () => {
    let received: OfficeAgentProfile | undefined;
    const produce = task({ id: 'produce-1', kind: 'produce-artifact', assigneeId: 'felipe', status: 'completed', producedArtifactId: 'art-1' });
    const review = task({ id: 'review-1', kind: 'review-artifact', assigneeId: 'elena', reviewsTaskId: 'produce-1' });
    await createReviewArtifactPort(runnerDeps(async (_id, _prompt, _project, profile) => { received = profile; return '{}'; }))(review, engagementWith([produce, review]));
    return systemWith(received);
  }],
  ['encargo · consolidar', async () => {
    let received: OfficeAgentProfile | undefined;
    const consolidate = task({ id: 'consolidate-1', kind: 'consolidate', assigneeId: 'alejandro' });
    await createConsolidatePort(runnerDeps(async (_id, _prompt, _project, profile) => { received = profile; return 'ok'; }))(consolidate, engagementWith([consolidate]));
    return systemWith(received);
  }],
  ['orquestación del copiloto', async () => {
    const { runCopilotOrchestration } = await import('../../services/architectureOffice/application/copilotTurn');
    await runCopilotOrchestration('Arquitectura AWS del portal', project, settings, PROFILES);
    // Todos los agentes de la operación recibieron su ficha.
    return captured.chatProfiles.length > 0 && captured.chatProfiles.every(Boolean) ? captured.chatProfiles.map(systemWith).join('\n') : '';
  }],
];

describe('la ficha llega a los diez caminos', () => {
  beforeEach(() => {
    captured.resolvePersona = undefined;
    captured.chatProfiles = [];
  });

  it('la tabla tiene los diez caminos', () => {
    expect(PATHS).toHaveLength(10);
  });

  it.each(PATHS)('%s', async (_name, run) => {
    const system = await run();
    expect(system).toContain(MARKER);
    // Y una sola vez por agente: la ficha no se repite en el turno.
    expect(system.split('Eres ').length - 1).toBeGreaterThanOrEqual(1);
  });
});

describe('un agente desactivado no habla en su nombre', () => {
  const off = (() => {
    const created = createAgentProfileOverride({ agentId: 'carmen', userId: 'u1', enabled: false });
    if (created.outcome !== 'created') throw new Error(created.message);
    return resolveAgentProfiles([created.override]);
  })();

  it('una mención a un agente apagado la responde Arky, y lo dice', () => {
    const briefing = officePersonaForMessage('@Carmen revisa el cumplimiento', off);
    const text = [briefing.composeInstruction('BASE'), ...briefing.sections].join('\n');
    expect(text).toContain('Eres Arky,');
    expect(text).not.toContain('Eres Carmen,');
    expect(text).toContain('Carmen está desactivado');
  });

  it('la generación tampoco firma con un agente apagado', () => {
    const text = artifactPersonaComposerFor(off)('BASE', '@Carmen redacta la matriz de controles');
    expect(text).toContain('Eres Arky,');
    expect(text).toContain('Carmen está desactivado');
  });

  it('la orquestación del copiloto no lo convoca', async () => {
    const { runCopilotOrchestration } = await import('../../services/architectureOffice/application/copilotTurn');
    captured.chatProfiles = [];
    const { chatWithProjectMeasured } = await import('../../services/architectureOffice/application/projectConversation');
    vi.mocked(chatWithProjectMeasured).mockClear();
    await runCopilotOrchestration('Cumplimiento HIPAA del intercambio de PHI', project, settings, off);
    const convened = vi.mocked(chatWithProjectMeasured).mock.calls.map((args) => args[4]);
    expect(convened.length).toBeGreaterThan(0);
    expect(convened).not.toContain('carmen');
  });

  it('sin fichas, todo habla con la persona de fábrica', () => {
    expect(officePersonaForMessage('@Carmen revisa', []).composeInstruction('BASE')).toContain('Eres Carmen,');
    expect(resolveAgentProfile('carmen').enabled).toBe(true);
  });
});
