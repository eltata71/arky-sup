/**
 * El refinamiento de un charter por IA: el prompt y la lectura desconfiada de
 * su respuesta. Separado de `OfficeEngagementPlanner` (el plan determinista)
 * cuando éste pasó su techo de tamaño; el comportamiento no cambió.
 */
import { ARTIFACT_TEMPLATES } from '../../../constants';
import { parseStructured } from '../../ai/structuredOutput';
import { OFFICE_AGENT_PERSONAS, type OfficeAgentId } from './officeAgentPersonas';
import { listAgents } from './agentRegistry';
import { buildTasksFromCharter, findTemplate, validateCharter, type PlanEngagementInput } from './OfficeEngagementPlanner';
import { findTaskCycle, type OfficeCharter, type OfficeCharterDeliverable } from './OfficeTypes';


interface RefinedDeliverable {
  templateName?: unknown;
  assigneeId?: unknown;
  reviewerId?: unknown;
  rationale?: unknown;
  dependsOnTemplateNames?: unknown;
}

interface RefinedCharterPayload {
  objectives?: unknown;
  scope?: unknown;
  outOfScope?: unknown;
  constraints?: unknown;
  regulatoryDrivers?: unknown;
  deliverables?: unknown;
}

/** Prompt for the refinement pass. Pure string building — no I/O. */
export const buildCharterRefinementPrompt = (
  input: PlanEngagementInput,
  scaffold: OfficeCharter,
): string => {
  const catalogue = ARTIFACT_TEMPLATES
    .map((template) => `- ${template.name} (${template.type}, ${template.phase})`)
    .join('\n');
  const roster = listAgents()
    .filter((persona) => persona.producesArtifactTypes.length > 0)
    .map((persona) => `- ${persona.id} (${persona.role}) produce: ${persona.producesArtifactTypes.join(', ')}`)
    .join('\n');

  return [
    'Eres la Orquestadora de una Oficina de Arquitectura Empresarial de una compañía de seguros.',
    'Refina el charter propuesto para el siguiente entregable.',
    '',
    `TÍTULO: ${input.title}`,
    `SOLICITUD: ${input.brief}`,
    '',
    'CHARTER PROPUESTO (determinista):',
    JSON.stringify({
      objectives: scaffold.objectives,
      scope: scaffold.scope,
      deliverables: scaffold.deliverables,
    }, null, 2),
    '',
    'CATÁLOGO DE PLANTILLAS PERMITIDAS (no inventes ninguna otra):',
    catalogue,
    '',
    'PERSONAS Y LO QUE PUEDEN PRODUCIR (no asignes fuera de esta lista):',
    roster,
    '',
    'REGLAS DURAS:',
    '1. `templateName` debe ser exactamente uno del catálogo.',
    '2. `assigneeId` debe declarar el tipo de la plantilla entre los artefactos que produce.',
    '3. `reviewerId` debe ser distinto de `assigneeId`.',
    '4. `dependsOnTemplateNames` solo puede referenciar entregables incluidos en tu propia respuesta.',
    '5. No inventes evidencia ni supuestos que la solicitud no respalde.',
    '',
    'Responde únicamente con un objeto JSON con las claves: objectives, scope, outOfScope, constraints, regulatoryDrivers, deliverables.',
  ].join('\n');
};

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/**
 * Applies a model response to the scaffold.
 *
 * Returns the refined charter only when it parses **and** clears
 * `validateCharter`. Any other outcome returns the scaffold unchanged with the
 * reason — the office keeps running on a plan it can defend.
 */
export const applyCharterRefinement = (
  scaffold: OfficeCharter,
  rawResponse: string | null | undefined,
  /**
   * Agentes desactivados: el modelo no puede asignarles trabajo. Una entrada
   * que los nombre se descarta, igual que una que nombra a un agente que no
   * existe (plan de agentes, 16.1).
   */
  options: { unavailable?: readonly OfficeAgentId[] } = {},
): { charter: OfficeCharter; applied: boolean; reason?: string } => {
  const unavailable = new Set(options.unavailable ?? []);
  const parsed = parseStructured<RefinedCharterPayload>(rawResponse);
  if (!parsed.ok || !parsed.value) {
    return { charter: scaffold, applied: false, reason: parsed.error ?? 'Respuesta no interpretable.' };
  }

  const rawDeliverables = Array.isArray(parsed.value.deliverables) ? parsed.value.deliverables : [];
  const deliverables: OfficeCharterDeliverable[] = [];
  for (const entry of rawDeliverables as RefinedDeliverable[]) {
    if (!entry || typeof entry !== 'object') continue;
    const templateName = typeof entry.templateName === 'string' ? entry.templateName : '';
    const template = findTemplate(templateName);
    if (!template) continue;
    const assigneeId = entry.assigneeId as OfficeAgentId;
    const reviewerId = entry.reviewerId as OfficeAgentId;
    if (!OFFICE_AGENT_PERSONAS[assigneeId] || !OFFICE_AGENT_PERSONAS[reviewerId]) continue;
    if (unavailable.has(assigneeId) || unavailable.has(reviewerId)) continue;
    deliverables.push({
      templateName: template.name,
      artifactType: template.type,
      assigneeId,
      reviewerId,
      rationale: typeof entry.rationale === 'string' && entry.rationale.trim().length > 0
        ? entry.rationale
        : `Entregable asignado a ${OFFICE_AGENT_PERSONAS[assigneeId].role}.`,
      dependsOnTemplateNames: asStringArray(entry.dependsOnTemplateNames),
    });
  }

  if (deliverables.length === 0) {
    return { charter: scaffold, applied: false, reason: 'El refinamiento no propuso entregables válidos.' };
  }

  const participants = new Set<OfficeAgentId>();
  for (const deliverable of deliverables) {
    participants.add(deliverable.assigneeId);
    participants.add(deliverable.reviewerId);
  }

  const candidate: OfficeCharter = {
    ...scaffold,
    objectives: asStringArray(parsed.value.objectives).length > 0
      ? asStringArray(parsed.value.objectives)
      : scaffold.objectives,
    scope: asStringArray(parsed.value.scope).length > 0
      ? asStringArray(parsed.value.scope)
      : deliverables.map((deliverable) => deliverable.templateName),
    // Lo que el plan determinista no pudo asignar sigue diciéndose.
    outOfScope: [...asStringArray(parsed.value.outOfScope), ...scaffold.outOfScope],
    constraints: asStringArray(parsed.value.constraints),
    regulatoryDrivers: asStringArray(parsed.value.regulatoryDrivers).length > 0
      ? asStringArray(parsed.value.regulatoryDrivers)
      : scaffold.regulatoryDrivers,
    deliverables,
    participantIds: [...participants].filter((id) => id !== 'lucia' && id !== 'alejandro'),
    provenance: 'ai-refined',
  };

  const issues = validateCharter(candidate);
  if (issues.length > 0) {
    return {
      charter: scaffold,
      applied: false,
      reason: `Refinamiento descartado: ${issues.map((issue) => issue.message).join(' ')}`,
    };
  }

  // A refined charter can still reorder dependencies into a cycle; catch it
  // by expanding the DAG before accepting the plan.
  const cycle = findTaskCycle(buildTasksFromCharter('validation', candidate));
  if (cycle.length > 0) {
    return {
      charter: scaffold,
      applied: false,
      reason: 'Refinamiento descartado: las dependencias propuestas forman un ciclo.',
    };
  }

  return { charter: candidate, applied: true };
};
