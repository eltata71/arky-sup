/**
 * Arnés del banco de evaluación de agentes (plan de agentes, 15.0).
 *
 * Ejecuta cada caso de `tests/fixtures/agent-evals/` por el código de
 * producción —el router, el clasificador de intención, el contrato de handoff,
 * el puerto de revisión del runner, la orquestación y los compositores de
 * prompt— con el modelo sustituido por la respuesta que trae el caso. Mide la
 * canalización, nunca al modelo: un caso cuyo resultado dependa de lo que un
 * modelo real decidiría no pertenece a este banco.
 *
 * El único doble fuera de este fichero es `executeAgentAction`, que la prueba
 * reemplaza para leer con qué persona el runner produciría una tarea (A7).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UNTRUSTED_FENCE_CLOSE, UNTRUSTED_FENCE_OPEN } from '../../../lib/untrustedContent';
import type { Artifact } from '../../../lib/artifacts';
import type { Project } from '../../../services/architectureProjects';
import { classifyAgentIntent } from '../../../services/agent';
import type { AgentIntentType } from '../../../services/agent';
import {
  executeOfficeOrchestration,
  planOfficeWorkstreams,
  type OfficeAgentInvoker,
} from '../../../services/architectureOffice/application/officeOrchestration';
import { createHandoff, MAX_HANDOFF_CONTEXT_REFERENCES } from '../../../services/architectureOffice/domain/agentHandoff';
import type { AgentHandoffKind, OfficeAgentId } from '../../../services/architectureOffice/domain/agentDefinition';
import {
  evaluateConsolidation,
  type OfficeWorkstreamResult,
} from '../../../services/architectureOffice/domain/officeConsolidationReview';
import {
  buildAgentProfileBriefing,
  createAgentProfileOverride,
  resolveAgentProfile,
} from '../../../services/architectureOffice/domain/officeAgentProfile';
import { OFFICE_AGENT_PERSONAS } from '../../../services/architectureOffice/domain/officeAgentPersonas';
import {
  buildConsolidationPrompt,
  buildProductionInstruction,
  buildReviewPrompt,
  createConsolidatePort,
  createProduceArtifactPort,
  createReviewArtifactPort,
  gatherDeterministicEvidence,
  type OfficeRunnerAdapterDeps,
} from '../../../services/architectureOffice/infrastructure/OfficeRunnerAdapters';
import {
  DEFAULT_OFFICE_BUDGET,
  OFFICE_ENGAGEMENT_SCHEMA_VERSION,
  SYSTEM_OFFICE_ACTOR,
  type OfficeEngagement,
  type OfficeTask,
  type OfficeTaskReview,
} from '../../../services/architectureOffice/domain/OfficeTypes';
import type { Settings } from '../../../types';

export const CORPUS_DIR = join(process.cwd(), 'tests', 'fixtures', 'agent-evals');

// ---------------------------------------------------------------------------
// El corpus
// ---------------------------------------------------------------------------

export interface RoutingCase {
  id: string;
  solicitud: string;
  esperados: OfficeAgentId[];
  prohibidos: OfficeAgentId[];
  desactivados?: OfficeAgentId[];
  maxEspecialistas?: number;
}

export interface IntentCase {
  id: string;
  mensaje: string;
  tipo: AgentIntentType;
  confirmacion?: boolean;
  sugerenciasPendientes?: boolean;
}

export interface HandoffContractCase {
  id: string;
  origen: OfficeAgentId;
  destino: OfficeAgentId;
  tipo: AgentHandoffKind;
  objetivo?: string;
  presupuesto?: number;
  referencias?: number;
  /** `issued`, o el código de rechazo que debe aparecer. */
  esperado: string;
}

export interface PinnedPersonaCase {
  id: string;
  asignado: OfficeAgentId;
  brief: string;
}

export type SimulatedCritique = 'falla' | 'texto-roto' | 'vacia' | Record<string, unknown>;

