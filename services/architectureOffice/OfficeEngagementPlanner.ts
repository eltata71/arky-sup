/**
 * Turns a business brief into an engagement charter and its task DAG.
 *
 * Two layers, in this order:
 *
 *  1. **Deterministic scaffold** — signals in the brief select architectural
 *     views, views select deliverables from `ARTIFACT_TEMPLATES`, and
 *     `OfficeAgentRouter` assigns a producer and a distinct reviewer to each.
 *     This alone yields a runnable charter, so an unavailable model degrades
 *     the plan's *quality*, never its *existence*.
 *
 *  2. **Optional AI refinement** — the model may reorder, drop, add
 *     acceptance criteria and adjust dependencies. It may **not** invent a
 *     template outside the catalogue, nor assign a persona that does not
 *     declare the artifact type. Every refinement is re-validated against the
 *     same invariants as the scaffold; a refinement that breaks one is
 *     discarded and the deterministic charter stands.
 */

import { ARTIFACT_TEMPLATES } from '../../constants';
import type { ArtifactTemplate } from '../../types';
import { parseStructured } from '../ai/structuredOutput';
import { assignDeliverable, rankPersonasForBrief } from './OfficeAgentRouter';
import { OFFICE_AGENT_PERSONAS, type OfficeAgentId } from './officeAgentPersonas';
import { listAgents } from './agentRegistry';
import { getOfficeArchitectureContext } from './officeArchitectureKnowledge';
import { foldOfficeText } from './officeShared';
import { newOfficeTaskId } from './OfficeEngagementRepository';
import {
  findTaskCycle,
  type OfficeCharter,
  type OfficeCharterDeliverable,
  type OfficeEngagementKind,
  type OfficeTask,
} from './OfficeTypes';

// ---------------------------------------------------------------------------
// Deterministic scaffold
// ---------------------------------------------------------------------------

interface KindSignal {
  kind: OfficeEngagementKind;
  pattern: RegExp;
}

const KIND_SIGNALS: readonly KindSignal[] = Object.freeze([
  { kind: 'modernization', pattern: /\b(moderniz|migrar|migraci|legacy|as.?400|mainframe|reemplaz)\b/ },
  { kind: 'integration', pattern: /\b(integr|api|apis|interfaz|interfaces|mulesoft|middleware|sincroniz)\b/ },
  { kind: 'compliance-review', pattern: /\b(cumplimiento|compliance|regulator|auditor|solvencia|hipaa|dora|iso 27001)\b/ },
  { kind: 'assessment', pattern: /\b(evalua|diagnostic|assessment|revisi[oó]n de arquitectura|analisis de|as.is)\b/ },
]);

export const inferEngagementKind = (brief: string): OfficeEngagementKind => {
  const normalized = foldOfficeText(brief);
  for (const signal of KIND_SIGNALS) {
    if (signal.pattern.test(normalized)) return signal.kind;
  }
  return 'new-solution';
};

/**
 * The deliverable backbone every engagement carries, whatever its domain.
 * Named by template so the set stays anchored to the real catalogue.
 */
const CORE_TEMPLATE_NAMES: Readonly<Record<OfficeEngagementKind, readonly string[]>> = Object.freeze({
  'new-solution': ['Visión de la Arquitectura', 'Diagrama de Contexto (C4-N1)', 'Diagrama de Contenedores (C4-N2)'],
  modernization: ['Visión de la Arquitectura', 'Diagrama de Contexto (C4-N1)', 'Diagrama de Contenedores (C4-N2)'],
  integration: ['Visión de la Arquitectura', 'Diagrama de Contexto (C4-N1)'],
  assessment: ['Visión de la Arquitectura', 'Diagrama de Contexto (C4-N1)'],
  'compliance-review': ['Visión de la Arquitectura', 'Informe de Revisión de Arquitectura'],
});

/** Extra deliverables pulled in when a domain signal fires. */
interface TemplateSignal {
  templateName: string;
  pattern: RegExp;
}

