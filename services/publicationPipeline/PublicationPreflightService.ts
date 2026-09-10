/**
 * Publication preflight (Task 4).
 *
 * Preflight is the gate that decides whether an artifact — or a whole package —
 * is ready to be published. It runs 27 deterministic checks spanning artifact
 * integrity, compilation, diagrams, documents, SDD structure, matrices,
 * dictionaries, traceability, graph consistency, versioning, review status,
 * exportability and editorial structure.
 *
 * Preflight never throws and never mutates. It reuses the Artifact Compiler and
 * the Architecture Knowledge Graph rather than re-deriving their signal.
 */

import type { Artifact, ArtifactType } from '../../types';
import type { DiagramIR } from '../../lib/diagram';
import { newPrefixedId } from '../../lib/ids';
import { getExportCapabilities } from '../export/exportRegistry';
import {
  analyzeArchitectureConsistency,
  getRequirementsWithoutCoverage,
  getRisksWithoutMitigation,
  getDecisionsWithoutImpact,
} from '../architectureKnowledgeGraph';
import type { ArchitectureGraph } from '../architectureKnowledgeGraph/ArchitectureKnowledgeGraphTypes';
import type { ArchitectureGraphFreshness } from '../architectureKnowledgeGraph/ArchitectureGraphFreshness';
import {
  clampPublicationScore,
  type PublicationAction,
  type PublicationArtifactPreflight,
  type PublicationPreflightCode,
  type PublicationPreflightFinding,
  type PublicationPreflightReport,
  type PublicationProfile,
  type PublicationSeverity,
  type PublicationVerdict,
} from './PublicationPipelineTypes';
import { resolveArtifactCompilation } from './PublicationQualityBridge';
import { trackPublicationEvent, reportPublicationFailure } from './PublicationObservability';

const findingId = (): string => newPrefixedId('pubpf');

const SEVERITY_PENALTY: Record<PublicationSeverity, number> = {
  critical: 34,
  high: 16,
  medium: 8,
  low: 3,
  info: 0,
};

/** Codes that always block publication when present. */
const BLOCKING_CODES: ReadonlySet<PublicationPreflightCode> = new Set([
  'artifact-empty',
  'artifact-corrupt',
  'artifact-compilation-failed',
  'artifact-critical-issues',
  'diagram-skeleton-fallback',
  'exporter-unavailable',
  'graph-inconsistency',
]);

const SDD_TYPES: ReadonlySet<ArtifactType> = new Set<ArtifactType>([
  'sdd-brd', 'sdd-use-case', 'sdd-user-story', 'sdd-domain-model', 'sdd-event-storming',
  'sdd-glossary', 'sdd-nfr', 'sdd-bdd', 'sdd-traceability',
]);

interface CheckSpec {
  code: PublicationPreflightCode;
  severity: PublicationSeverity;
  message: string;
  recommendation: string;
}

const toFinding = (
  spec: CheckSpec,
  artifact?: Pick<Artifact, 'id' | 'name'>,
): PublicationPreflightFinding => ({
  id: findingId(),
  code: spec.code,
  severity: spec.severity,
  blocking: BLOCKING_CODES.has(spec.code) && spec.severity !== 'info',
  ...(artifact ? { artifactId: artifact.id, artifactName: artifact.name } : {}),
  message: spec.message,
  recommendation: spec.recommendation,
});

/* ------------------------------------------------------------------------- */
/* Content heuristics                                                         */
/* ------------------------------------------------------------------------- */

const hasSection = (content: string, keywords: string[]): boolean => {
  const lower = content.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
};

const headingCount = (content: string): number =>
  content.split('\n').filter((line) => /^#{1,6}\s+\S/.test(line.trim())).length;

const countTableRows = (content: string): number => {
  let rows = 0;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && !/^\|?[\s:|-]+\|?$/.test(trimmed)) {
      rows += 1;
    }
  }
  return rows;
};

const isDiagramIR = (value: unknown): value is DiagramIR =>
  !!value && typeof value === 'object' && Array.isArray((value as DiagramIR).nodes);

/* ------------------------------------------------------------------------- */
/* Per-artifact preflight                                                     */
/* ------------------------------------------------------------------------- */