export interface ReviewCase {
  id: string;
  /** ¿El veredicto correcto es una aprobación limpia, presentada como revisada? */
  aprueba: boolean;
  artefacto: Pick<Artifact, 'name' | 'type' | 'content'> & Partial<Pick<Artifact, 'representation'>>;
  critica: SimulatedCritique;
}

export interface ConsolidationCase {
  id: string;
  camino: 'coordinacion' | 'encargo';
  solicitud?: string;
  especialistas?: Partial<Record<OfficeAgentId, string>>;
  consolidaciones: string[];
  debeCorregir: boolean;
  finalValida: boolean;
}

const read = <T>(file: string): T => JSON.parse(readFileSync(join(CORPUS_DIR, file), 'utf8')) as T;

export const loadCorpus = () => ({
  enrutado: read<{ casos: RoutingCase[] }>('enrutado.json').casos,
  intencion: read<{ casos: IntentCase[] }>('intencion.json').casos,
  contratos: read<{ contratos: HandoffContractCase[] }>('handoff.json').contratos,
  personaFijada: read<{ personaFijada: PinnedPersonaCase[] }>('handoff.json').personaFijada,
  revision: read<{ casos: ReviewCase[] }>('revision.json').casos,
  consolidacion: read<{ casos: ConsolidationCase[] }>('consolidacion.json').casos,
});

export type AgentEvalCorpus = ReturnType<typeof loadCorpus>;

// ---------------------------------------------------------------------------
// Fixtures de dominio
// ---------------------------------------------------------------------------

const NOW = '2026-10-13T00:00:00.000Z';

const artifactFrom = (id: string, spec: ReviewCase['artefacto']): Artifact => ({
  id,
  versionGroupId: id,
  version: 1,
  createdAt: NOW,
  name: spec.name,
  type: spec.type,
  phase: 'Fase 2',
  architecturalView: 'Vista de Gestión y Soporte',
  content: spec.content,
  objective: `Entregable de la Oficina: ${spec.name}.`,
  keyConcepts: [],
  representation: spec.representation ?? 'document',
});

const projectWith = (artifacts: Artifact[]): Project => ({
  id: 'proj-eval',
  name: 'Portal de siniestros',
  description: 'Proyecto del banco de agentes.',
  artifacts,
  createdAt: NOW,
  updatedAt: NOW,
} as unknown as Project);

const officeTask = (
  overrides: Partial<OfficeTask> & Pick<OfficeTask, 'id' | 'kind' | 'assigneeId'>,
): OfficeTask => ({
  engagementId: 'eng-eval',
  title: overrides.id,
  objective: 'Producir el entregable acordado en el charter.',
  dependsOn: [],
  acceptanceCriteria: ['Cumple el contrato del tipo de artefacto.'],
  status: 'ready',
  attempts: 0,
  maxAttempts: 2,
  ...overrides,
});

const engagementWith = (tasks: OfficeTask[], brief = 'Arquitectura del portal de siniestros.'): OfficeEngagement => ({
  id: 'eng-eval',
  projectId: 'proj-eval',
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
  tasks,
  arbDecisions: [],
  budget: { ...DEFAULT_OFFICE_BUDGET, consumedAiCalls: 0 },
  auditTrail: [],
  createdBy: SYSTEM_OFFICE_ACTOR,
  createdAt: NOW,
  updatedAt: NOW,
});

const SETTINGS = { aiConfig: {} } as unknown as Settings;

const runnerDeps = (
  project: Project,
  invokePersona: OfficeRunnerAdapterDeps['invokePersona'],
): OfficeRunnerAdapterDeps => ({
  getProject: () => project,
  getSettings: () => SETTINGS,
  store: {
    createArtifactVersion: () => { throw new Error('el banco no persiste'); },
    updateArtifact: () => undefined,
  },
  invokePersona,
  persist: async (engagement) => ({ status: 'success', data: engagement } as never),
});

// ---------------------------------------------------------------------------
// Familia 1 — enrutado
// ---------------------------------------------------------------------------

