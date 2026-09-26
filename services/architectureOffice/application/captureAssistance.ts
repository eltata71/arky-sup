/**
 * Qué se le pregunta al arquitecto agente cuando alguien pulsa «ayúdame a
 * completar esto», y con qué contexto.
 *
 * Es la mitad de dominio de la captura asistida. La otra mitad —cómo se le
 * habla a un modelo y cómo se desconfía de lo que devuelve— vive en
 * `services/ai/generation/capture`. La separación es la que ya usa el resto del
 * repositorio: el dominio compone la instrucción, la infraestructura la
 * ejecuta, y la pantalla no conoce ninguna de las dos.
 *
 * Tres reglas que este fichero existe para que se cumplan siempre:
 *
 * 1. **El contexto viaja completo hacia arriba.** Una atención preguntada sin
 *    su iniciativa pierde la razón por la que existe, exactamente igual que en
 *    la coordinación del equipo. Aquí se arma la ascendencia una sola vez.
 * 2. **Lo vacío no viaja.** Un `Driver: ` en blanco le dice a un modelo que
 *    alguien consideró el driver y decidió dejarlo vacío, que no es lo que
 *    significa.
 * 3. **Responde el agente configurado, no un modelo anónimo.** El briefing se
 *    compone del perfil resuelto de Arky —con las habilidades, el conocimiento
 *    y la memoria que el usuario le haya añadido en su ficha— más los
 *    estándares de la Oficina. Personalizar la ficha y que la ayuda de un
 *    formulario siguiera respondiendo igual sería una configuración decorativa.
 */

import { type CaptureContext, type CaptureContextLine, type CaptureFieldId, type CaptureLevel, type CaptureSuggestionRequest, captureField, captureFieldsForLevel } from '../../../lib/capture';
import type { Project } from '../../architectureProjects';
import type { BusinessInitiative } from '../../businessInitiatives';
import { getOfficeArchitectureContext } from '../domain/officeArchitectureKnowledge';
import type { OfficeAgentId } from '../domain/officeAgentPersonas';
import {
  buildAgentProfileBriefing,
  resolveAgentProfile,
  type OfficeAgentProfile,
  type OfficeAgentProfileOverride,
} from '../domain/officeAgentProfile';
import { initiativeDisplayName } from './assistantConsultation';

/**
 * Quién asiste la captura.
 *
 * Arky, el generalista: la ficha de una iniciativa no es una pregunta de un
 * dominio concreto, y convocar a Sofía o a Felipe para redactar un objetivo de
 * negocio sería enrutar por enrutar. Cuando la pregunta *sí* es de dominio, el
 * usuario tiene el equipo completo a un clic en el asistente.
 */
export const CAPTURE_AGENT_ID: OfficeAgentId = 'arky';

const line = (label: string, value: string | undefined | null): CaptureContextLine | null => {
  const trimmed = (value ?? '').trim();
  return trimmed ? { label, value: trimmed } : null;
};

const compact = (entries: (CaptureContextLine | null)[]): CaptureContextLine[] =>
  entries.filter((entry): entry is CaptureContextLine => entry !== null);

const joined = (values: readonly string[] | undefined): string | undefined =>
  values && values.length > 0 ? values.join('; ') : undefined;

/**
 * Lo que una pantalla de iniciativa sabe mientras se rellena.
 *
 * Deliberadamente parcial: en la creación sólo existe lo que se ha tecleado
 * hasta ahora, y el asistente tiene que poder ayudar con eso. `subjectFor`
 * mapea el agregado completo cuando estamos en mantenimiento.
 */
export interface InitiativeCaptureSubject {
  code?: string;
  title?: string;
  need?: string;
  driver?: string;
  objectives?: string[];
  outcomes?: string[];
  kpis?: string[];
  risks?: string[];
  milestones?: string[];
  stakeholders?: string[];
  priority?: string;
  horizon?: string;
}