const TEMPLATE_SIGNALS: readonly TemplateSignal[] = Object.freeze([
  { templateName: 'Modelo de Dominio (ERD)', pattern: /\b(dato|datos|erd|entidad|entidades|modelo de datos|base de datos)\b/ },
  { templateName: 'Diagrama de Secuencia', pattern: /\b(flujo|flujos|secuencia|interacci|orquestaci|proceso de negocio)\b/ },
  { templateName: 'Diagrama de Despliegue (C4-N4)', pattern: /\b(despliegue|deployment|infraestructura|entorno|entornos|kubernetes|aws)\b/ },
  { templateName: 'Diagrama de Componentes (C4-N3)', pattern: /\b(componente|componentes|modulo|modulos|interno)\b/ },
]);

const templateByName = new Map(ARTIFACT_TEMPLATES.map((template) => [template.name, template]));

/** Templates whose name matches, tolerant to accents and case. */
const findTemplate = (name: string): ArtifactTemplate | undefined => {
  const exact = templateByName.get(name);
  if (exact) return exact;
  const folded = foldOfficeText(name);
  return ARTIFACT_TEMPLATES.find((template) => foldOfficeText(template.name) === folded);
};

const PHASE_ORDER = new Map<string, number>([
  ['Fase 1: Estratégica y de Visión de Negocio', 1],
  ['Fase 2: Diseño Conceptual y Lógico', 2],
  ['Fase 3: Diseño Físico y Tecnológico', 3],
  ['Fase 4: Implementación y Operaciones', 4],
  ['SDD: Especificación', 2],
  ['General', 3],
]);

const phaseRank = (template: ArtifactTemplate): number => PHASE_ORDER.get(template.phase) ?? 3;

export interface PlanEngagementInput {
  brief: string;
  title: string;
  /** Hard cap on deliverables so a vague brief cannot fan out unboundedly. */
  maxDeliverables?: number;
}

const DEFAULT_MAX_DELIVERABLES = 8;

/**
 * Builds the charter without any AI call. Deterministic and total: any brief
 * yields at least the core backbone.
 */
export const planCharterDeterministic = (input: PlanEngagementInput): OfficeCharter => {
  const normalized = foldOfficeText(input.brief);
  const kind = inferEngagementKind(input.brief);
  const maxDeliverables = Math.max(1, input.maxDeliverables ?? DEFAULT_MAX_DELIVERABLES);

  const names = new Set<string>(CORE_TEMPLATE_NAMES[kind]);
  for (const signal of TEMPLATE_SIGNALS) {
    if (names.size >= maxDeliverables) break;
    if (signal.pattern.test(normalized)) names.add(signal.templateName);
  }

  const templates = [...names]
    .map(findTemplate)
    .filter((template): template is ArtifactTemplate => template !== undefined)
    .sort((a, b) => phaseRank(a) - phaseRank(b) || a.name.localeCompare(b.name))
    .slice(0, maxDeliverables);

  const participants = new Set<OfficeAgentId>(
    rankPersonasForBrief(input.brief).slice(0, 4).map((signal) => signal.personaId),
  );

  const deliverables: OfficeCharterDeliverable[] = [];
  let previousName: string | null = null;
  for (const template of templates) {
    const assignment = assignDeliverable(template.type, input.brief, { preferredIds: [...participants] });
    if (!assignment) continue;
    participants.add(assignment.assigneeId);
    participants.add(assignment.reviewerId);
    deliverables.push({
      templateName: template.name,
      artifactType: template.type,
      assigneeId: assignment.assigneeId,
      reviewerId: assignment.reviewerId,
      rationale: assignment.rationale,
      // Chain by phase order: later-phase deliverables build on earlier ones,
      // which is also what gives the runner something meaningful to schedule.
      dependsOnTemplateNames: previousName ? [previousName] : [],
    });
    previousName = template.name;
  }

  const regulatoryDrivers = getOfficeArchitectureContext().standards
    .filter((standard) => standard.domain === 'insurance')
    .map((standard) => standard.id);

  return {
    kind,
    objectives: [input.title.trim() || 'Entregable de arquitectura'],
    scope: deliverables.map((deliverable) => deliverable.templateName),
    outOfScope: [],
    constraints: [],
    regulatoryDrivers,
    deliverables,
    participantIds: [...participants].filter((id) => id !== 'lucia' && id !== 'alejandro'),
    coordinatorId: 'lucia',
    consolidatorId: 'alejandro',
    provenance: 'deterministic',
    proposedAt: new Date().toISOString(),
  };
};

