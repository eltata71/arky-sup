/**
 * Spanish labels and design-system tones for Architecture Office status values.
 *
 * Kept in one module so the console, the engagement room and the project hub
 * never drift into calling the same status by two different names.
 */

import type { BadgeTone } from '../ui';
import type {
  OfficeEngagementKind,
  OfficeEngagementStatus,
  OfficeFindingSeverity,
  OfficeReviewVerdict,
  OfficeTaskKind,
  OfficeTaskStatus,
} from '../../services/architectureOffice/domain/OfficeTypes';
import type { OfficeQualityGateStatus } from '../../services/architectureOffice/domain/officeQualityGates';

export const ENGAGEMENT_STATUS_LABELS: Readonly<Record<OfficeEngagementStatus, string>> = Object.freeze({
  intake: 'Recepción',
  planning: 'Planificando',
  'awaiting-charter': 'Charter por aprobar',
  'in-progress': 'En ejecución',
  'awaiting-arb': 'En comité',
  delivered: 'Entregado',
  blocked: 'Bloqueado',
  cancelled: 'Cancelado',
});

export const ENGAGEMENT_STATUS_TONES: Readonly<Record<OfficeEngagementStatus, BadgeTone>> = Object.freeze({
  intake: 'gray',
  planning: 'info',
  'awaiting-charter': 'warning',
  'in-progress': 'primary',
  'awaiting-arb': 'ai',
  delivered: 'success',
  blocked: 'danger',
  cancelled: 'gray',
});

export const ENGAGEMENT_KIND_LABELS: Readonly<Record<OfficeEngagementKind, string>> = Object.freeze({
  'new-solution': 'Nueva solución',
  modernization: 'Modernización',
  integration: 'Integración',
  assessment: 'Diagnóstico',
  'compliance-review': 'Revisión de cumplimiento',
});

export const TASK_STATUS_LABELS: Readonly<Record<OfficeTaskStatus, string>> = Object.freeze({
  pending: 'En espera',
  ready: 'Lista',
  'in-progress': 'En curso',
  'awaiting-review': 'Por revisar',
  'changes-requested': 'Cambios pedidos',
  completed: 'Completada',
  failed: 'Fallida',
  skipped: 'Omitida',
  cancelled: 'Cancelada',
});

export const TASK_STATUS_TONES: Readonly<Record<OfficeTaskStatus, BadgeTone>> = Object.freeze({
  pending: 'gray',
  ready: 'info',
  'in-progress': 'primary',
  'awaiting-review': 'ai',
  'changes-requested': 'warning',
  completed: 'success',
  failed: 'danger',
  skipped: 'gray',
  cancelled: 'gray',
});

export const TASK_KIND_LABELS: Readonly<Record<OfficeTaskKind, string>> = Object.freeze({
  'produce-artifact': 'Producción',
  'review-artifact': 'Revisión',
  consolidate: 'Consolidación',
  report: 'Reporte',
});

export const REVIEW_VERDICT_LABELS: Readonly<Record<OfficeReviewVerdict, string>> = Object.freeze({
  approved: 'Aprobado',
  'changes-requested': 'Cambios solicitados',
  rejected: 'Rechazado',
});

export const REVIEW_VERDICT_TONES: Readonly<Record<OfficeReviewVerdict, BadgeTone>> = Object.freeze({
  approved: 'success',
  'changes-requested': 'warning',
  rejected: 'danger',
});

export const SEVERITY_LABELS: Readonly<Record<OfficeFindingSeverity, string>> = Object.freeze({
  critical: 'Crítico',
  high: 'Alto',
  medium: 'Medio',
  low: 'Bajo',
});

export const SEVERITY_TONES: Readonly<Record<OfficeFindingSeverity, BadgeTone>> = Object.freeze({
  critical: 'danger',
  high: 'danger',
  medium: 'warning',
  low: 'gray',
});

export const GATE_STATUS_LABELS: Readonly<Record<OfficeQualityGateStatus, string>> = Object.freeze({
  pass: 'Aprobado',
  conditional: 'Condicional',
  blocked: 'Bloqueado',
});

export const GATE_STATUS_TONES: Readonly<Record<OfficeQualityGateStatus, BadgeTone>> = Object.freeze({
  pass: 'success',
  conditional: 'warning',
  blocked: 'danger',
});

/** Columns of the engagement board, in the order work flows through them. */
export const TASK_BOARD_COLUMNS: readonly { id: string; label: string; statuses: OfficeTaskStatus[] }[] = Object.freeze([
  { id: 'queued', label: 'En cola', statuses: ['pending', 'ready'] },
  { id: 'active', label: 'En curso', statuses: ['in-progress', 'awaiting-review'] },
  { id: 'rework', label: 'Retrabajo', statuses: ['changes-requested'] },
  { id: 'done', label: 'Completadas', statuses: ['completed', 'skipped'] },
  { id: 'stopped', label: 'Detenidas', statuses: ['failed', 'cancelled'] },
]);

/**
 * Human phrasing for how overdue a task is. Returns `null` when the task has
 * no deadline or is still comfortably inside it.
 */
export const describeAging = (dueAt: string | undefined, now: number = Date.now()): string | null => {
  if (!dueAt) return null;
  const due = Date.parse(dueAt);
  if (Number.isNaN(due)) return null;
  const hours = Math.round((due - now) / 3_600_000);
  if (hours < 0) return `Vencida hace ${Math.abs(hours)} h`;
  if (hours <= 8) return `Vence en ${hours} h`;
  return null;
};
