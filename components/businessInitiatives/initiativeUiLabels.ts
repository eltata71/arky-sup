/**
 * Spanish labels, tones and glyphs for business initiatives.
 *
 * Kept in one module for the same reason as `officeUiLabels`: two screens must
 * never call the same status by two different names.
 *
 * ## The palette is inherited, not re-chosen
 *
 * The five health buckets map onto the *same* validated slots the Office uses
 * (`officeChartTokens`), in the same order:
 *
 * | slot | Office             | Initiative          |
 * |------|--------------------|---------------------|
 * | 1    | Bloqueado          | En riesgo           |
 * | 2    | En ejecución       | En ejecución        |
 * | 3    | Requiere decisión  | Requiere decisión   |
 * | 4    | Entregado          | Beneficios logrados |
 * | —    | En preparación     | Borrador            |
 *
 * That is deliberate. An architect reading both boards learns one colour
 * language, and the palette's colour-blind separation — which depends on the
 * slot *order* — carries over unchanged. Do not restep or reorder these
 * without redoing the validation documented in `officeChartTokens`.
 */

import type { BadgeTone } from '../ui';
import {
  type LucideIcon,
  AlertTriangle,
  BadgeCheck,
  CalendarClock,
  CircleDashed,
  FileText,
  Flag,
  Gavel,
  Landmark,
  PauseCircle,
  PlayCircle,
  Rocket,
  Scale,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react';
import { OFFICE_HEALTH_VISUALS } from '../architectureOffice/officeChartTokens';
import type { OfficeHealthBucket } from '../../services/architectureOffice/domain/officePortfolio';
import type {
  InitiativeHealth,
  InitiativeDocumentKind,
  InitiativeHorizon,
  InitiativeMilestoneStatus,
  InitiativePriority,
  InitiativeRiskLevel,
  InitiativeStakeholderKind,
  InitiativeStatus,
} from '../../services/businessInitiatives/domain';

export const INITIATIVE_STATUS_LABELS: Readonly<Record<InitiativeStatus, string>> = Object.freeze({
  draft: 'Borrador',
  proposed: 'Propuesta',
  approved: 'Aprobada',
  'in-progress': 'En ejecución',
  'on-hold': 'En pausa',
  delivered: 'Entregada',
  realized: 'Beneficios logrados',
  cancelled: 'Cancelada',
});

export const INITIATIVE_STATUS_TONES: Readonly<Record<InitiativeStatus, BadgeTone>> = Object.freeze({
  draft: 'gray',
  proposed: 'warning',
  approved: 'info',
  'in-progress': 'primary',
  'on-hold': 'danger',
  delivered: 'success',
  realized: 'success',
  cancelled: 'gray',
});

export const INITIATIVE_STATUS_ICONS: Readonly<Record<InitiativeStatus, LucideIcon>> = Object.freeze({
  draft: CircleDashed,
  proposed: Gavel,
  approved: BadgeCheck,
  'in-progress': PlayCircle,
  'on-hold': PauseCircle,
  delivered: Flag,
  realized: TrendingUp,
  cancelled: PauseCircle,
});

/** What each status *means*, for the picker. Removes the guesswork at capture. */
export const INITIATIVE_STATUS_HINTS: Readonly<Record<InitiativeStatus, string>> = Object.freeze({
  draft: 'Se está describiendo. Todavía no se ha presentado a nadie.',
  proposed: 'Presentada al negocio, esperando aprobación.',
  approved: 'Aprobada y priorizada. Aún no ha empezado.',
  'in-progress': 'La arquitectura ya la está atendiendo.',
  'on-hold': 'Detenida por una decisión, una dependencia o falta de capacidad.',
  delivered: 'La solución está construida; los resultados aún se están midiendo.',
  realized: 'Los resultados esperados se midieron y se cumplieron.',
  cancelled: 'El negocio decidió no seguir adelante.',
});

/**
 * The health bucket reuses the Office visuals by mapping onto the equivalent
 * slot, so the two boards cannot drift apart.
 */
const HEALTH_TO_OFFICE_SLOT: Readonly<Record<InitiativeHealth, OfficeHealthBucket>> = Object.freeze({
  'at-risk': 'blocked',
  active: 'running',
  'awaiting-decision': 'awaiting-decision',
  realized: 'delivered',
  idle: 'idle',
});

export const INITIATIVE_HEALTH_LABELS: Readonly<Record<InitiativeHealth, string>> = Object.freeze({
  'at-risk': 'En riesgo',
  active: 'En ejecución',
  'awaiting-decision': 'Requiere decisión',
  realized: 'Beneficios logrados',
  idle: 'Borrador',
});

export const INITIATIVE_HEALTH_HINTS: Readonly<Record<InitiativeHealth, string>> = Object.freeze({
  'at-risk': 'Pasó su fecha objetivo, tiene un riesgo crítico o incumplió un hito.',
  active: 'La arquitectura la está atendiendo dentro de plazo.',
  'awaiting-decision': 'Espera una aprobación del negocio para avanzar.',
  realized: 'Entregada y con sus resultados medidos.',
  idle: 'Todavía se está describiendo.',
});

export const INITIATIVE_HEALTH_ICONS: Readonly<Record<InitiativeHealth, LucideIcon>> = Object.freeze({
  'at-risk': AlertTriangle,
  active: PlayCircle,
  'awaiting-decision': Gavel,
  realized: TrendingUp,
  idle: CircleDashed,
});

/** Fill / stroke / surface / ink classes, borrowed from the validated slots. */
export const initiativeHealthVisual = (health: InitiativeHealth) =>
  OFFICE_HEALTH_VISUALS[HEALTH_TO_OFFICE_SLOT[health]];

export const PRIORITY_LABELS: Readonly<Record<InitiativePriority, string>> = Object.freeze({
  critical: 'Crítica',
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
});

export const PRIORITY_TONES: Readonly<Record<InitiativePriority, BadgeTone>> = Object.freeze({
  critical: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'gray',
});

export const HORIZON_LABELS: Readonly<Record<InitiativeHorizon, string>> = Object.freeze({
  now: 'Ahora',
  next: 'Siguiente',
  later: 'Después',
});

export const HORIZON_HINTS: Readonly<Record<InitiativeHorizon, string>> = Object.freeze({
  now: 'En el periodo de planificación actual.',
  next: 'En el siguiente periodo.',
  later: 'En el horizonte, sin fecha comprometida.',
});

export const RISK_LEVEL_LABELS: Readonly<Record<InitiativeRiskLevel, string>> = Object.freeze({
  critical: 'Crítico',
  high: 'Alto',
  medium: 'Medio',
  low: 'Bajo',
});

export const RISK_LEVEL_TONES: Readonly<Record<InitiativeRiskLevel, BadgeTone>> = Object.freeze({
  critical: 'danger',
  high: 'danger',
  medium: 'warning',
  low: 'gray',
});

export const STAKEHOLDER_KIND_LABELS: Readonly<Record<InitiativeStakeholderKind, string>> = Object.freeze({
  sponsor: 'Patrocinador',
  'business-owner': 'Dueño de negocio',
  'architecture-lead': 'Líder de arquitectura',
  stakeholder: 'Interesado',
});

export const DOCUMENT_KIND_LABELS: Readonly<Record<InitiativeDocumentKind, string>> = Object.freeze({
  'business-case': 'Caso de negocio',
  requirement: 'Requerimiento',
  regulation: 'Normativa',
  analysis: 'Análisis',
  minutes: 'Acta de reunión',
  other: 'Otro',
});

export const MILESTONE_STATUS_LABELS: Readonly<Record<InitiativeMilestoneStatus, string>> = Object.freeze({
  pending: 'Pendiente',
  'at-risk': 'En riesgo',
  met: 'Cumplido',
  missed: 'Incumplido',
});

export const MILESTONE_STATUS_TONES: Readonly<Record<InitiativeMilestoneStatus, BadgeTone>> = Object.freeze({
  pending: 'gray',
  'at-risk': 'warning',
  met: 'success',
  missed: 'danger',
});

/** Section glyphs, so each area of the detail screen is recognisable by shape. */
export const INITIATIVE_SECTION_ICONS = Object.freeze({
  motivation: Landmark,
  outcomes: Target,
  indicators: TrendingUp,
  timeline: CalendarClock,
  risks: Scale,
  people: Users,
  documents: FileText,
  attentions: Rocket,
}) as Readonly<Record<
  'motivation' | 'outcomes' | 'indicators' | 'timeline' | 'risks' | 'people' | 'documents' | 'attentions',
  LucideIcon
>>;

/** `1500000` + `USD` → `USD 1.500.000`. Absent investment reads as a dash. */
export const formatInvestment = (
  amount: number | undefined,
  currency: string | undefined,
): string => {
  if (amount === undefined) return '—';
  const formatted = new Intl.NumberFormat('es', { maximumFractionDigits: 0 }).format(amount);
  return currency ? `${currency} ${formatted}` : formatted;
};

/** `2026-08-27` → `27 ago 2026`. Empty date reads as a dash, never as today. */
export const formatDate = (iso: string | undefined): string => {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('es', {
    day: 'numeric', month: 'short', year: 'numeric',
  }).format(parsed);
};

/** How a remaining-days count should read to a person. */
export const describeRemaining = (days: number | null): { text: string; overdue: boolean } | null => {
  if (days === null) return null;
  if (days < 0) return { text: `Vencida hace ${Math.abs(days)} día(s)`, overdue: true };
  if (days === 0) return { text: 'Vence hoy', overdue: true };
  return { text: `Faltan ${days} día(s)`, overdue: false };
};