/**
 * Run the per-artifact preflight checks. Pure — never throws. The
 * `requiresApproval` flag (from the profile) toggles the pending-approval
 * check from a warning into a publication-relevant finding.
 */
export const runArtifactPreflight = (
  artifact: Artifact,
  options: { qualityThreshold?: number; requiresApproval?: boolean } = {},
): PublicationArtifactPreflight => {
  const findings: PublicationPreflightFinding[] = [];
  const qualityThreshold = options.qualityThreshold ?? 70;
  const content = typeof artifact.content === 'string' ? artifact.content : '';
  const trimmed = content.trim();
  const ref = { id: artifact.id, name: artifact.name };

  // 1 — empty.
  if (trimmed.length === 0) {
    findings.push(toFinding({
      code: 'artifact-empty', severity: 'critical',
      message: 'El artefacto está vacío.',
      recommendation: 'Genera o edita el contenido del artefacto antes de publicarlo.',
    }, ref));
  }

  // 2 — corrupt.
  if (typeof artifact.content !== 'string' || typeof artifact.type !== 'string') {
    findings.push(toFinding({
      code: 'artifact-corrupt', severity: 'critical',
      message: 'El artefacto tiene una estructura corrupta.',
      recommendation: 'Regenera el artefacto; su contenido o tipo no es válido.',
    }, ref));
  }

  const compilation = resolveArtifactCompilation(artifact);

  // 3 — compilation failed.
  if (compilation.compilerStatus === 'failed' || compilation.compilerStatus === 'blocked') {
    findings.push(toFinding({
      code: 'artifact-compilation-failed', severity: 'critical',
      message: `La compilación del artefacto está en estado "${compilation.compilerStatus}".`,
      recommendation: 'Resuelve los hallazgos del compilador y vuelve a compilar el artefacto.',
    }, ref));
  }

  // 4 — low score.
  if (compilation.compilerScore < qualityThreshold && trimmed.length > 0) {
    findings.push(toFinding({
      code: 'artifact-low-score', severity: 'high',
      message: `El puntaje de calidad (${compilation.compilerScore}) está por debajo del umbral del perfil (${qualityThreshold}).`,
      recommendation: 'Mejora el artefacto siguiendo las recomendaciones del compilador hasta superar el umbral.',
    }, ref));
  }

  // 5 — critical compiler issues.
  if (compilation.compilerIssues.critical > 0) {
    findings.push(toFinding({
      code: 'artifact-critical-issues', severity: 'critical',
      message: `El artefacto tiene ${compilation.compilerIssues.critical} hallazgo(s) crítico(s) del compilador.`,
      recommendation: 'Corrige los hallazgos críticos del compilador antes de publicar.',
    }, ref));
  }

  // Diagram-specific checks.
  if (isDiagramIR(artifact.ir)) {
    const ir = artifact.ir;
    // 6 — skeleton fallback.
    if (ir.metadata?.fallback === 'skeleton') {
      findings.push(toFinding({
        code: 'diagram-skeleton-fallback', severity: 'high',
        message: 'El diagrama es un esqueleto base de respaldo, no un diagrama final.',
        recommendation: 'Regenera el diagrama con más contexto para reemplazar el esqueleto.',
      }, ref));
    }
    // 7 — orphan nodes.
    const referenced = new Set<string>();
    for (const edge of ir.edges) { referenced.add(edge.source); referenced.add(edge.target); }
    const orphanCount = ir.nodes.filter((n) => !referenced.has(n.id)).length;
    if (ir.nodes.length > 1 && orphanCount > 0) {
      findings.push(toFinding({
        code: 'diagram-orphan-nodes', severity: 'medium',
        message: `El diagrama tiene ${orphanCount} nodo(s) sin relaciones.`,
        recommendation: 'Conecta los nodos huérfanos o elimínalos para un diagrama coherente.',
      }, ref));
    }
    // 8 — insufficient relations.
    if (ir.nodes.length >= 3 && ir.edges.length < ir.nodes.length - 1) {
      findings.push(toFinding({
        code: 'diagram-insufficient-relations', severity: 'medium',
        message: 'El diagrama tiene muy pocas relaciones para su número de nodos.',
        recommendation: 'Añade las relaciones que faltan para que el diagrama comunique el flujo completo.',
      }, ref));
    }
  }

  // Document-oriented checks.
  const isDocumentish = artifact.representation === 'document' || artifact.representation === 'hybrid';
  if (isDocumentish && trimmed.length > 0) {
    // 9 — missing objective.
    const hasObjective = (artifact.objective ?? '').trim().length > 12
      || hasSection(content, ['objetivo', 'objective', 'propósito', 'proposito']);
    if (!hasObjective) {
      findings.push(toFinding({
        code: 'document-missing-objective', severity: 'high',
        message: 'El documento no declara un objetivo.',
        recommendation: 'Añade una sección de objetivo que explique el propósito del documento.',
      }, ref));
    }
    // 13 — SDD required sections.
    if (SDD_TYPES.has(artifact.type)) {
      if (headingCount(content) < 2) {
        findings.push(toFinding({
          code: 'sdd-missing-required-sections', severity: 'high',
          message: 'El artefacto SDD no tiene las secciones estructurales obligatorias.',
          recommendation: 'Estructura el documento SDD con las secciones obligatorias de su estándar.',
        }, ref));
      }
      // 10/11/12 — scope/risks/decisions where applicable.
      if (artifact.type === 'sdd-brd' && !hasSection(content, ['alcance', 'scope'])) {
        findings.push(toFinding({
          code: 'document-missing-scope', severity: 'medium',
          message: 'El BRD no declara su alcance.',
          recommendation: 'Añade una sección de alcance (qué incluye y qué excluye).',
        }, ref));
      }
    }
    if (!hasSection(content, ['riesgo', 'risk']) && /dise[ñn]o|architecture|arquitectura|brd/i.test(`${artifact.name} ${artifact.type}`)) {
      findings.push(toFinding({
        code: 'document-missing-risks', severity: 'medium',
        message: 'El documento de diseño no aborda riesgos.',
        recommendation: 'Añade una sección de riesgos y sus mitigaciones.',
      }, ref));
    }
    if (!hasSection(content, ['decisi']) && /arquitectura|architecture|sdd|adr/i.test(`${artifact.name} ${artifact.type}`)) {
      findings.push(toFinding({
        code: 'document-missing-decisions', severity: 'low',
        message: 'El documento no registra decisiones arquitectónicas.',
        recommendation: 'Documenta las decisiones clave y su justificación.',
      }, ref));
    }
    // 27 — editorial structure.
    if (headingCount(content) === 0 && trimmed.length > 400) {
      findings.push(toFinding({
        code: 'editorial-structure-issue', severity: 'medium',
        message: 'El documento extenso no tiene una estructura editorial con encabezados.',
        recommendation: 'Divide el documento en secciones con encabezados.',
      }, ref));
    }
  }

  // 14 — matrices.
  if (artifact.type === 'sdd-traceability' && trimmed.length > 0) {
    if (countTableRows(content) < 2) {
      findings.push(toFinding({
        code: 'matrix-empty-or-missing-cells', severity: 'high',
        message: 'La matriz de trazabilidad no tiene filas suficientes.',
        recommendation: 'Completa la matriz con los enlaces de trazabilidad requeridos.',
      }, ref));
    }
  }

  // 15 — dictionaries.
  if (/diccionario|dictionary|glosario|glossary/i.test(`${artifact.name} ${artifact.type}`)
    && trimmed.length > 0 && artifact.keyConcepts.length === 0 && countTableRows(content) < 2) {
    findings.push(toFinding({
      code: 'dictionary-missing-fields', severity: 'medium',
      message: 'El diccionario o glosario no tiene campos definidos.',
      recommendation: 'Define los términos con su tipo, descripción y sensibilidad cuando aplique.',
    }, ref));
  }

  // 21 — missing version.
  if (typeof artifact.version !== 'number' || artifact.version < 1) {
    findings.push(toFinding({
      code: 'artifact-missing-version', severity: 'medium',
      message: 'El artefacto no tiene un número de versión válido.',
      recommendation: 'Vuelve a guardar el artefacto para asignarle una versión.',
    }, ref));
  }

  // 22 — missing review status.
  if (!artifact.reviewStatus) {
    findings.push(toFinding({
      code: 'artifact-missing-review-status', severity: 'low',
      message: 'El artefacto no tiene un estado de revisión.',
      recommendation: 'Envía el artefacto al flujo de revisión para asignarle un estado.',
    }, ref));
  }

  // 23 — pending approval.
  if (options.requiresApproval && artifact.reviewStatus && artifact.reviewStatus !== 'approved') {
    findings.push(toFinding({
      code: 'artifact-pending-approval', severity: 'medium',
      message: `El artefacto está "${artifact.reviewStatus}" y el perfil requiere aprobación.`,
      recommendation: 'Aprueba el artefacto en el flujo de revisión antes de publicar el paquete.',
    }, ref));
  }

  // 24 — exporter availability.
  if (trimmed.length > 0) {
    try {
      const caps = getExportCapabilities(
        { artifact, activeView: artifact.representation === 'diagram' ? 'diagram' : 'document' },
        false,
      );
      if (caps.length === 0) {
        findings.push(toFinding({
          code: 'exporter-unavailable', severity: 'high',
          message: 'No hay ningún formato de exportación disponible para el artefacto.',
          recommendation: 'Revisa el contenido y la vista activa; el artefacto no es exportable en su estado actual.',
        }, ref));
      }
    } catch {
      /* export registry failure is non-fatal for preflight */
    }
  }

  const verdict = resolveVerdict(findings);
  const score = scoreFromFindings(findings, trimmed.length === 0);
  return {
    artifactId: artifact.id,
    artifactName: artifact.name,
    artifactType: artifact.type,
    verdict,
    score,
    findings,
  };
};