export interface RoutingResult {
  id: string;
  convocados: OfficeAgentId[];
  faltan: OfficeAgentId[];
  prohibidosConvocados: OfficeAgentId[];
  desactivadosConvocados: OfficeAgentId[];
  topeRespetado: boolean;
  ok: boolean;
}

export const runRouting = (testCase: RoutingCase): RoutingResult => {
  const plan = planOfficeWorkstreams(testCase.solicitud, {
    unavailable: testCase.desactivados,
    maxSpecialists: testCase.maxEspecialistas,
  });
  const convocados = plan.workstreams.map((workstream) => workstream.personaId);
  const faltan = testCase.esperados.filter((id) => !convocados.includes(id));
  const prohibidosConvocados = testCase.prohibidos.filter((id) => convocados.includes(id));
  const desactivadosConvocados = (testCase.desactivados ?? []).filter((id) => convocados.includes(id));
  const topeRespetado = convocados.length >= 1 && convocados.length <= (testCase.maxEspecialistas ?? 4);
  return {
    id: testCase.id,
    convocados,
    faltan,
    prohibidosConvocados,
    desactivadosConvocados,
    topeRespetado,
    ok: faltan.length === 0 && prohibidosConvocados.length === 0 && desactivadosConvocados.length === 0 && topeRespetado,
  };
};

// ---------------------------------------------------------------------------
// Familia 2 — intención
// ---------------------------------------------------------------------------

export interface IntentResult {
  id: string;
  tipo: AgentIntentType;
  esperado: AgentIntentType;
  pideConfirmacion: boolean;
  confirmacionEsperada: boolean;
  tipoCorrecto: boolean;
  confirmacionCorrecta: boolean;
}

const ACTIVE_ARTIFACT = artifactFrom('art-activo', {
  name: 'Contenedores del portal de siniestros',
  type: 'mermaid-c4-container',
  representation: 'diagram',
  content: 'C4Container\n  title Portal de siniestros\n  Container(portal, "Portal", "React")\n  Container(core, "Core", "AS/400")\n  Rel(portal, core, "Consulta", "HTTPS")',
});

export const runIntent = (testCase: IntentCase): IntentResult => {
  const intent = classifyAgentIntent(testCase.mensaje, {
    artifact: ACTIVE_ARTIFACT,
    viewMode: 'diagram',
    history: [],
    hasPendingSuggestions: testCase.sugerenciasPendientes ?? false,
  });
  const confirmacionEsperada = testCase.confirmacion ?? false;
  return {
    id: testCase.id,
    tipo: intent.type,
    esperado: testCase.tipo,
    pideConfirmacion: intent.requiresConfirmation,
    confirmacionEsperada,
    tipoCorrecto: intent.type === testCase.tipo,
    // Sólo se exige en un sentido: pedir confirmación de más es fricción, no
    // daño; no pedirla en una acción de alto impacto es el defecto.
    confirmacionCorrecta: !confirmacionEsperada || intent.requiresConfirmation,
  };
};

// ---------------------------------------------------------------------------
// Familia 3 — handoff y persona fijada
// ---------------------------------------------------------------------------

export interface HandoffContractResult {
  id: string;
  obtenido: string;
  esperado: string;
  ok: boolean;
}

export const runHandoffContract = (testCase: HandoffContractCase): HandoffContractResult => {
  const references = Array.from({ length: testCase.referencias ?? 1 }, (_, index) => ({
    kind: 'record' as const,
    label: `Referencia ${index + 1}`,
    content: 'Contexto del registro.',
  }));
  const outcome = createHandoff({
    kind: testCase.tipo,
    sourceAgentId: testCase.origen,
    targetAgentId: testCase.destino,
    reason: 'Caso del banco.',
    objective: testCase.objetivo ?? 'Analizar el dominio de la solicitud.',
    constraints: [],
    acceptanceCriteria: ['Supuestos explícitos.'],
    contextReferences: references,
    expectedOutput: { kind: 'analysis', description: 'Un análisis del dominio.' },
    budget: { maxAiCalls: testCase.presupuesto ?? 1 },
  });
  const obtenido = outcome.outcome === 'issued' ? 'issued' : outcome.rejections.map((r) => r.code).join(',');
  const ok = testCase.esperado === 'issued'
    ? obtenido === 'issued'
    : obtenido.split(',').includes(testCase.esperado);
  return { id: testCase.id, obtenido, esperado: testCase.esperado, ok };
};

