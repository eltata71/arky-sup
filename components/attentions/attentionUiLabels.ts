/**
 * Nombres, tonos y glifos del seguimiento de un proyecto de arquitectura.
 *
 * Un módulo aparte por la misma razón que `initiativeUiLabels`: dos pantallas
 * no pueden llamar de dos maneras distintas al mismo estado. Aquí eso importa
 * el doble, porque estas etiquetas se leen **junto a** las de la iniciativa —en
 * su sala, en la misma tarjeta— y un proyecto «Entregado» bajo una iniciativa
 * «Delivered» obligaría al lector a traducir dos vocabularios para el mismo
 * hecho.
 *
 * Los tonos son los mismos que ya usa el nivel de arriba para los mismos
 * significados: el verde es cumplido, el ámbar es en riesgo, el rojo es
 * incumplido. La paleta se hereda, no se vuelve a elegir.
 */

import type { BadgeTone } from '../ui';
import type {
  AttentionContributionState,
  AttentionHealth,
  AttentionMilestoneStatus,
  AttentionPriority,
  AttentionRiskLevel,
  AttentionStatus,
} from '../../services/architectureProjects';

export const ATTENTION_STATUS_LABELS: Readonly<Record<AttentionStatus, string>> = Object.freeze({
  discovery: 'Descubrimiento',
  design: 'Diseño',
  review: 'Revisión',
  delivered: 'Entregado',
  'on-hold': 'En pausa',
  cancelled: 'Cancelado',
});

export const ATTENTION_STATUS_TONES: Readonly<Record<AttentionStatus, BadgeTone>> = Object.freeze({
  discovery: 'gray',
  design: 'primary',
  review: 'info',
  delivered: 'success',
  'on-hold': 'warning',
  cancelled: 'danger',
});

export const ATTENTION_PRIORITY_LABELS: Readonly<Record<AttentionPriority, string>> = Object.freeze({
  critical: 'Crítica',
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
});

export const ATTENTION_MILESTONE_LABELS: Readonly<Record<AttentionMilestoneStatus, string>> = Object.freeze({
  pending: 'Pendiente',
  'at-risk': 'En riesgo',
  met: 'Cumplido',
  missed: 'Incumplido',
});

export const ATTENTION_MILESTONE_TONES: Readonly<Record<AttentionMilestoneStatus, BadgeTone>> = Object.freeze({
  pending: 'gray',
  'at-risk': 'warning',
  met: 'success',
  missed: 'danger',
});

export const ATTENTION_RISK_LABELS: Readonly<Record<AttentionRiskLevel, string>> = Object.freeze({
  low: 'Bajo',
  medium: 'Medio',
  high: 'Alto',
  critical: 'Crítico',
});

export const ATTENTION_RISK_TONES: Readonly<Record<AttentionRiskLevel, BadgeTone>> = Object.freeze({
  low: 'gray',
  medium: 'info',
  high: 'warning',
  critical: 'danger',
});

export const CONTRIBUTION_STATE_LABELS: Readonly<Record<AttentionContributionState, string>> = Object.freeze({
  planned: 'Planificado',
  'in-progress': 'En curso',
  delivered: 'Entregado',
  blocked: 'Bloqueado',
});

export const CONTRIBUTION_STATE_TONES: Readonly<Record<AttentionContributionState, BadgeTone>> = Object.freeze({
  planned: 'gray',
  'in-progress': 'primary',
  delivered: 'success',
  blocked: 'danger',
});

export const ATTENTION_HEALTH_LABELS: Readonly<Record<AttentionHealth, string>> = Object.freeze({
  'on-track': 'En rumbo',
  'at-risk': 'En riesgo',
  'off-track': 'Fuera de rumbo',
  closed: 'Cerrado',
  unknown: 'Sin seguimiento',
});

export const ATTENTION_HEALTH_TONES: Readonly<Record<AttentionHealth, BadgeTone>> = Object.freeze({
  'on-track': 'success',
  'at-risk': 'warning',
  'off-track': 'danger',
  closed: 'info',
  unknown: 'gray',
});

/**
 * Por qué el semáforo está donde está.
 *
 * El estado de salud se calcula, no se elige, así que la explicación tiene que
 * viajar con él: un rojo sin motivo es una alarma que nadie sabe cómo apagar.
 */
export const ATTENTION_HEALTH_HINTS: Readonly<Record<AttentionHealth, string>> = Object.freeze({
  'on-track': 'Sin hitos incumplidos, sin riesgos severos y dentro de fecha.',
  'at-risk': 'Hay un hito en riesgo o el proyecto está en pausa.',
  'off-track': 'Hay un hito incumplido, un riesgo severo o la fecha objetivo ya pasó.',
  closed: 'El proyecto está entregado o cancelado: ya no consume capacidad.',
  unknown: 'Nadie lo está midiendo todavía. Declara estado y fecha para poder reportarlo.',
});

/** `0.42` → `42 %`. `null` no es 0 %: es que nadie lo ha declarado. */
export const formatProgress = (value: number | null): string =>
  (value === null ? 'sin declarar' : `${Math.round(value * 100)} %`);