// ---------------------------------------------------------------------------
// Charter → task DAG
// ---------------------------------------------------------------------------

export interface BuildTasksOptions {
  /** Review passes allowed per deliverable before the task fails. */
  maxAttempts?: number;
  /** Hours from now used to stamp `dueAt` on each task. */
  slaHours?: number;
}

/**
 * Expands a charter into the executable DAG: one production task per
 * deliverable, one review task after it, and a final consolidation for
 * Alejandro that depends on every review.
 */
export const buildTasksFromCharter = (
  engagementId: string,
  charter: OfficeCharter,
  options: BuildTasksOptions = {},
): OfficeTask[] => {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 2);
  const slaHours = Math.max(1, options.slaHours ?? 48);
  const dueAt = new Date(Date.now() + slaHours * 3_600_000).toISOString();
  const createdAt = new Date().toISOString();

  const productionIdByTemplate = new Map<string, string>();
  const tasks: OfficeTask[] = [];

  // Pass 1 — mint ids so dependencies can reference tasks declared later.
  for (const deliverable of charter.deliverables) {
    productionIdByTemplate.set(deliverable.templateName, newOfficeTaskId());
  }

  const reviewTaskIds: string[] = [];

  for (const deliverable of charter.deliverables) {
    const productionId = productionIdByTemplate.get(deliverable.templateName)!;
    const reviewId = newOfficeTaskId();
    reviewTaskIds.push(reviewId);

    const dependsOn = deliverable.dependsOnTemplateNames
      // A deliverable depends on the *review* of its predecessor, not just its
      // production — otherwise downstream work builds on unreviewed output.
      .map((name) => {
        const upstreamProductionId = productionIdByTemplate.get(name);
        if (!upstreamProductionId) return null;
        return `review-of:${upstreamProductionId}`;
      })
      .filter((value): value is string => value !== null);

    tasks.push({
      id: productionId,
      engagementId,
      createdAt,
      kind: 'produce-artifact',
      title: deliverable.templateName,
      objective: deliverable.rationale,
      assigneeId: deliverable.assigneeId,
      reviewerId: deliverable.reviewerId,
      dependsOn,
      artifactTemplateName: deliverable.templateName,
      targetArtifactType: deliverable.artifactType,
      acceptanceCriteria: buildAcceptanceCriteria(deliverable),
      status: dependsOn.length === 0 ? 'ready' : 'pending',
      attempts: 0,
      maxAttempts,
      dueAt,
    });

    tasks.push({
      id: reviewId,
      engagementId,
      createdAt,
      kind: 'review-artifact',
      title: `Revisión — ${deliverable.templateName}`,
      objective: `Revisar ${deliverable.templateName} contra su contrato, los estándares de la Oficina y los criterios de aceptación.`,
      assigneeId: deliverable.reviewerId,
      dependsOn: [productionId],
      reviewsTaskId: productionId,
      targetArtifactType: deliverable.artifactType,
      acceptanceCriteria: buildAcceptanceCriteria(deliverable),
      status: 'pending',
      attempts: 0,
      maxAttempts: 1,
      dueAt,
    });
  }

  // Resolve the `review-of:` placeholders now that every review id exists.
  const reviewIdByProductionId = new Map(
    tasks
      .filter((task) => task.kind === 'review-artifact' && task.reviewsTaskId)
      .map((task) => [task.reviewsTaskId!, task.id]),
  );
  for (const task of tasks) {
    task.dependsOn = task.dependsOn.map((dependency) => {
      if (!dependency.startsWith('review-of:')) return dependency;
      const productionId = dependency.slice('review-of:'.length);
      return reviewIdByProductionId.get(productionId) ?? productionId;
    });
    if (task.kind === 'produce-artifact') {
      task.status = task.dependsOn.length === 0 ? 'ready' : 'pending';
    }
  }

  if (reviewTaskIds.length > 0) {
    tasks.push({
      id: newOfficeTaskId(),
      engagementId,
      createdAt,
      kind: 'consolidate',
      title: 'Consolidación de la Oficina',
      objective: 'Comparar los entregables entre dominios, resolver contradicciones y emitir una recomendación con evidencia.',
      assigneeId: charter.consolidatorId,
      dependsOn: [...reviewTaskIds],
      acceptanceCriteria: [
        'La recomendación cita entregables concretos como evidencia.',
        'Las contradicciones entre dominios quedan resueltas o escaladas con dueño.',
        'El veredicto es Ready, Conditional o Blocked y está justificado.',
      ],
      status: 'pending',
      attempts: 0,
      maxAttempts: 1,
      dueAt,
    });
  }

  return tasks;
};