export const captureContextForInitiative = (subject: InitiativeCaptureSubject): CaptureContext => ({
  level: 'initiative',
  subject: subject.code && subject.title ? `${subject.code} · ${subject.title}` : (subject.title ?? ''),
  known: compact([
    line('Necesidad del negocio', subject.need),
    line('Driver', subject.driver),
    line('Objetivos', joined(subject.objectives)),
    line('Resultados esperados', joined(subject.outcomes)),
    line('Indicadores', joined(subject.kpis)),
    line('Riesgos', joined(subject.risks)),
    line('Hitos', joined(subject.milestones)),
    line('Personas implicadas', joined(subject.stakeholders)),
    line('Prioridad', subject.priority),
    line('Horizonte', subject.horizon),
  ]),
  ancestry: [],
});

/** El agregado completo, mapeado al sujeto de captura. Un solo sitio lo hace. */
export const initiativeCaptureSubject = (initiative: BusinessInitiative): InitiativeCaptureSubject => ({
  code: initiative.code || undefined,
  title: initiative.title,
  need: initiative.need,
  driver: initiative.driver,
  objectives: initiative.objectives,
  outcomes: initiative.expectedOutcomes.map((outcome) => outcome.statement),
  kpis: initiative.kpis.map((kpi) => `${kpi.name} (${kpi.unit})`),
  risks: initiative.risks.map((risk) => risk.description),
  milestones: initiative.milestones.map((milestone) => milestone.name),
  stakeholders: initiative.stakeholders.map((stakeholder) => stakeholder.role || stakeholder.name),
  priority: initiative.priority,
  horizon: initiative.horizon,
});

/** La ascendencia de una atención: las iniciativas a las que responde. */
const initiativeAncestry = (
  initiatives: readonly BusinessInitiative[],
): CaptureContextLine[] => initiatives.map((initiative) => ({
  label: `Iniciativa de negocio · ${initiativeDisplayName(initiative)}`,
  value: [initiative.need, initiative.driver].filter(Boolean).join(' — ') || initiative.title,
}));

export interface AttentionCaptureSubject {
  name?: string;
  description?: string;
  context?: string[];
  artifacts?: string[];
}

export const captureContextForAttention = (
  subject: AttentionCaptureSubject,
  parents: readonly BusinessInitiative[],
): CaptureContext => ({
  level: 'attention',
  subject: subject.name ?? '',
  known: compact([
    line('Descripción', subject.description),
    line('Contexto capturado', joined(subject.context)),
    line('Artefactos existentes', joined(subject.artifacts)),
  ]),
  ancestry: initiativeAncestry(parents),
});

/** Un proyecto guardado, mapeado al sujeto de captura. */
export const attentionCaptureSubject = (project: Project): AttentionCaptureSubject => ({
  name: project.name,
  description: project.description,
  context: project.projectContext,
  artifacts: [...new Set(project.artifacts.map((artifact) => artifact.name))],
});

export interface DeliverableCaptureSubject {
  title?: string;
  brief?: string;
}

export const captureContextForDeliverable = (
  subject: DeliverableCaptureSubject,
  attention: { name?: string; description?: string; context?: string[] } | undefined,
  parents: readonly BusinessInitiative[],
): CaptureContext => ({
  level: 'deliverable',
  subject: subject.title ?? '',
  known: compact([
    line('Brief', subject.brief),
  ]),
  ancestry: [
    ...initiativeAncestry(parents),
    ...compact([
      attention?.name
        ? {
          label: `Proyecto de arquitectura · ${attention.name}`,
          value: [attention.description, joined(attention.context)].filter(Boolean).join(' — ') || attention.name,
        }
        : null,
    ]),
  ],
});

export interface BuildCaptureRequestInput {
  /** Un campo cuando el usuario pulsa el botón de un campo; varios para el del formulario. */
  fieldIds: readonly CaptureFieldId[];
  context: CaptureContext;
  /** La ficha guardada del agente asistente, si el usuario la ha configurado. */
  agentOverride?: OfficeAgentProfileOverride;
  /** Lo que ya está escrito y el usuario quiere mejorar. */
  current?: Partial<Record<CaptureFieldId, string>>;
}

