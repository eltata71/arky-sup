/**
 * Ninguna plantilla de agente cambia de texto sin cambiar de versión
 * (plan de agentes, 15.1 · A23).
 *
 * Cada plantilla de `lib/agents/promptCatalog` se renderiza aquí sobre un caso
 * canónico, y la huella del texto tiene que coincidir con la del catálogo. Si
 * cambias una plantilla a propósito, esta prueba te dice la huella nueva:
 * **sube su `version`** y copia la huella. Lo que no puede pasar es lo que
 * pasaba: una instrucción reescrita sin que ninguna traza permitiera saber que
 * las respuestas de antes y las de después venían de prompts distintos.
 */
import { describe, expect, it } from 'vitest';
import {
  AGENT_PROMPTS,
  agentPromptRef,
  fingerprintPrompt,
  parsePromptStamp,
  stampPrompt,
  type AgentPromptId,
} from '../../lib/agents/promptCatalog';
import type { Artifact } from '../../lib/artifacts';
import { OFFICE_AGENT_PERSONAS } from '../../services/architectureOffice/domain/officeAgentPersonas';
import { buildOfficePersonaInstruction } from '../../services/architectureOffice/domain/officePersonaBriefing';
import {
  buildAgentProfileBriefing,
  createAgentProfileOverride,
  resolveAgentProfile,
} from '../../services/architectureOffice/domain/officeAgentProfile';
import { renderHandoffPrompt, type AgentHandoffEnvelope } from '../../services/architectureOffice/domain/agentHandoff';
import { buildConsolidationRefinementPrompt } from '../../services/architectureOffice/domain/officeConsolidationReview';
import { buildScopeBriefing } from '../../services/architectureOffice/application/officeCoordination';
import {
  buildConsolidationPrompt,
  buildProductionInstruction,
  buildReviewPrompt,
} from '../../services/architectureOffice/infrastructure/OfficeRunnerAdapters';
import {
  DEFAULT_OFFICE_BUDGET,
  OFFICE_ENGAGEMENT_SCHEMA_VERSION,
  SYSTEM_OFFICE_ACTOR,
  type OfficeEngagement,
  type OfficeTask,
} from '../../services/architectureOffice/domain/OfficeTypes';

const NOW = '2026-10-14T00:00:00.000Z';

const task = (overrides: Partial<OfficeTask> & Pick<OfficeTask, 'id' | 'kind' | 'assigneeId'>): OfficeTask => ({
  engagementId: 'eng-canon',
  title: 'Contenedores del portal',
  objective: 'Producir el diagrama de contenedores.',
  dependsOn: [],
  acceptanceCriteria: ['Muestra cada contenedor con su tecnología.'],
  status: 'ready',
  attempts: 0,
  maxAttempts: 2,
  ...overrides,
});

const producer = task({ id: 'produce-1', kind: 'produce-artifact', assigneeId: 'felipe', status: 'completed', producedArtifactId: 'art-1', artifactTemplateName: 'C4 Contenedores' });
const reviewer = task({ id: 'review-1', kind: 'review-artifact', assigneeId: 'elena', reviewsTaskId: 'produce-1' });

