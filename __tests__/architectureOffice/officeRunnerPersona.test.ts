/**
 * Quien firma una tarea de un encargo lo decide la tarea, nunca el texto
 * (plan de agentes, 16.2 · A7).
 *
 * El puerto de producción resolvía la persona con `officePersonaForMessage`,
 * que busca un `@Alias` en la instrucción —y la instrucción empieza por el
 * brief que escribió el usuario—. Con «@Carmen» en el brief, la tarea de
 * Felipe la firmaba Carmen; sin ninguna mención, Arky. El asignado sólo
 * aparecía como «Actúas como…» en el texto del turno, nunca como la persona
 * del prompt de sistema.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentPersonaBriefing } from '../../services/agent/agentPersonaBriefing';
import type { Project } from '../../services/architectureProjects';
import { createProduceArtifactPort } from '../../services/architectureOffice/infrastructure/OfficeRunnerAdapters';
import {
  DEFAULT_OFFICE_BUDGET,
  OFFICE_ENGAGEMENT_SCHEMA_VERSION,
  SYSTEM_OFFICE_ACTOR,
  type OfficeEngagement,
  type OfficeTask,
} from '../../services/architectureOffice/domain/OfficeTypes';
import type { OfficeAgentId } from '../../services/architectureOffice/domain/officeAgentPersonas';
import type { Settings } from '../../types';

const captured = vi.hoisted(() => ({
  instruction: '',
  resolvePersona: undefined as undefined | ((message: string) => AgentPersonaBriefing),
}));

vi.mock('../../services/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/agent')>();
  return {
    ...actual,
    executeAgentAction: vi.fn(async (input: {
      plan: { intent: { userInstruction: string } };
      resolvePersona?: (message: string) => AgentPersonaBriefing;
    }) => {
      captured.instruction = input.plan.intent.userInstruction;
      captured.resolvePersona = input.resolvePersona;
      return { status: 'cancelled', messages: ['prueba'], errors: [], traceId: 'trace-prueba' };
    }),
  };
});

const NOW = '2026-10-13T00:00:00.000Z';

const produceTask = (assigneeId: OfficeAgentId): OfficeTask => ({
  id: 'produce-1',
  engagementId: 'eng-1',
  kind: 'produce-artifact',
  title: 'Contenedores del portal',
  objective: 'Producir el diagrama de contenedores.',
  assigneeId,
  dependsOn: [],
  acceptanceCriteria: [],
  status: 'ready',
  attempts: 0,
  maxAttempts: 2,
  targetArtifactType: 'markdown',
});

const engagement = (brief: string, task: OfficeTask): OfficeEngagement => ({
  id: 'eng-1',
  projectId: 'proj-1',
  schemaVersion: OFFICE_ENGAGEMENT_SCHEMA_VERSION,
  title: 'Portal de siniestros',
  brief,
  businessProjectIds: [],
  initiativeIds: [],
  priority: 'medium',
  status: 'in-progress',
  charter: {
    kind: 'new-solution',
    objectives: [],
    scope: [],
    outOfScope: [],
    constraints: [],
    regulatoryDrivers: [],
    deliverables: [],
    participantIds: [],
    coordinatorId: 'lucia',
    consolidatorId: 'alejandro',
    provenance: 'deterministic',
    proposedAt: NOW,
    approvedAt: NOW,
    approvedBy: { id: 'u-arb', name: 'Ana', role: 'admin' },
  },
  tasks: [task],
  arbDecisions: [],
  budget: { ...DEFAULT_OFFICE_BUDGET, consumedAiCalls: 0 },
  auditTrail: [],
  createdBy: SYSTEM_OFFICE_ACTOR,
  createdAt: NOW,
  updatedAt: NOW,
});

const produceWith = async (assigneeId: OfficeAgentId, brief: string): Promise<string> => {
  const task = produceTask(assigneeId);
  const port = createProduceArtifactPort({
    getProject: () => ({ id: 'proj-1', name: 'Portal', artifacts: [] } as unknown as Project),
    getSettings: () => ({ aiConfig: {} } as unknown as Settings),
    store: {
      createArtifactVersion: () => { throw new Error('no persiste'); },
      updateArtifact: () => undefined,
    },
    invokePersona: async () => '',
    persist: async (value) => ({ status: 'success', data: value } as never),
  });
  await port(task, engagement(brief, task));
  expect(captured.resolvePersona, 'el puerto debe entregar una persona al ejecutor').toBeDefined();
  // El motor compone la persona sobre lo que le pide la generación; da igual
  // qué texto le llegue: tiene que salir siempre el asignado.
  return captured.resolvePersona!(captured.instruction).composeInstruction('BASE');
};

describe('el puerto de producción firma con la persona de la tarea', () => {
  beforeEach(() => {
    captured.instruction = '';
    captured.resolvePersona = undefined;
  });

  it('un brief que menciona a otro agente no le cambia el autor', async () => {
    const instruction = await produceWith('felipe', 'Diseño en AWS; @Carmen revisará el cumplimiento.');
    expect(instruction).toContain('Persona especializada activa: Felipe');
    expect(instruction).not.toContain('Persona especializada activa: Carmen');
  });

  it('sin ninguna mención firma el asignado, no Arky', async () => {
    const instruction = await produceWith('sofia', 'Modelo de pólizas y endosos del ramo de vida.');
    expect(instruction).toContain('Persona especializada activa: Sofía');
  });

  it('un brief que empieza por el alias de otro tampoco lo secuestra', async () => {
    const instruction = await produceWith('gabriel', 'Elena: prepara los NFR del cotizador.');
    expect(instruction).toContain('Persona especializada activa: Gabriel');
  });

  it('la persona lleva el alcance del asignado, incluida su frontera', async () => {
    const instruction = await produceWith('felipe', 'Arquitectura del portal.');
    expect(instruction).toContain('No te ocupas de:');
    expect(instruction).toContain('Salesforce');
  });
});

describe('ningún puerto del runner elige a la persona por el texto', () => {
  it('OfficeRunnerAdapters no resuelve menciones', () => {
    const source = readFileSync('services/architectureOffice/infrastructure/OfficeRunnerAdapters.ts', 'utf8');
    const code = source.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*\*)/.test(line)).join('\n');
    expect(code).not.toMatch(/officePersonaForMessage|resolveOfficeAgentMention/);
  });
});
