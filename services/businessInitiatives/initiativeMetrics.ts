/**
 * What an initiative dashboard is allowed to claim.
 *
 * Every number here is derived from something the user actually entered or the
 * Office actually did. Where the data is missing the helper returns `null`
 * rather than a zero, because on a tracking board a confident zero is worse
 * than an honest gap: it reads as failure instead of as "nobody has said yet".
 */

import {
  daysRemaining,
  isClosedInitiative,
  kpiProgress,
  summarizeMilestones,
  type BusinessInitiative,
  type InitiativePriority,
  type InitiativeRiskLevel,
  type InitiativeStatus,
} from './BusinessInitiativeTypes';

/**
 * The five buckets an initiative can be in, ordered by how loudly they ask for
 * attention. Deliberately the same five-bucket shape the Office uses for
 * engagements, so a reader who learned one board can read the other.
 */
export type InitiativeHealth =
  | 'at-risk'
  | 'active'
  | 'awaiting-decision'
  | 'realized'
  | 'idle';

export const INITIATIVE_HEALTH_ORDER: readonly InitiativeHealth[] = Object.freeze([
  'at-risk',
  'active',
  'awaiting-decision',
  'realized',
  'idle',
]);

const STATUS_TO_HEALTH: Readonly<Record<InitiativeStatus, InitiativeHealth>> = Object.freeze({
  'on-hold': 'at-risk',
  'in-progress': 'active',
  proposed: 'awaiting-decision',
  approved: 'awaiting-decision',
  delivered: 'realized',
  realized: 'realized',
  draft: 'idle',
  cancelled: 'idle',
});

/**
 * An initiative that is nominally in-flight but past its target date, or
 * carrying a critical risk, is at risk regardless of the status someone last
 * set by hand. Status is a claim; the dates and the risks are evidence.
 */
export const initiativeHealth = (
  initiative: BusinessInitiative,
  now: number = Date.now(),
): InitiativeHealth => {
  const base = STATUS_TO_HEALTH[initiative.status];
  if (isClosedInitiative(initiative.status)) return base;

  const remaining = daysRemaining(initiative.targetEndDate, now);
  if (remaining !== null && remaining < 0) return 'at-risk';
  if (initiative.riskLevel === 'critical') return 'at-risk';
  if (summarizeMilestones(initiative.milestones).missed > 0) return 'at-risk';
  return base;
};

export const worstInitiativeHealth = (
  healths: readonly InitiativeHealth[],
): InitiativeHealth => {
  for (const candidate of INITIATIVE_HEALTH_ORDER) {
    if (healths.includes(candidate)) return candidate;
  }
  return 'idle';
};

export type InitiativeHealthMix = Readonly<Record<InitiativeHealth, number>>;
export type InitiativePriorityMix = Readonly<Record<InitiativePriority, number>>;
export type InitiativeRiskMix = Readonly<Record<InitiativeRiskLevel, number>>;

export interface InitiativePortfolioRollup {
  total: number;
  healthMix: InitiativeHealthMix;
  priorityMix: InitiativePriorityMix;
  riskMix: InitiativeRiskMix;
  /** Initiatives whose target date has passed while still open. */
  overdue: number;
  /** Open initiatives whose target date is inside the next 30 days. */
  dueSoon: number;
  awaitingDecision: number;
  /** Sum of `estimatedInvestment`, over the initiatives that declare one. */
  investment: number;
  /** How many declared one — the denominator the sum is honest about. */
  investmentDeclared: number;
  milestonesTotal: number;
  milestonesMet: number;
  milestonesMissed: number;
  kpisTotal: number;
  /** KPIs with enough data to plot. */
  kpisMeasurable: number;
  /** Mean KPI progress across the measurable ones, or `null` when there are none. */
  kpiAttainment: number | null;
  documents: number;
}

const emptyHealthMix = (): Record<InitiativeHealth, number> => ({
  'at-risk': 0,
  active: 0,
  'awaiting-decision': 0,
  realized: 0,
  idle: 0,
});

const emptyPriorityMix = (): Record<InitiativePriority, number> => ({
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
});

const emptyRiskMix = (): Record<InitiativeRiskLevel, number> => ({
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
});