const buildAcceptanceCriteria = (deliverable: OfficeCharterDeliverable): string[] => {
  const persona = OFFICE_AGENT_PERSONAS[deliverable.assigneeId];
  return [
    `Resultado alineado con el rol ${persona.role}.`,
    'Supuestos, riesgos y decisiones quedan explícitos.',
    'Toda afirmación de calidad se acompaña de evidencia o se marca como pendiente.',
    ...persona.standardIds.map((standardId) => `Cumple el estándar ${standardId}.`),
  ];
};

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

export interface CharterValidationIssue {
  code:
    | 'unknown-template'
    | 'persona-cannot-produce'
    | 'reviewer-equals-assignee'
    | 'unknown-dependency'
    | 'empty-charter';
  message: string;
}

/**
 * The gate every charter must clear — deterministic or AI-refined alike.
 * A refinement that fails here is discarded, never "fixed up" silently.
 */
export const validateCharter = (charter: OfficeCharter): CharterValidationIssue[] => {
  const issues: CharterValidationIssue[] = [];
  if (charter.deliverables.length === 0) {
    issues.push({ code: 'empty-charter', message: 'El charter no propone ningún entregable.' });
    return issues;
  }

  const names = new Set(charter.deliverables.map((deliverable) => deliverable.templateName));

  for (const deliverable of charter.deliverables) {
    const template = findTemplate(deliverable.templateName);
    if (!template) {
      issues.push({
        code: 'unknown-template',
        message: `"${deliverable.templateName}" no existe en el catálogo de plantillas.`,
      });
      continue;
    }
    const persona = OFFICE_AGENT_PERSONAS[deliverable.assigneeId];
    if (!persona || !persona.producesArtifactTypes.includes(template.type)) {
      issues.push({
        code: 'persona-cannot-produce',
        message: `${deliverable.assigneeId} no declara ${template.type} entre los artefactos que produce.`,
      });
    }
    if (deliverable.reviewerId === deliverable.assigneeId) {
      issues.push({
        code: 'reviewer-equals-assignee',
        message: `"${deliverable.templateName}" tiene el mismo productor y revisor (${deliverable.assigneeId}).`,
      });
    }
    for (const dependency of deliverable.dependsOnTemplateNames) {
      if (!names.has(dependency)) {
        issues.push({
          code: 'unknown-dependency',
          message: `"${deliverable.templateName}" depende de "${dependency}", que no forma parte del charter.`,
        });
      }
    }
  }

  return issues;
};

// ---------------------------------------------------------------------------
// AI refinement
// ---------------------------------------------------------------------------

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
): { charter: OfficeCharter; applied: boolean; reason?: string } => {
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
    outOfScope: asStringArray(parsed.value.outOfScope),
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