/** Cuántas referencias admite un handoff; el corpus pide superarlo. */
export const HANDOFF_REFERENCE_LIMIT = MAX_HANDOFF_CONTEXT_REFERENCES;

export interface PinnedPersonaResult {
  id: string;
  asignado: OfficeAgentId;
  firmaria: string;
  ok: boolean;
}

/** Lo que el doble de `executeAgentAction` recuerda de la última llamada. */
export interface CapturedExecution {
  instruction: string;
  resolvePersona?: (message: string) => { composeInstruction: (base: string) => string };
}

/**
 * Con qué persona produciría el runner esta tarea.
 *
 * Ejecuta el puerto real de producción; el doble de `executeAgentAction`
 * guarda la instrucción y el `resolvePersona` que recibió, y aquí se compone
 * la persona exactamente como lo haría el motor.
 */
export const runPinnedPersona = async (
  testCase: PinnedPersonaCase,
  lastExecution: () => CapturedExecution | null,
): Promise<PinnedPersonaResult> => {
  const task = officeTask({
    id: `produce-${testCase.id}`,
    kind: 'produce-artifact',
    assigneeId: testCase.asignado,
    targetArtifactType: 'markdown',
  });
  const engagement = engagementWith([task], testCase.brief);
  const produce = createProduceArtifactPort(runnerDeps(projectWith([]), async () => ''));
  await produce(task, engagement);
  const captured = lastExecution();
  const composed = captured?.resolvePersona
    ? captured.resolvePersona(captured.instruction).composeInstruction('BASE')
    : '';
  const match = /Persona especializada activa: ([^\s—]+)/.exec(composed);
  const firmaria = match?.[1] ?? '(ninguna)';
  return {
    id: testCase.id,
    asignado: testCase.asignado,
    firmaria,
    ok: firmaria === OFFICE_AGENT_PERSONAS[testCase.asignado].alias,
  };
};

// ---------------------------------------------------------------------------
// Familia 4 — revisión
// ---------------------------------------------------------------------------

export interface ReviewResult {
  id: string;
  veredicto: OfficeTaskReview['verdict'];
  /** Aprobada y presentada como revisada por el especialista. */
  aprobacionLimpia: boolean;
  aprueba: boolean;
  /** El defecto lo ve la evidencia determinista, diga lo que diga el modelo. */
  defectoDeterminista: boolean;
  criticaDisponible: boolean;
  ok: boolean;
}

const simulatedCritique = (critique: SimulatedCritique): OfficeRunnerAdapterDeps['invokePersona'] =>
  async () => {
    if (critique === 'falla') throw new Error('503 del proveedor (simulado)');
    if (critique === 'texto-roto') return 'El artefacto está bien, apruebo {verdict: approved';
    if (critique === 'vacia') return '';
    return JSON.stringify(critique);
  };

/**
 * Una aprobación es «limpia» cuando se presenta como revisada sin salvedad.
 *
 * La tarea 17.1 añade a `OfficeTaskReview` la base del veredicto; una
 * aprobación marcada `evidence-only` no es limpia, porque dice que el
 * especialista no llegó a revisarla.
 */
const isCleanApproval = (review: OfficeTaskReview): boolean =>
  review.verdict === 'approved'
  && (review as OfficeTaskReview & { basis?: string }).basis !== 'evidence-only';