export const emptyInitiativeRollup = (): InitiativePortfolioRollup => ({
  total: 0,
  healthMix: emptyHealthMix(),
  priorityMix: emptyPriorityMix(),
  riskMix: emptyRiskMix(),
  overdue: 0,
  dueSoon: 0,
  awaitingDecision: 0,
  investment: 0,
  investmentDeclared: 0,
  milestonesTotal: 0,
  milestonesMet: 0,
  milestonesMissed: 0,
  kpisTotal: 0,
  kpisMeasurable: 0,
  kpiAttainment: null,
  documents: 0,
});

const DUE_SOON_DAYS = 30;

export const rollupInitiatives = (
  initiatives: readonly BusinessInitiative[],
  now: number = Date.now(),
): InitiativePortfolioRollup => {
  const healthMix = emptyHealthMix();
  const priorityMix = emptyPriorityMix();
  const riskMix = emptyRiskMix();

  let overdue = 0;
  let dueSoon = 0;
  let awaitingDecision = 0;
  let investment = 0;
  let investmentDeclared = 0;
  let milestonesTotal = 0;
  let milestonesMet = 0;
  let milestonesMissed = 0;
  let kpisTotal = 0;
  let documents = 0;
  const progressValues: number[] = [];

  for (const initiative of initiatives) {
    const health = initiativeHealth(initiative, now);
    healthMix[health] += 1;
    priorityMix[initiative.priority] += 1;
    riskMix[initiative.riskLevel] += 1;
    if (initiative.status === 'proposed') awaitingDecision += 1;

    if (!isClosedInitiative(initiative.status)) {
      const remaining = daysRemaining(initiative.targetEndDate, now);
      if (remaining !== null) {
        if (remaining < 0) overdue += 1;
        else if (remaining <= DUE_SOON_DAYS) dueSoon += 1;
      }
    }

    if (initiative.estimatedInvestment !== undefined) {
      investment += initiative.estimatedInvestment;
      investmentDeclared += 1;
    }

    const milestones = summarizeMilestones(initiative.milestones);
    milestonesTotal += milestones.total;
    milestonesMet += milestones.met;
    milestonesMissed += milestones.missed;

    kpisTotal += initiative.kpis.length;
    for (const kpi of initiative.kpis) {
      const progress = kpiProgress(kpi);
      if (progress !== null) progressValues.push(progress);
    }

    documents += initiative.documents.length;
  }

  return {
    total: initiatives.length,
    healthMix,
    priorityMix,
    riskMix,
    overdue,
    dueSoon,
    awaitingDecision,
    investment,
    investmentDeclared,
    milestonesTotal,
    milestonesMet,
    milestonesMissed,
    kpisTotal,
    kpisMeasurable: progressValues.length,
    kpiAttainment: progressValues.length === 0
      ? null
      : progressValues.reduce((sum, value) => sum + value, 0) / progressValues.length,
    documents,
  };
};

/**
 * How complete an initiative's record is, 0..1 — the "is this well enough
 * described to build architecture on top of it?" score.
 *
 * Deliberately not a quality judgement of the content: it counts whether the
 * questions have been answered at all. That is the gap a reviewer can act on,
 * and it is the one thing a machine can assess honestly.
 */
export interface InitiativeCompleteness {
  ratio: number;
  /** Human-readable names of the sections still empty. */
  missing: string[];
}

export const assessCompleteness = (initiative: BusinessInitiative): InitiativeCompleteness => {
  const checks: { label: string; done: boolean }[] = [
    { label: 'Necesidad de negocio', done: initiative.need.trim().length > 0 },
    { label: 'Driver / motivación', done: initiative.driver.trim().length > 0 },
    { label: 'Objetivos', done: initiative.objectives.length > 0 },
    { label: 'Resultados esperados', done: initiative.expectedOutcomes.length > 0 },
    { label: 'Indicadores (KPI)', done: initiative.kpis.length > 0 },
    { label: 'Capacidades afectadas', done: initiative.affectedCapabilities.length > 0 },
    { label: 'Patrocinador', done: initiative.stakeholders.some((s) => s.kind === 'sponsor') },
    { label: 'Periodo objetivo', done: Boolean(initiative.targetEndDate) },
    { label: 'Riesgos', done: initiative.risks.length > 0 },
    { label: 'Documentos de soporte', done: initiative.documents.length > 0 },
  ];
  const done = checks.filter((check) => check.done).length;
  return {
    ratio: done / checks.length,
    missing: checks.filter((check) => !check.done).map((check) => check.label),
  };
};