/**
 * Compone la petición completa: el agente que responde, lo que se le pide y lo
 * que sabe.
 *
 * Es una función pura y ése es el punto: la política de qué se le cuenta al
 * modelo se puede probar sin renderizar nada ni llamar a nadie.
 */
export const buildCaptureRequest = (input: BuildCaptureRequestInput): CaptureSuggestionRequest => {
  const profile = resolveAgentProfile(CAPTURE_AGENT_ID, input.agentOverride);
  const architecture = getOfficeArchitectureContext();
  return {
    level: input.context.level,
    fields: input.fieldIds.map(captureField),
    context: input.context,
    agentBriefing: [
      ...buildAgentProfileBriefing(profile),
      '',
      `Estándares de la Oficina de Arquitectura (v${architecture.version}) que enmarcan cualquier propuesta:`,
      ...architecture.promptContext.map((entry) => `- ${entry}`),
    ],
    current: input.current,
    modelTier: profile.modelTier,
  };
};

/**
 * Los campos que el botón de formulario ofrece en un nivel, sin los que ya
 * están completos.
 *
 * Rellenar de nuevo lo que la persona acaba de escribir es la forma más rápida
 * de que deje de pulsar el botón: la asistencia general es para lo que falta.
 */
export const pendingCaptureFields = (
  level: CaptureLevel,
  filled: readonly CaptureFieldId[],
): CaptureFieldId[] => captureFieldsForLevel(level)
  .map((spec) => spec.id)
  .filter((id) => !filled.includes(id));

const has = (value: string | undefined): boolean => Boolean(value && value.trim());
const hasAny = (values: readonly string[] | undefined): boolean => Boolean(values && values.length > 0);

/**
 * Qué le falta a una iniciativa, mirando el sujeto de captura y no el agregado.
 *
 * Vive aquí y no en la pantalla porque la creación y el mantenimiento tienen
 * que estar de acuerdo en qué significa «completo»: si la sala y el diálogo
 * cuentan distinto, el mismo registro sale con dos cifras de completitud según
 * desde dónde se mire.
 */
export const pendingFieldsForInitiative = (subject: InitiativeCaptureSubject): CaptureFieldId[] => {
  const filled: CaptureFieldId[] = [];
  if (has(subject.title)) filled.push('initiative.title');
  if (has(subject.need)) filled.push('initiative.need');
  if (has(subject.driver)) filled.push('initiative.driver');
  if (hasAny(subject.objectives)) filled.push('initiative.objectives');
  if (hasAny(subject.outcomes)) filled.push('initiative.outcomes');
  if (hasAny(subject.kpis)) filled.push('initiative.kpis');
  if (hasAny(subject.risks)) filled.push('initiative.risks');
  if (hasAny(subject.milestones)) filled.push('initiative.milestones');
  if (hasAny(subject.stakeholders)) filled.push('initiative.stakeholders');
  return pendingCaptureFields('initiative', filled);
};

export const pendingFieldsForAttention = (subject: AttentionCaptureSubject): CaptureFieldId[] => {
  const filled: CaptureFieldId[] = [];
  if (has(subject.name)) filled.push('attention.name');
  if (has(subject.description)) filled.push('attention.description');
  if (hasAny(subject.context)) filled.push('attention.context');
  return pendingCaptureFields('attention', filled);
};

export const pendingFieldsForDeliverable = (subject: DeliverableCaptureSubject): CaptureFieldId[] => {
  const filled: CaptureFieldId[] = [];
  if (has(subject.title)) filled.push('deliverable.title');
  if (has(subject.brief)) filled.push('deliverable.brief');
  return pendingCaptureFields('deliverable', filled);
};

export type { OfficeAgentProfile };