export const runReview = async (testCase: ReviewCase): Promise<ReviewResult> => {
  const artifact = artifactFrom(`art-${testCase.id}`, testCase.artefacto);
  const producer = officeTask({
    id: 'produce-1',
    kind: 'produce-artifact',
    assigneeId: 'felipe',
    status: 'completed',
    producedArtifactId: artifact.id,
  });
  const reviewTask = officeTask({
    id: 'review-1',
    kind: 'review-artifact',
    assigneeId: 'elena',
    reviewsTaskId: producer.id,
    dependsOn: [producer.id],
  });
  const engagement = engagementWith([producer, reviewTask]);
  const review = await createReviewArtifactPort(
    runnerDeps(projectWith([artifact]), simulatedCritique(testCase.critica)),
  )(reviewTask, engagement);
  const aprobacionLimpia = isCleanApproval(review);
  return {
    id: testCase.id,
    veredicto: review.verdict,
    aprobacionLimpia,
    aprueba: testCase.aprueba,
    defectoDeterminista: gatherDeterministicEvidence(artifact).blocking,
    criticaDisponible: typeof testCase.critica === 'object',
    ok: aprobacionLimpia === testCase.aprueba,
  };
};

// ---------------------------------------------------------------------------
// Familia 5 — consolidación
// ---------------------------------------------------------------------------

export interface ConsolidationResult {
  id: string;
  camino: ConsolidationCase['camino'];
  corrigio: boolean;
  debeCorregir: boolean;
  finalValida: boolean;
  finalEsperada: boolean;
  llamadas: number;
  ok: boolean;
}

const scriptedConsolidator = (responses: readonly string[]) => {
  let turn = 0;
  return () => {
    const response = responses[Math.min(turn, responses.length - 1)];
    turn += 1;
    return response;
  };
};

export const runConsolidation = async (testCase: ConsolidationCase): Promise<ConsolidationResult> => {
  if (testCase.camino === 'coordinacion') {
    const specialists = testCase.especialistas ?? {};
    const plan = planOfficeWorkstreams(testCase.solicitud ?? '', { maxSpecialists: 4 });
    // El plan del caso es el que el caso declara: el enrutado se mide en su familia.
    plan.workstreams = Object.keys(specialists).map((personaId, index) => ({
      id: `ws-${index + 1}-${personaId}`,
      personaId: personaId as OfficeAgentId,
      objective: `Analiza: ${testCase.solicitud ?? ''}`,
      acceptanceCriteria: ['Supuestos explícitos.'],
    }));
    const consolidator = scriptedConsolidator(testCase.consolidaciones);
    let calls = 0;
    let consolidatorCalls = 0;
    const invoke: OfficeAgentInvoker = async (personaId) => {
      calls += 1;
      if (personaId === plan.coordinatorId) return 'Brief: cada especialista analiza su dominio.';
      if (personaId === plan.consolidatorId) {
        consolidatorCalls += 1;
        return consolidator();
      }
      const output = specialists[personaId] ?? '';
      if (output === '__falla__') throw new Error('timeout (simulado)');
      return output;
    };
    const result = await executeOfficeOrchestration(plan, invoke);
    const finalValida = evaluateConsolidation(result.consolidation, result.workstreamResults).ok;
    const corrigio = consolidatorCalls > 1;
    return {
      id: testCase.id,
      camino: testCase.camino,
      corrigio,
      debeCorregir: testCase.debeCorregir,
      finalValida,
      finalEsperada: testCase.finalValida,
      llamadas: calls,
      ok: corrigio === testCase.debeCorregir && finalValida === testCase.finalValida,
    };
  }

  // El encargo: un productor entregado y revisado, y la consolidación final.
  const producer = officeTask({ id: 'produce-1', kind: 'produce-artifact', assigneeId: 'felipe', status: 'completed', producedArtifactId: 'art-1' });
  const consolidate = officeTask({ id: 'consolidate-1', kind: 'consolidate', assigneeId: 'alejandro', dependsOn: [producer.id] });
  const engagement = engagementWith([producer, consolidate]);
  const consolidator = scriptedConsolidator(testCase.consolidaciones);
  let calls = 0;
  const outcome = await createConsolidatePort(runnerDeps(projectWith([]), async () => {
    calls += 1;
    return consolidator();
  }))(consolidate, engagement);
  const contributions: OfficeWorkstreamResult[] = [{ workstreamId: producer.id, personaId: 'felipe', status: 'completed', output: '' }];
  const finalValida = evaluateConsolidation(outcome.summary, contributions).ok;
  const corrigio = calls > 1;
  return {
    id: testCase.id,
    camino: testCase.camino,
    corrigio,
    debeCorregir: testCase.debeCorregir,
    finalValida,
    finalEsperada: testCase.finalValida,
    llamadas: calls,
    ok: corrigio === testCase.debeCorregir && finalValida === testCase.finalValida,
  };
};

