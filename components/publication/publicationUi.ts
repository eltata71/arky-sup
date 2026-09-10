/**
 * Shared presentational helpers for the Publication Center UI.
 *
 * Pure mapping functions — no JSX — so panels stay lean and the severity →
 * colour mapping is defined once. Severity is always paired with a textual
 * label so the UI never relies on colour alone (accessibility, Task 7).
 */

import type { BadgeTone } from '../ui';
import type {
  PublicationSeverity,
  PublicationVerdict,
  PublicationPackageStatus,
  PublicationTier,
} from '../../services/publicationPipeline';

/** Map a finding severity to a badge tone. */
export const severityTone = (severity: PublicationSeverity): BadgeTone => {
  switch (severity) {
    case 'critical': return 'danger';
    case 'high': return 'danger';
    case 'medium': return 'warning';
    case 'low': return 'info';
    case 'info': return 'gray';
  }
};

/** Spanish label for a severity (always shown alongside the colour). */
export const severityLabel = (severity: PublicationSeverity): string => {
  switch (severity) {
    case 'critical': return 'Crítico';
    case 'high': return 'Alto';
    case 'medium': return 'Medio';
    case 'low': return 'Bajo';
    case 'info': return 'Informativo';
  }
};

/** Map a verdict to a badge tone. */
export const verdictTone = (verdict: PublicationVerdict): BadgeTone => {
  switch (verdict) {
    case 'passed': return 'success';
    case 'warning': return 'warning';
    case 'blocked': return 'danger';
  }
};

/** Spanish label for a verdict. */
export const verdictLabel = (verdict: PublicationVerdict): string => {
  switch (verdict) {
    case 'passed': return 'Aprobado';
    case 'warning': return 'Con avisos';
    case 'blocked': return 'Bloqueado';
  }
};

/** Map a package status to a badge tone. */
export const statusTone = (status: PublicationPackageStatus): BadgeTone => {
  switch (status) {
    case 'draft': return 'gray';
    case 'ready-for-review': return 'info';
    case 'changes-requested': return 'warning';
    case 'approved': return 'primary';
    case 'published': return 'success';
    case 'archived': return 'gray';
    case 'blocked': return 'danger';
  }
};

/** Map a quality/readiness tier to a badge tone. */
export const tierTone = (tier: PublicationTier): BadgeTone => {
  switch (tier) {
    case 'world-class': return 'success';
    case 'ready': return 'primary';
    case 'usable-with-warnings': return 'warning';
    case 'needs-improvement': return 'warning';
    case 'blocked': return 'danger';
  }
};

/** A 0–100 score to a badge tone (green ≥80, amber ≥60, red below). */
export const scoreTone = (score: number): BadgeTone =>
  score >= 80 ? 'success' : score >= 60 ? 'warning' : 'danger';

/** Format a 0–1 ratio as a percentage string. */
export const ratioPct = (ratio: number): string =>
  `${Math.max(0, Math.min(100, Math.round(ratio * 100)))}%`;