const engagement: OfficeEngagement = {
  id: 'eng-canon',
  projectId: 'proj-canon',
  schemaVersion: OFFICE_ENGAGEMENT_SCHEMA_VERSION,
  title: 'Portal de siniestros',
  brief: 'Arquitectura del portal de siniestros.',
  businessProjectIds: [],
  initiativeIds: [],
  priority: 'medium',
  status: 'in-progress',
  charter: {
    kind: 'new-solution',
    objectives: [],
    scope: [],
    outOfScope: [],
    constraints: ['Sin datos de salud fuera de la región.'],
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
  tasks: [producer, { ...reviewer, review: { reviewerId: 'elena', verdict: 'approved', findings: [], summary: 'Cumple.', decidedAt: NOW } }],
  arbDecisions: [],
  budget: { ...DEFAULT_OFFICE_BUDGET, consumedAiCalls: 0 },
  auditTrail: [],
  createdBy: SYSTEM_OFFICE_ACTOR,
  createdAt: NOW,
  updatedAt: NOW,
};

const artifact: Artifact = {
  id: 'art-1',
  versionGroupId: 'art-1',
  version: 1,
  createdAt: NOW,
  name: 'Contenedores del portal',
  type: 'markdown',
  phase: 'Fase 2',
  architecturalView: 'Vista de Gestión y Soporte',
  content: '# Contenedores\n\nPortal (React) → Core (AS/400).',
  objective: 'Mostrar los contenedores del portal.',
  keyConcepts: [],
  representation: 'document',
};

const envelope = (kind: AgentHandoffEnvelope['kind']): AgentHandoffEnvelope => ({
  handoffId: 'handoff-canon',
  kind,
  sourceAgentId: 'lucia',
  targetAgentId: kind === 'workstream' ? 'felipe' : 'alejandro',
  reason: 'La operación necesita el análisis de este dominio.',
  objective: 'Analiza desde Arquitecto de Soluciones AWS: portal de siniestros',
  constraints: ['No inventes evidencia.'],
  acceptanceCriteria: ['Supuestos explícitos.'],
  contextReferences: kind === 'workstream'
    ? [{ kind: 'coordination-brief', label: 'Brief de coordinación', from: 'lucia', content: 'Brief.' }]
    : [{ kind: 'workstream-result', label: 'Workstream ws-1-felipe', from: 'felipe', status: 'completed', content: 'Análisis AWS.' }],
  expectedOutput: kind === 'workstream'
    ? { kind: 'analysis', description: 'Un análisis del dominio.' }
    : { kind: 'recommendation', description: 'Una recomendación Ready, Conditional o Blocked con su justificación.' },
  budget: { maxAiCalls: 1 },
  issuedAt: NOW,
});

const profileOverride = createAgentProfileOverride({
  agentId: 'elena',
  userId: 'u-canon',
  knowledge: ['El canal de corredores corre en AS/400.'],
  memory: ['Usamos OpenAPI 3.1.'],
}, () => NOW);

/** El caso canónico de cada plantilla. Una plantilla nueva añade el suyo. */
const RENDER: Readonly<Record<AgentPromptId, () => string>> = {
  'office.persona': () => buildOfficePersonaInstruction('INSTRUCCIÓN BASE', OFFICE_AGENT_PERSONAS.felipe),
  'office.profile-briefing': () => {
    if (profileOverride.outcome !== 'created') throw new Error(profileOverride.message);
    return buildAgentProfileBriefing(resolveAgentProfile('elena', profileOverride.override)).join('\n');
  },
  'office.scope-briefing': () => buildScopeBriefing({
    level: 'project',
    id: 'proj-canon',
    name: 'Portal de siniestros',
    briefing: ['Reducir el tiempo de pago de siniestros.'],
    ancestry: [{ level: 'initiative', name: 'Experiencia del asegurado', summary: 'Pagos más rápidos.' }],
  }),
  'office.workstream': () => renderHandoffPrompt(envelope('workstream')),
  'office.consolidation': () => renderHandoffPrompt(envelope('consolidation')),
  'office.consolidation-refinement': () => buildConsolidationRefinementPrompt(
    'Felipe propone Lambda.',
    { ok: false, gaps: ['Cierra con un veredicto explícito: Ready, Conditional o Blocked.'] },
  ),
  'office.production': () => buildProductionInstruction(producer, engagement),
  'office.review': () => buildReviewPrompt(reviewer, artifact, { findings: [], blockingValidatorIds: [], score: 80, blocking: false }),
  'office.engagement-consolidation': () => buildConsolidationPrompt(engagement),
};

describe('el catálogo de prompts de agente', () => {
  it('tiene un caso canónico para cada plantilla, y ninguno de más', () => {
    expect(Object.keys(RENDER).sort()).toEqual(Object.keys(AGENT_PROMPTS).sort());
  });

  it.each(Object.keys(AGENT_PROMPTS) as AgentPromptId[])('%s no cambió de texto sin cambiar de versión', (id) => {
    const fingerprint = fingerprintPrompt(RENDER[id]());
    expect(
      fingerprint,
      `El texto de «${id}» cambió (huella ${fingerprint}). Si fue a propósito, sube su versión `
        + `(v${AGENT_PROMPTS[id].version} → v${AGENT_PROMPTS[id].version + 1}) y pon esa huella en lib/agents/promptCatalog.ts.`,
    ).toBe(AGENT_PROMPTS[id].fingerprint);
  });

  it('cada plantilla tiene versión entera ≥ 1 y una descripción', () => {
    for (const [id, entry] of Object.entries(AGENT_PROMPTS)) {
      expect(Number.isInteger(entry.version) && entry.version >= 1, id).toBe(true);
      expect(entry.description.length, id).toBeGreaterThan(20);
    }
  });
});

describe('el sello de una invocación', () => {
  it('dice la plantilla, su versión y la huella del texto exacto', () => {
    const stamp = stampPrompt(agentPromptRef('office.review'), 'texto');
    expect(parsePromptStamp(stamp)).toEqual({
      id: 'office.review',
      version: AGENT_PROMPTS['office.review'].version,
      hash: fingerprintPrompt('texto'),
    });
  });

  it('distingue dos textos de la misma plantilla y repite el del mismo texto', () => {
    const ref = agentPromptRef('office.workstream');
    expect(stampPrompt(ref, 'a')).not.toBe(stampPrompt(ref, 'b'));
    expect(stampPrompt(ref, 'a')).toBe(stampPrompt(ref, 'a'));
  });

  it('rechaza lo que no es un sello', () => {
    expect(parsePromptStamp('office.review')).toBeNull();
    expect(parsePromptStamp('office.review@v1#zz')).toBeNull();
  });
});