// ---------------------------------------------------------------------------
// Familia 6 — vallado de lo que escribió una persona
// ---------------------------------------------------------------------------

/** ¿Cada aparición del marcador está dentro de una valla abierta y sin cerrar? */
export const isFenced = (prompt: string, marker: string): boolean => {
  let from = 0;
  let seen = false;
  for (;;) {
    const at = prompt.indexOf(marker, from);
    if (at < 0) return seen;
    seen = true;
    const open = prompt.lastIndexOf(UNTRUSTED_FENCE_OPEN, at);
    const close = prompt.lastIndexOf(UNTRUSTED_FENCE_CLOSE, at);
    if (open < 0 || open < close) return false;
    from = at + marker.length;
  }
};

export interface FenceResult {
  sitio: string;
  presente: boolean;
  vallado: boolean;
}

const MARKER = 'MARCADOR-DE-USUARIO-7Q2';

const profileWith = (field: 'knowledge' | 'memory' | 'instruction') => {
  const created = createAgentProfileOverride({
    agentId: 'elena',
    userId: 'u-1',
    ...(field === 'instruction' ? { instruction: `Sigue esto: ${MARKER}` } : { [field]: [`Regla: ${MARKER}`] }),
  });
  if (created.outcome !== 'created') throw new Error(created.message);
  return resolveAgentProfile('elena', created.override);
};

/**
 * Los sitios donde un texto que no escribió la aplicación entra en un prompt
 * de agente (A8). Cada uno se renderiza con el código real.
 */
export const runFencing = async (): Promise<FenceResult[]> => {
  const sites: { sitio: string; prompt: string }[] = [];
  const produce = officeTask({ id: 'produce-1', kind: 'produce-artifact', assigneeId: 'felipe' });
  const withBrief = engagementWith([produce], `Brief del usuario: ${MARKER}`);
  sites.push({ sitio: 'encargo · producir · brief', prompt: buildProductionInstruction(produce, withBrief) });
  sites.push({ sitio: 'encargo · consolidar · brief', prompt: buildConsolidationPrompt(withBrief) });

  const reviewed = artifactFrom('art-vallado', { name: 'Documento', type: 'markdown', content: `# Documento\n\n${MARKER}` });
  const reviewTask = officeTask({ id: 'review-1', kind: 'review-artifact', assigneeId: 'elena' });
  sites.push({
    sitio: 'encargo · revisar · contenido',
    prompt: buildReviewPrompt(reviewTask, reviewed, gatherDeterministicEvidence(reviewed)),
  });

  const plan = planOfficeWorkstreams(`Arquitectura AWS ${MARKER}`);
  const prompts = new Map<string, string>();
  await executeOfficeOrchestration(plan, async (personaId, instruction) => {
    if (!prompts.has(personaId)) prompts.set(personaId, instruction);
    return personaId === plan.consolidatorId
      ? 'Veredicto: Ready. '.padEnd(240, '.')
      : 'Análisis.';
  }, { maxConsolidationRefinements: 0 });
  sites.push({ sitio: 'coordinación · solicitud al coordinador', prompt: prompts.get(plan.coordinatorId) ?? '' });
  sites.push({ sitio: 'coordinación · objetivo del especialista', prompt: prompts.get(plan.workstreams[0].personaId) ?? '' });

  sites.push({ sitio: 'ficha · conocimiento', prompt: buildAgentProfileBriefing(profileWith('knowledge')).join('\n') });
  sites.push({ sitio: 'ficha · memoria', prompt: buildAgentProfileBriefing(profileWith('memory')).join('\n') });
  sites.push({ sitio: 'ficha · instrucción', prompt: buildAgentProfileBriefing(profileWith('instruction')).join('\n') });

  return sites.map(({ sitio, prompt }) => ({
    sitio,
    presente: prompt.includes(MARKER),
    vallado: isFenced(prompt, MARKER),
  }));
};

