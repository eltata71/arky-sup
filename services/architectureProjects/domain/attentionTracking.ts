/**
 * Lo que se puede afirmar sobre el avance de un proyecto de arquitectura.
 *
 * Todo aquí es una función pura sobre `ProjectAttentionTracking`. Vive junto al
 * agregado y no dentro de una pantalla por la misma razón que las invariantes:
 * «este proyecto está en riesgo» es una regla del dominio, y una regla que sólo
 * existe dentro de un componente no se puede comprobar sin renderizarlo, ni
 * reutilizar desde la iniciativa que lo hereda.
 *
 * Dos reglas gobiernan este fichero, y las dos son sobre honestidad:
 *
 * 1. **Lo no declarado no es cero.** `attentionProgress` devuelve `null`
 *    cuando nadie ha declarado avance y no hay hitos con los que deducirlo. Un
 *    0 % pintado sobre un proyecto que nadie ha medido informa de un equipo que
 *    no ha hecho nada, que es una afirmación distinta y falsa.
 * 2. **Lo derivado se distingue de lo declarado.** Cuando el avance sale de los
 *    hitos cumplidos, `source` lo dice, para que la pantalla no presente una
 *    estimación con la autoridad de un dato.
 */

import type {
  AttentionContribution,
  AttentionMilestone,
  AttentionMilestoneStatus,
  AttentionRisk,
  Project,
  ProjectAttentionTracking,
} from './ArchitectureProjectTypes';

/** El estado en que un proyecto ya no consume capacidad de entrega. */
export const CLOSED_ATTENTION_STATUSES: readonly ProjectAttentionTracking['status'][] = Object.freeze([
  'delivered',
  'cancelled',
]);

export const isClosedAttention = (status: ProjectAttentionTracking['status']): boolean =>
  CLOSED_ATTENTION_STATUSES.includes(status);

/** Riesgos que la iniciativa de arriba hereda: los que pueden pararla. */
export const SEVERE_ATTENTION_RISK_LEVELS: readonly AttentionRisk['level'][] = Object.freeze([
  'high',
  'critical',
]);

export interface AttentionProgress {
  /** 0..1. */
  value: number;
  /** `declared` lo escribió una persona; `milestones` lo dedujo este módulo. */
  source: 'declared' | 'milestones';
}

export interface AttentionMilestoneSummary {
  total: number;
  met: number;
  missed: number;
  atRisk: number;
  pending: number;
  /** El siguiente hito abierto, por fecha. */
  next?: AttentionMilestone;
}

export type AttentionHealth = 'on-track' | 'at-risk' | 'off-track' | 'closed' | 'unknown';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export const summarizeAttentionMilestones = (
  milestones: readonly AttentionMilestone[] = [],
): AttentionMilestoneSummary => {
  const count = (status: AttentionMilestoneStatus): number =>
    milestones.filter((milestone) => milestone.status === status).length;
  const next = [...milestones]
    .filter((milestone) => milestone.status !== 'met' && milestone.status !== 'missed')
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
  return {
    total: milestones.length,
    met: count('met'),
    missed: count('missed'),
    atRisk: count('at-risk'),
    pending: count('pending'),
    next,
  };
};

/**
 * Cuánto ha avanzado el proyecto, y de dónde sale ese número.
 *
 * El avance declarado manda: lo escribió quien responde por el proyecto. Sólo
 * cuando no lo hay se deduce de los hitos, que es una aproximación razonable
 * —cumplidos sobre totales— y se marca como tal.
 */
export const attentionProgress = (
  tracking: ProjectAttentionTracking | undefined,
): AttentionProgress | null => {
  if (!tracking) return null;
  if (typeof tracking.progress === 'number' && Number.isFinite(tracking.progress)) {
    return { value: clamp01(tracking.progress / 100), source: 'declared' };
  }
  const milestones = tracking.milestones ?? [];
  if (milestones.length === 0) return null;
  const { met, total } = summarizeAttentionMilestones(milestones);
  return { value: clamp01(met / total), source: 'milestones' };
};