/* ------------------------------------------------------------------------- */
/* Scoring + verdict                                                          */
/* ------------------------------------------------------------------------- */

const scoreFromFindings = (findings: PublicationPreflightFinding[], empty: boolean): number => {
  if (empty) return 0;
  const penalty = findings.reduce((sum, f) => sum + SEVERITY_PENALTY[f.severity], 0);
  return clampPublicationScore(100 - penalty);
};

const resolveVerdict = (findings: PublicationPreflightFinding[]): PublicationVerdict => {
  if (findings.some((f) => f.blocking)) return 'blocked';
  if (findings.length > 0) return 'warning';
  return 'passed';
};

const toAction = (finding: PublicationPreflightFinding): PublicationAction => ({
  id: findingId(),
  title: finding.message,
  detail: finding.recommendation,
  priority: finding.severity,
  ...(finding.artifactId ? { artifactId: finding.artifactId } : {}),
});

/* ------------------------------------------------------------------------- */
/* Package preflight                                                          */
/* ------------------------------------------------------------------------- */

export interface PackagePreflightInput {
  packageId: string;
  artifacts: Artifact[];
  profile: PublicationProfile;
  graph?: ArchitectureGraph;
  /**
   * Freshness of the graph relative to the project's current artifacts. When
   * the profile requires traceability, a stale or missing graph raises a
   * non-blocking warning so the package is never published against an
   * out-of-date canonical model without the architect knowing.
   */
  graphFreshness?: ArchitectureGraphFreshness;
  /** Accessibility findings folded into the report (Task 4 check #26). */
  accessibilityBlocked?: boolean;
  accessibilityIssueCount?: number;
}