// ---------------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------------

export interface AgentEvalResults {
  enrutado: RoutingResult[];
  intencion: IntentResult[];
  contratos: HandoffContractResult[];
  personaFijada: PinnedPersonaResult[];
  revision: ReviewResult[];
  consolidacion: ConsolidationResult[];
  vallado: FenceResult[];
}

export interface AgentEvalSummary {
  precisionEnrutado: number;
  especialistasProhibidosConvocados: number;
  desactivadosConvocados: number;
  precisionIntencion: number;
  confirmacionCorrecta: number;
  handoffsBienDecididos: number;
  personaFijada: number;
  recallRevisor: number;
  aprobacionesSinCritica: number;
  consolidacionesCorrectas: number;
  promptsConVallado: number;
  llamadasPorOperacion: number;
}

export type AgentEvalMetric = keyof AgentEvalSummary;

const pct = (part: number, total: number): number =>
  total === 0 ? 100 : Math.round((part / total) * 1000) / 10;

export const summarize = (results: AgentEvalResults): AgentEvalSummary => {
  const defective = results.revision.filter((r) => r.defectoDeterminista);
  const withoutCritique = results.revision.filter((r) => !r.criticaDisponible);
  const coordination = results.consolidacion.filter((r) => r.camino === 'coordinacion');
  return {
    precisionEnrutado: pct(results.enrutado.filter((r) => r.ok).length, results.enrutado.length),
    especialistasProhibidosConvocados: results.enrutado.reduce((n, r) => n + r.prohibidosConvocados.length, 0),
    desactivadosConvocados: results.enrutado.reduce((n, r) => n + r.desactivadosConvocados.length, 0),
    precisionIntencion: pct(results.intencion.filter((r) => r.tipoCorrecto).length, results.intencion.length),
    confirmacionCorrecta: pct(
      results.intencion.filter((r) => r.confirmacionEsperada && r.confirmacionCorrecta).length,
      results.intencion.filter((r) => r.confirmacionEsperada).length,
    ),
    handoffsBienDecididos: pct(results.contratos.filter((r) => r.ok).length, results.contratos.length),
    personaFijada: pct(results.personaFijada.filter((r) => r.ok).length, results.personaFijada.length),
    recallRevisor: pct(defective.filter((r) => !r.aprobacionLimpia).length, defective.length),
    aprobacionesSinCritica: withoutCritique.filter((r) => r.aprobacionLimpia).length,
    consolidacionesCorrectas: pct(results.consolidacion.filter((r) => r.ok).length, results.consolidacion.length),
    promptsConVallado: pct(results.vallado.filter((r) => r.presente && r.vallado).length, results.vallado.length),
    llamadasPorOperacion: coordination.length === 0
      ? 0
      : Math.round((coordination.reduce((n, r) => n + r.llamadas, 0) / coordination.length) * 10) / 10,
  };
};

/**
 * El objetivo de cada métrica (sección 4.2 del plan). `llamadasPorOperacion`
 * se registra pero no tiene objetivo: es coste, y lo vigilan 17.3 y 19.1.
 */