/** Riesgos abiertos del proyecto, y cuántos de ellos son severos. */
export const summarizeAttentionRisks = (
  tracking: ProjectAttentionTracking | undefined,
): { total: number; severe: number } => {
  const risks = tracking?.risks ?? [];
  return {
    total: risks.length,
    severe: risks.filter((risk) => SEVERE_ATTENTION_RISK_LEVELS.includes(risk.level)).length,
  };
};

/**
 * El semáforo del proyecto, deducido de lo que hay — nunca escrito a mano.
 *
 * Un estado de salud que se elige en un desplegable es una opinión con aspecto
 * de medición, y siempre está en verde. Este se calcula: un hito incumplido, un
 * riesgo severo o una fecha objetivo pasada sacan al proyecto de «en rumbo».
 * `unknown` existe porque un proyecto sin seguimiento no está en rumbo: es que
 * nadie lo está midiendo, y decirlo es el primer paso para que alguien lo haga.
 */
export const attentionHealth = (
  tracking: ProjectAttentionTracking | undefined,
  now: number = Date.now(),
): AttentionHealth => {
  if (!tracking) return 'unknown';
  if (isClosedAttention(tracking.status)) return 'closed';

  const { missed, atRisk } = summarizeAttentionMilestones(tracking.milestones);
  const { severe } = summarizeAttentionRisks(tracking);
  const overdue = Boolean(
    tracking.targetEndDate
    && !Number.isNaN(Date.parse(tracking.targetEndDate))
    && Date.parse(tracking.targetEndDate) < now,
  );

  if (missed > 0 || severe > 0 || overdue) return 'off-track';
  if (atRisk > 0 || tracking.status === 'on-hold') return 'at-risk';
  return 'on-track';
};

/** Días hasta la fecha objetivo. Negativo si ya pasó, `null` si no hay fecha. */
export const attentionDaysRemaining = (
  tracking: ProjectAttentionTracking | undefined,
  now: number = Date.now(),
): number | null => {
  const target = tracking?.targetEndDate;
  if (!target) return null;
  const parsed = Date.parse(target);
  if (Number.isNaN(parsed)) return null;
  return Math.ceil((parsed - now) / 86_400_000);
};

/** Lo que este proyecto declara mover en una iniciativa concreta. */
export const contributionsToInitiative = (
  project: Project,
  initiativeId: string,
): AttentionContribution[] =>
  (project.attention?.contributions ?? []).filter((entry) => entry.initiativeId === initiativeId);

/**
 * El parte que este proyecto entrega a una de sus iniciativas.
 *
 * Es un **puerto**, no un tipo compartido: `services/businessInitiatives`
 * declara por su cuenta la forma que necesita de un contribuyente y consolida
 * sobre ella, sin importar nada de este módulo. Así la iniciativa no depende de
 * cómo esté modelado un proyecto, y este módulo no tiene que conocer los KPIs
 * de arriba. Si las dos formas se separan, el punto de composición —el hook que
 * las junta— deja de compilar, que es exactamente donde debe verse.
 */
export interface AttentionDeliveryReport {
  projectId: string;
  name: string;
  status: ProjectAttentionTracking['status'];
  /** 0..1 o `null` cuando nadie lo ha declarado ni se puede deducir. */
  progress: number | null;
  progressSource: 'declared' | 'milestones' | 'none';
  health: AttentionHealth;
  contributions: readonly AttentionContribution[];
  risks: { total: number; severe: number };
  milestones: AttentionMilestoneSummary;
  architectureLead?: string;
  targetEndDate?: string;
}

export const describeAttentionDelivery = (
  project: Project,
  initiativeId: string,
  now: number = Date.now(),
): AttentionDeliveryReport => {
  const tracking = project.attention;
  const progress = attentionProgress(tracking);
  return {
    projectId: project.id,
    name: project.name,
    status: tracking?.status ?? 'discovery',
    progress: progress?.value ?? null,
    progressSource: progress?.source ?? 'none',
    health: attentionHealth(tracking, now),
    contributions: contributionsToInitiative(project, initiativeId),
    risks: summarizeAttentionRisks(tracking),
    milestones: summarizeAttentionMilestones(tracking?.milestones),
    architectureLead: tracking?.architectureLead,
    targetEndDate: tracking?.targetEndDate,
  };
};
