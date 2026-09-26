import type { Artifact } from '../../../lib/artifacts';
import type { Project } from '../../architectureProjects';
import { validateOfficeArtifact } from './officeArtifactValidators';

export const OFFICE_QUALITY_GATE_IDS = [
  'spec-freeze',
  'diagram-review',
  'security-review',
  'compliance-check',
  'cost-review',
  'performance-baseline',
] as const;

export type OfficeQualityGateId = typeof OFFICE_QUALITY_GATE_IDS[number];
export type OfficeQualityGateStatus = 'pass' | 'conditional' | 'blocked';

export const OFFICE_GATE_LABELS: Readonly<Record<OfficeQualityGateId, string>> = Object.freeze({
  'spec-freeze': 'Spec Freeze',
  'diagram-review': 'Diagram Review',
  'security-review': 'Security Review',
  'compliance-check': 'Compliance Check',
  'cost-review': 'Cost Review',
  'performance-baseline': 'Performance Baseline',
});

export interface OfficeQualityGateResult {
  id: OfficeQualityGateId;
  status: OfficeQualityGateStatus;
  evidenceArtifactIds: string[];
  blockers: string[];
  conditions: string[];
}

export interface OfficeQualityAssessment {
  gates: OfficeQualityGateResult[];
  overallStatus: OfficeQualityGateStatus;
  evaluatedAt: string;
}

const latest = (project: Project): Artifact[] => {
  const byGroup = new Map<string, Artifact>();
  for (const artifact of project.artifacts) {
    const current = byGroup.get(artifact.versionGroupId);
    if (!current || artifact.version > current.version) byGroup.set(artifact.versionGroupId, artifact);
  }
  return [...byGroup.values()];
};

const gate = (
  id: OfficeQualityGateId,
  status: OfficeQualityGateStatus,
  evidenceArtifactIds: string[] = [],
  blockers: string[] = [],
  conditions: string[] = [],
): OfficeQualityGateResult => ({ id, status, evidenceArtifactIds, blockers, conditions });

const reportFor = (artifact: Artifact) => validateOfficeArtifact(artifact);

/**
 * Compliance dimensions an insurance architecture must evidence.
 *
 * The previous rule required *all six* literal substrings
 * (`encryption/cifrado/audit/auditor/pii/phi`) to appear somewhere in the
 * concatenated project text, which made the gate permanently `conditional` —
 * an "always amber" gate carries no signal. This version scores **coverage per
 * dimension** and, critically, records *which artifact* evidences each one so
 * the reviewer can follow the claim back to its source.
 */
const COMPLIANCE_DIMENSIONS: readonly { id: string; label: string; pattern: RegExp }[] = Object.freeze([
  { id: 'encryption', label: 'cifrado en tránsito y reposo', pattern: /\b(encryption|encrypted|cifrad[oa]|tls|kms|at rest|en reposo)\b/i },
  { id: 'audit', label: 'auditoría y trazabilidad', pattern: /\b(audit|auditor[íi]a|trazabilidad|log de auditor|append-only|inmutable)\b/i },
  { id: 'data-classification', label: 'clasificación de datos sensibles', pattern: /\b(pii|phi|datos personales|dato sensible|datos sensibles|anonimiz|seudonimiz)\b/i },
  { id: 'access-control', label: 'control de acceso', pattern: /\b(rbac|abac|control de acceso|m[íi]nimo privilegio|least privilege|autorizaci[óo]n)\b/i },
  { id: 'retention', label: 'retención y conservación', pattern: /\b(retenci[óo]n|retention|conservaci[óo]n|archivad[oa]|purga)\b/i },
]);

const evaluateComplianceCoverage = (artifacts: Artifact[]): OfficeQualityGateResult => {
  if (artifacts.length === 0) {
    return gate('compliance-check', 'conditional', [], [], ['No hay artefactos sobre los que evaluar cumplimiento.']);
  }

  const evidence = new Set<string>();
  const missing: string[] = [];

  for (const dimension of COMPLIANCE_DIMENSIONS) {
    const source = artifacts.find((artifact) => dimension.pattern.test(`${artifact.name}\n${artifact.objective}\n${artifact.content}`));
    if (source) evidence.add(source.id);
    else missing.push(dimension.label);
  }

  const covered = COMPLIANCE_DIMENSIONS.length - missing.length;

  // Nothing at all is a blocker for a regulated insurer; partial coverage is a
  // condition to close before the review board, full coverage passes.
  if (covered === 0) {
    return gate(
      'compliance-check',
      'blocked',
      [],
      ['Ningún artefacto evidencia cifrado, auditoría, clasificación de datos, control de acceso ni retención.'],
    );
  }
  if (missing.length > 0) {
    return gate(
      'compliance-check',
      'conditional',
      [...evidence],
      [],
      [`Falta evidencia de: ${missing.join(', ')}.`],
    );
  }
  return gate('compliance-check', 'pass', [...evidence]);
};

