/**
 * Connects the Architecture Office's governance verdict to the publication
 * pipeline's readiness model.
 *
 * Before this bridge the codebase carried two disconnected governance stacks:
 * `architectureOffice` speaking `pass | conditional | blocked` over six named
 * gates, and `publicationPipeline` speaking `passed | warning | blocked` over
 * twenty-nine preflight codes. Neither could see the other, so an engagement
 * could clear the office and still publish against a blocking gate — or be
 * blocked by the office with nothing in the publication report to say why.
 *
 * The mapping is deliberately lossy in one direction only: office gates become
 * preflight findings (so publication inherits the office's blockers), never the
 * reverse. Publication keeps its own, stricter preflight.
 */

import type {
  PublicationPreflightCode,
  PublicationPreflightFinding,
  PublicationSeverity,
  PublicationVerdict,
} from '../publicationPipeline/PublicationPipelineTypes';
import type {
  OfficeQualityAssessment,
  OfficeQualityGateId,
  OfficeQualityGateResult,
  OfficeQualityGateStatus,
} from './officeQualityGates';
import { OFFICE_GATE_LABELS } from './officeQualityGates';

/**
 * Which publication preflight code best expresses each office gate.
 *
 * `profile-requirement-unmet` is the honest default: an office gate says a
 * deliverable the profile expects is missing or unproven, which is exactly
 * what that code means.
 */
const GATE_TO_PREFLIGHT_CODE: Readonly<Record<OfficeQualityGateId, PublicationPreflightCode>> = Object.freeze({
  'spec-freeze': 'profile-requirement-unmet',
  'diagram-review': 'diagram-insufficient-relations',
  'security-review': 'profile-requirement-unmet',
  'compliance-check': 'profile-requirement-unmet',
  'cost-review': 'profile-requirement-unmet',
  'performance-baseline': 'profile-requirement-unmet',
});

const RECOMMENDATIONS: Readonly<Record<OfficeQualityGateId, string>> = Object.freeze({
  'spec-freeze': 'Publica contratos OpenAPI 3.1 y AsyncAPI 3.0 válidos antes de congelar la especificación.',
  'diagram-review': 'Corrige los diagramas no renderizables y añade una alternativa textual accesible.',
  'security-review': 'Adjunta un Threat Model STRIDE completo con mitigaciones verificables.',
  'compliance-check': 'Documenta cifrado, auditoría, clasificación PII/PHI, control de acceso y retención con evidencia por artefacto.',
  'cost-review': 'Incluye un modelo de costos con totales y moneda.',
  'performance-baseline': 'Añade una línea base de rendimiento con p95 y tasa de error.',
});

const severityFor = (status: OfficeQualityGateStatus): PublicationSeverity =>
  status === 'blocked' ? 'critical' : 'medium';

export const officeGateToPreflightFinding = (
  gate: OfficeQualityGateResult,
): PublicationPreflightFinding | null => {
  if (gate.status === 'pass') return null;

  const label = OFFICE_GATE_LABELS[gate.id];
  const detail = gate.status === 'blocked'
    ? gate.blockers.join(' ')
    : gate.conditions.join(' ');

  return {
    id: `office-gate-${gate.id}`,
    code: GATE_TO_PREFLIGHT_CODE[gate.id],
    severity: severityFor(gate.status),
    blocking: gate.status === 'blocked',
    // A gate spans the whole engagement, so it is package-scoped: attaching it
    // to one of several evidence artifacts would misattribute the finding.
    message: `Oficina de Arquitectura — ${label}: ${detail || 'sin evidencia suficiente'}`,
    recommendation: RECOMMENDATIONS[gate.id],
  };
};

export interface OfficeReadinessContribution {
  findings: PublicationPreflightFinding[];
  verdict: PublicationVerdict;
  blocking: boolean;
}

/** Translates a whole office assessment into publication vocabulary. */
export const officeAssessmentToPreflight = (
  assessment: OfficeQualityAssessment | undefined,
): OfficeReadinessContribution => {
  if (!assessment) {
    return { findings: [], verdict: 'passed', blocking: false };
  }

  const findings = assessment.gates
    .map(officeGateToPreflightFinding)
    .filter((finding): finding is PublicationPreflightFinding => finding !== null);

  const verdict: PublicationVerdict = assessment.overallStatus === 'blocked'
    ? 'blocked'
    : assessment.overallStatus === 'conditional'
      ? 'warning'
      : 'passed';

  return {
    findings,
    verdict,
    blocking: findings.some((finding) => finding.blocking),
  };
};

/**
 * Merges office findings into an existing preflight finding list, keeping the
 * strictest verdict. Existing findings are never dropped or downgraded.
 */
export const mergeOfficeFindings = (
  existing: readonly PublicationPreflightFinding[],
  assessment: OfficeQualityAssessment | undefined,
): PublicationPreflightFinding[] => {
  const contribution = officeAssessmentToPreflight(assessment);
  const known = new Set(existing.map((finding) => finding.id));
  return [
    ...existing,
    ...contribution.findings.filter((finding) => !known.has(finding.id)),
  ];
};