/**
 * Run preflight over a full package: every artifact plus package-level graph,
 * traceability and exportability checks. Never throws — on internal failure it
 * returns a blocked report so the UI never shows a blank screen.
 */
export const runPackagePreflight = (input: PackagePreflightInput): PublicationPreflightReport => {
  trackPublicationEvent('publication.preflight.started',
    `Preflight de paquete iniciado (${input.artifacts.length} artefacto(s)).`,
    { packageId: input.packageId });

  try {
    const artifactResults = input.artifacts.map((artifact) =>
      runArtifactPreflight(artifact, {
        qualityThreshold: input.profile.qualityThreshold,
        requiresApproval: input.profile.approvalRequired,
      }));

    const findings: PublicationPreflightFinding[] = artifactResults.flatMap((r) => r.findings);

    // Package-level: empty package.
    if (input.artifacts.length === 0) {
      findings.push(toFinding({
        code: 'artifact-empty', severity: 'critical',
        message: 'El paquete no contiene artefactos.',
        recommendation: 'Añade al menos un artefacto al paquete antes de publicarlo.',
      }));
    }

    // Package-level graph checks (16–20).
    if (input.graph && input.profile.traceabilityRequired) {
      const consistency = analyzeArchitectureConsistency(input.graph);
      const criticalIssues = consistency.issues.filter((i) => i.severity === 'critical');
      if (criticalIssues.length > 0) {
        findings.push(toFinding({
          code: 'graph-inconsistency', severity: 'critical',
          message: `El grafo de arquitectura tiene ${criticalIssues.length} inconsistencia(s) crítica(s).`,
          recommendation: 'Resuelve las inconsistencias críticas del grafo antes de publicar.',
        }));
      } else if (consistency.issues.length > 0) {
        findings.push(toFinding({
          code: 'graph-inconsistency', severity: 'medium',
          message: `El grafo de arquitectura tiene ${consistency.issues.length} inconsistencia(s).`,
          recommendation: 'Revisa las inconsistencias del grafo para mejorar la trazabilidad.',
        }));
      }

      const uncovered = getRequirementsWithoutCoverage(input.graph);
      if (uncovered.length > 0) {
        findings.push(toFinding({
          code: 'requirement-without-coverage', severity: 'high',
          message: `${uncovered.length} requerimiento(s) sin cobertura de artefactos.`,
          recommendation: 'Crea o enlaza artefactos que cubran los requerimientos pendientes.',
        }));
      }
      const risks = getRisksWithoutMitigation(input.graph);
      if (risks.length > 0) {
        findings.push(toFinding({
          code: 'risk-without-mitigation', severity: 'high',
          message: `${risks.length} riesgo(s) sin mitigación registrada.`,
          recommendation: 'Documenta la mitigación de cada riesgo en los artefactos del paquete.',
        }));
      }
      const decisions = getDecisionsWithoutImpact(input.graph);
      if (decisions.length > 0) {
        findings.push(toFinding({
          code: 'decision-without-impact', severity: 'low',
          message: `${decisions.length} decisión(es) sin impacto declarado.`,
          recommendation: 'Declara el impacto de cada decisión arquitectónica.',
        }));
      }

      if (consistency.issues.length === 0 && uncovered.length === 0 && risks.length === 0) {
        // healthy graph — no traceability-insufficient finding
      } else if (input.profile.traceabilityRequired && uncovered.length > 0) {
        findings.push(toFinding({
          code: 'traceability-insufficient', severity: 'medium',
          message: 'La trazabilidad del paquete es insuficiente para el perfil seleccionado.',
          recommendation: 'Completa la trazabilidad de requerimientos y riesgos del paquete.',
        }));
      }
    }

    // Graph freshness gate: a traceability-required profile must not publish
    // against an out-of-date (or absent) canonical graph. Non-blocking — it
    // warns so the architect can recalculate before publishing.
    if (input.profile.traceabilityRequired) {
      if (!input.graph) {
        findings.push(toFinding({
          code: 'graph-stale', severity: 'high',
          message: 'El perfil requiere trazabilidad pero el proyecto no tiene un grafo de conocimiento persistido.',
          recommendation: 'Recalcula y persiste el grafo de conocimiento arquitectónico antes de publicar este paquete.',
        }));
      } else if (input.graphFreshness === 'stale') {
        findings.push(toFinding({
          code: 'graph-stale', severity: 'high',
          message: 'El grafo de conocimiento está desactualizado respecto de los artefactos actuales del proyecto.',
          recommendation: 'Recalcula el grafo para que la trazabilidad y la consistencia del paquete reflejen el estado actual.',
        }));
      }
    }

    // Package-level: format compatibility (25).
    const availableFormats = new Set(
      input.artifacts.flatMap((artifact) => {
        try {
          return getExportCapabilities(
            { artifact, activeView: artifact.representation === 'diagram' ? 'diagram' : 'document' },
            false,
          ).map((c) => c.format);
        } catch {
          return [];
        }
      }),
    );
    const missingFormats = input.profile.exportFormats.filter((f) => !availableFormats.has(f));
    if (input.artifacts.length > 0 && missingFormats.length === input.profile.exportFormats.length) {
      findings.push(toFinding({
        code: 'format-incompatible-with-view', severity: 'medium',
        message: 'Ningún formato de exportación del perfil es compatible con los artefactos del paquete.',
        recommendation: 'Ajusta las vistas o el contenido para habilitar al menos un formato del perfil.',
      }));
    }

    // Accessibility fold-in (26).
    if (input.accessibilityBlocked) {
      findings.push(toFinding({
        code: 'accessibility-issue', severity: 'high',
        message: 'El paquete no cumple el nivel de accesibilidad requerido por el perfil.',
        recommendation: 'Resuelve los hallazgos de accesibilidad del panel correspondiente.',
      }));
    } else if ((input.accessibilityIssueCount ?? 0) > 0) {
      findings.push(toFinding({
        code: 'accessibility-issue', severity: 'low',
        message: `El paquete tiene ${input.accessibilityIssueCount} aviso(s) de accesibilidad.`,
        recommendation: 'Revisa el panel de accesibilidad para mejorar la calidad del entregable.',
      }));
    }

    const blocking = findings.filter((f) => f.blocking);
    const warnings = findings.filter((f) => !f.blocking && f.severity !== 'info');
    const verdict = resolveVerdict(findings);
    const score = input.artifacts.length === 0
      ? 0
      : clampPublicationScore(
          artifactResults.reduce((s, r) => s + r.score, 0) / artifactResults.length
            - findings.filter((f) => !f.artifactId).reduce((s, f) => s + SEVERITY_PENALTY[f.severity], 0),
        );

    const requiredActions = blocking.map(toAction);
    const optionalActions = warnings
      .filter((f) => f.severity === 'high' || f.severity === 'medium')
      .map(toAction);

    const report: PublicationPreflightReport = {
      id: findingId(),
      scope: 'package',
      targetId: input.packageId,
      generatedAt: new Date().toISOString(),
      verdict,
      passed: verdict === 'passed',
      blocked: verdict === 'blocked',
      score,
      findings,
      warnings,
      requiredActions,
      optionalActions,
      artifactResults,
      canPublish: verdict !== 'blocked' && input.artifacts.length > 0,
      canExport: input.artifacts.some((a) => (a.content ?? '').trim().length > 0),
      requiresApproval: input.profile.approvalRequired,
      requiresHumanReview: verdict !== 'passed' || warnings.length > 0,
    };

    trackPublicationEvent('publication.preflight.completed',
      `Preflight de paquete completado: ${verdict} (puntaje ${score}).`,
      { packageId: input.packageId, verdict, score, findingCount: findings.length });

    return report;
  } catch (error) {
    reportPublicationFailure('publication.preflight.failed', error, { packageId: input.packageId });
    const blockedFinding = toFinding({
      code: 'artifact-corrupt', severity: 'critical',
      message: 'El preflight no pudo completarse por un error interno.',
      recommendation: 'Reintenta el preflight; si el problema persiste revisa el centro de observabilidad.',
    });
    return {
      id: findingId(),
      scope: 'package',
      targetId: input.packageId,
      generatedAt: new Date().toISOString(),
      verdict: 'blocked',
      passed: false,
      blocked: true,
      score: 0,
      findings: [blockedFinding],
      warnings: [],
      requiredActions: [toAction(blockedFinding)],
      optionalActions: [],
      artifactResults: [],
      canPublish: false,
      canExport: false,
      requiresApproval: input.profile.approvalRequired,
      requiresHumanReview: true,
    };
  }
};

/** Convenience: run preflight for a single artifact, framed as a report. */
export const runSingleArtifactPreflight = (
  artifact: Artifact,
  profile: PublicationProfile,
): PublicationPreflightReport => {
  const result = runArtifactPreflight(artifact, {
    qualityThreshold: profile.qualityThreshold,
    requiresApproval: profile.approvalRequired,
  });
  const blocking = result.findings.filter((f) => f.blocking);
  const warnings = result.findings.filter((f) => !f.blocking && f.severity !== 'info');
  return {
    id: findingId(),
    scope: 'artifact',
    targetId: artifact.id,
    generatedAt: new Date().toISOString(),
    verdict: result.verdict,
    passed: result.verdict === 'passed',
    blocked: result.verdict === 'blocked',
    score: result.score,
    findings: result.findings,
    warnings,
    requiredActions: blocking.map(toAction),
    optionalActions: warnings.map(toAction),
    artifactResults: [result],
    canPublish: result.verdict !== 'blocked',
    canExport: (artifact.content ?? '').trim().length > 0,
    requiresApproval: profile.approvalRequired,
    requiresHumanReview: result.verdict !== 'passed',
  };
};