export const evaluateOfficeQualityGates = (project: Project): OfficeQualityAssessment => {
  const artifacts = latest(project);
  const openapi = artifacts.find((artifact) => artifact.type === 'yaml' && /openapi/i.test(`${artifact.name}\n${artifact.content}`));
  const asyncapi = artifacts.find((artifact) => artifact.type === 'yaml' && /asyncapi/i.test(`${artifact.name}\n${artifact.content}`));
  const diagrams = artifacts.filter((artifact) => artifact.representation !== 'document' || artifact.type.startsWith('mermaid'));
  const threat = artifacts.find((artifact) => /threat model|modelo de amenazas|stride/i.test(`${artifact.name}\n${artifact.content}`));
  const cost = artifacts.find((artifact) => /cost model|modelo de costos/i.test(`${artifact.name}\n${artifact.content}`));
  const performance = artifacts.find((artifact) => /performance|rendimiento|k6|p95|p99/i.test(`${artifact.name}\n${artifact.content}`));

  let spec: OfficeQualityGateResult;
  if (!openapi || !asyncapi) {
    spec = gate('spec-freeze', 'conditional', [openapi?.id, asyncapi?.id].filter((id): id is string => Boolean(id)), [], ['Se requieren contratos OpenAPI y AsyncAPI para congelar especificaciones.']);
  } else if (reportFor(openapi).blocking || reportFor(asyncapi).blocking) {
    spec = gate('spec-freeze', 'blocked', [openapi.id, asyncapi.id], ['Hay contratos API inválidos.']);
  } else {
    spec = gate('spec-freeze', 'pass', [openapi.id, asyncapi.id]);
  }

  const invalidDiagrams = diagrams.filter((artifact) => reportFor(artifact).blocking);
  const diagramReview = diagrams.length === 0
    ? gate('diagram-review', 'conditional', [], [], ['No hay diagramas para revisar.'])
    : invalidDiagrams.length > 0
      ? gate('diagram-review', 'blocked', diagrams.map((artifact) => artifact.id), ['Hay diagramas no renderizables o sin alternativa textual.'])
      : gate('diagram-review', 'pass', diagrams.map((artifact) => artifact.id));

  const security = !threat
    ? gate(
        'security-review',
        'conditional',
        [],
        [],
        ['Crear un Threat Model STRIDE antes de promover el proyecto a security review.'],
      )
    : reportFor(threat).blocking
      ? gate('security-review', 'blocked', [threat.id], ['El Threat Model existente no supera la validación STRIDE.'])
      : gate('security-review', 'pass', [threat.id]);

  const compliance = evaluateComplianceCoverage(artifacts);

  const costReview = !cost
    ? gate('cost-review', 'conditional', [], [], ['Falta un modelo de costos.'])
    : reportFor(cost).blocking
      ? gate('cost-review', 'blocked', [cost.id], ['El modelo de costos es incompleto.'])
      : gate('cost-review', 'pass', [cost.id]);

  const performanceGate = !performance
    ? gate('performance-baseline', 'conditional', [], [], ['Falta una línea base de rendimiento con p95 y error rate.'])
    : /p95/i.test(performance.content) && /error rate|tasa de error/i.test(performance.content)
      ? gate('performance-baseline', 'pass', [performance.id])
      : gate('performance-baseline', 'blocked', [performance.id], ['La evidencia de rendimiento no incluye p95 y error rate.']);

  const gates = [spec, diagramReview, security, compliance, costReview, performanceGate];
  const overallStatus: OfficeQualityGateStatus = gates.some((current) => current.status === 'blocked')
    ? 'blocked'
    : gates.some((current) => current.status === 'conditional')
      ? 'conditional'
      : 'pass';

  return { gates, overallStatus, evaluatedAt: new Date().toISOString() };
};