export const TARGETS: Readonly<Record<Exclude<AgentEvalMetric, 'llamadasPorOperacion'>, { min?: number; max?: number }>> = {
  precisionEnrutado: { min: 90 },
  especialistasProhibidosConvocados: { max: 0 },
  desactivadosConvocados: { max: 0 },
  precisionIntencion: { min: 90 },
  confirmacionCorrecta: { min: 100 },
  handoffsBienDecididos: { min: 100 },
  personaFijada: { min: 100 },
  recallRevisor: { min: 85 },
  aprobacionesSinCritica: { max: 0 },
  consolidacionesCorrectas: { min: 100 },
  promptsConVallado: { min: 100 },
};

/** Para la línea base: qué dirección es «mejor» en cada métrica. */
export const LOWER_IS_BETTER: readonly AgentEvalMetric[] = [
  'especialistasProhibidosConvocados',
  'desactivadosConvocados',
  'aprobacionesSinCritica',
];

export const meetsTarget = (metric: keyof typeof TARGETS, value: number): boolean => {
  const target = TARGETS[metric];
  if (target.min !== undefined && value < target.min) return false;
  if (target.max !== undefined && value > target.max) return false;
  return true;
};

const yes = (value: boolean): string => (value ? 'sí' : '**no**');

export const renderReport = (results: AgentEvalResults, summary: AgentEvalSummary): string => {
  const lines = [
    '# Banco de evaluación de agentes',
    '',
    '| Métrica | Valor | Objetivo |',
    '|---|---|---|',
    ...(Object.keys(summary) as AgentEvalMetric[]).map((metric) => {
      const target = metric === 'llamadasPorOperacion' ? undefined : TARGETS[metric];
      const goal = target?.min !== undefined ? `≥ ${target.min}` : target?.max !== undefined ? `≤ ${target.max}` : '—';
      return `| ${metric} | ${summary[metric]} | ${goal} |`;
    }),
    '',
    '## Enrutado',
    '| Caso | Convocados | Faltan | Prohibidos convocados | OK |',
    '|---|---|---|---|---|',
    ...results.enrutado.map((r) => `| ${r.id} | ${r.convocados.join(', ')} | ${r.faltan.join(', ') || '—'} | ${[...r.prohibidosConvocados, ...r.desactivadosConvocados].join(', ') || '—'} | ${yes(r.ok)} |`),
    '',
    '## Intención',
    '| Caso | Obtenido | Esperado | Confirma | OK |',
    '|---|---|---|---|---|',
    ...results.intencion.map((r) => `| ${r.id} | ${r.tipo} | ${r.esperado} | ${r.pideConfirmacion ? 'sí' : 'no'} | ${yes(r.tipoCorrecto && r.confirmacionCorrecta)} |`),
    '',
    '## Handoff',
    ...results.contratos.map((r) => `- ${r.id}: ${r.obtenido} (esperado ${r.esperado}) ${r.ok ? '' : '**FALLA**'}`),
    ...results.personaFijada.map((r) => `- persona fijada ${r.id}: asignado ${r.asignado}, firmaría ${r.firmaria} ${r.ok ? '' : '**FALLA**'}`),
    '',
    '## Revisión',
    '| Caso | Veredicto | Aprobación limpia | Debía aprobar | OK |',
    '|---|---|---|---|---|',
    ...results.revision.map((r) => `| ${r.id} | ${r.veredicto} | ${r.aprobacionLimpia ? 'sí' : 'no'} | ${r.aprueba ? 'sí' : 'no'} | ${yes(r.ok)} |`),
    '',
    '## Consolidación',
    '| Caso | Camino | Corrigió | Debía | Final válida | Llamadas | OK |',
    '|---|---|---|---|---|---|---|',
    ...results.consolidacion.map((r) => `| ${r.id} | ${r.camino} | ${r.corrigio ? 'sí' : 'no'} | ${r.debeCorregir ? 'sí' : 'no'} | ${r.finalValida ? 'sí' : 'no'} | ${r.llamadas} | ${yes(r.ok)} |`),
    '',
    '## Vallado',
    ...results.vallado.map((r) => `- ${r.sitio}: ${r.presente ? (r.vallado ? 'vallado' : '**sin vallar**') : '**no aparece**'}`),
  ];
  return lines.join('\n');
};
