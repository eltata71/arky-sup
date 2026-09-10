/**
 * Package readiness evaluation + publication report (Tasks 3, 10, 12).
 *
 * The readiness service is the composition layer: it folds preflight,
 * accessibility, quality, traceability, artifact coverage, export and approval
 * into a single {@link PublicationReadinessReport} with one verdict, one score
 * and one set of recommendations.
 *
 * It also renders the human-facing {@link PublicationReport} (Markdown), which
 * the export orchestrator hands to the existing export adapters.
 *
 * Pure & total — never throws, never mutates.
 */

import type { Artifact } from '../../types';
import { newPrefixedId } from '../../lib/ids';
import { getExportCapabilities } from '../export/exportRegistry';
import type { ExportFormat } from '../export/exportTypes';
import type { ArchitectureGraph } from '../architectureKnowledgeGraph/ArchitectureKnowledgeGraphTypes';
import type { ArchitectureGraphFreshness } from '../architectureKnowledgeGraph/ArchitectureGraphFreshness';
import {
  clampPublicationScore,
  publicationTierFromScore,
  publicationTierLabel,
  publicationStatusLabel,
  type PublicationAction,
  type PublicationApprovalResult,
  type PublicationCoverageResult,
  type PublicationExportResult,
  type PublicationPackage,
  type PublicationPreflightFinding,
  type PublicationProfile,
  type PublicationReadinessReport,
  type PublicationReport,
  type PublicationVerdict,
} from './PublicationPipelineTypes';
import { evaluatePublicationAccessibility } from './PublicationAccessibilityService';
import { runPackagePreflight } from './PublicationPreflightService';
import {
  summarizeArtifactQuality,
  buildQualityResult,
  buildTraceabilityResult,
} from './PublicationQualityBridge';
import { countOverrides } from './PublicationAuditTrailService';
import { trackPublicationEvent } from './PublicationObservability';

const reportId = (): string => newPrefixedId('pubready');

/* ------------------------------------------------------------------------- */
/* Coverage                                                                   */
/* ------------------------------------------------------------------------- */

/** Grade a package's artifacts against the profile's coverage requirements. */
export const computeCoverage = (
  profile: PublicationProfile,
  artifacts: Artifact[],
): PublicationCoverageResult[] =>
  profile.artifactRequirements.map((req) => {
    const matched = artifacts.filter((a) => req.anyOf.includes(a.type)).map((a) => a.id);
    const satisfied = matched.length >= req.min;
    return {
      requirementId: req.id,
      label: req.label,
      required: req.required,
      satisfied,
      matchedArtifactIds: matched,
      message: satisfied
        ? `Cubierto por ${matched.length} artefacto(s).`
        : req.required
          ? `Falta: se requiere al menos ${req.min} artefacto de tipo "${req.label}".`
          : `Recomendado: añade un artefacto de tipo "${req.label}".`,
    };
  });

/** Synthesize blocking preflight findings for unmet required coverage. */
const coverageBlockers = (coverage: PublicationCoverageResult[]): PublicationPreflightFinding[] =>
  coverage
    .filter((c) => c.required && !c.satisfied)
    .map((c) => ({
      id: newPrefixedId('pubpf'),
      code: 'profile-requirement-unmet' as const,
      severity: 'critical' as const,
      blocking: true,
      message: `El paquete no cumple el requisito obligatorio "${c.label}".`,
      recommendation: c.message,
    }));

/* ------------------------------------------------------------------------- */
/* Export grading                                                             */
/* ------------------------------------------------------------------------- */

const computeExportResult = (
  profile: PublicationProfile,
  artifacts: Artifact[],
): PublicationExportResult => {
  const available = new Set<ExportFormat>();
  for (const artifact of artifacts) {
    try {
      const caps = getExportCapabilities(
        { artifact, activeView: artifact.representation === 'diagram' ? 'diagram' : 'document' },
        false,
      );
      caps.forEach((c) => available.add(c.format));
    } catch {
      /* a single export-registry miss never fails readiness */
    }
  }
  const availableFormats = Array.from(available);
  const missingFormats = profile.exportFormats.filter((f) => !available.has(f));
  const verdict: PublicationVerdict = artifacts.length === 0
    ? 'blocked'
    : availableFormats.length === 0
      ? 'blocked'
      : missingFormats.length > 0
        ? 'warning'
        : 'passed';
  return {
    availableFormats,
    missingFormats,
    verdict,
    message: verdict === 'passed'
      ? 'Todos los formatos del perfil están disponibles.'
      : verdict === 'blocked'
        ? 'No hay formatos de exportación disponibles para el paquete.'
        : `${missingFormats.length} formato(s) del perfil no están disponibles para el contenido actual.`,
  };
};

/* ------------------------------------------------------------------------- */
/* Approval grading                                                           */
/* ------------------------------------------------------------------------- */

const computeApprovalResult = (
  profile: PublicationProfile,
  pkg: PublicationPackage,
): PublicationApprovalResult => {
  const satisfied = !profile.approvalRequired
    || pkg.status === 'approved'
    || pkg.status === 'published';
  return {
    required: profile.approvalRequired,
    satisfied,
    status: pkg.status,
    message: !profile.approvalRequired
      ? 'Este perfil no exige aprobación formal.'
      : satisfied
        ? 'El paquete cuenta con la aprobación requerida.'
        : 'El paquete requiere aprobación formal antes de publicarse.',
  };
};

/* ------------------------------------------------------------------------- */
/* Readiness evaluation                                                       */
/* ------------------------------------------------------------------------- */

export interface ReadinessInput {
  pkg: PublicationPackage;
  profile: PublicationProfile;
  /** Resolved artifacts (latest versions) referenced by the package. */
  artifacts: Artifact[];
  graph?: ArchitectureGraph;
  /** Freshness of the graph relative to the project's current artifacts. */
  graphFreshness?: ArchitectureGraphFreshness;
}

/**
 * Evaluate the end-to-end readiness of a package. Composes every signal into a
 * single report. Never throws — on internal failure it returns a blocked
 * report so the UI always has something safe to render.
 */
export const evaluatePackageReadiness = (input: ReadinessInput): PublicationReadinessReport => {
  const { pkg, profile, artifacts, graph, graphFreshness } = input;
  try {
    const accessibility = evaluatePublicationAccessibility(
      artifacts, profile.accessibilityLevel, 'package', pkg.id,
    );
    const preflight = runPackagePreflight({
      packageId: pkg.id,
      artifacts,
      profile,
      graph,
      graphFreshness,
      accessibilityBlocked: accessibility.blocked,
      accessibilityIssueCount: accessibility.issues.length,
    });
    const qualitySummary = summarizeArtifactQuality(artifacts, profile.qualityThreshold);
    const qualityResults = buildQualityResult(artifacts, qualitySummary, profile.qualityThreshold);
    const traceabilityResults = buildTraceabilityResult(graph, artifacts.map((a) => a.id));
    const coverageResults = computeCoverage(profile, artifacts);
    const exportResults = computeExportResult(profile, artifacts);
    const approvalResults = computeApprovalResult(profile, pkg);

    const coverageBlockerFindings = coverageBlockers(coverageResults);
    const blockers = [...preflight.findings.filter((f) => f.blocking), ...coverageBlockerFindings];
    const warnings = preflight.warnings;

    // Weighted aggregate score.
    const score = clampPublicationScore(
      preflight.score * 0.35
      + qualityResults.score * 0.30
      + accessibility.score * 0.20
      + (traceabilityResults.verdict === 'blocked' ? 30
        : traceabilityResults.verdict === 'warning' ? 65 : 95) * 0.15,
    );

    // Traceability only counts toward the verdict when the profile requires it
    // — a profile that does not mandate traceability is not downgraded just
    // because the project has no architecture graph yet.
    const traceabilityCountsAgainst = profile.traceabilityRequired
      && traceabilityResults.verdict !== 'passed';
    const status: PublicationVerdict = blockers.length > 0
      ? 'blocked'
      : (warnings.length > 0 || exportResults.verdict !== 'passed'
        || traceabilityCountsAgainst || accessibility.verdict === 'warning')
        ? 'warning'
        : 'passed';

    const recommendations: PublicationAction[] = [
      ...preflight.requiredActions,
      ...preflight.optionalActions,
      ...accessibility.recommendations,
      ...coverageResults
        .filter((c) => !c.satisfied)
        .map((c) => ({
          id: newPrefixedId('pubact'),
          title: `Completar requisito: ${c.label}`,
          detail: c.message,
          priority: (c.required ? 'critical' : 'medium') as PublicationAction['priority'],
        })),
    ].slice(0, 24);

    const report: PublicationReadinessReport = {
      id: reportId(),
      packageId: pkg.id,
      profileId: profile.id,
      generatedAt: new Date().toISOString(),
      status,
      score,
      tier: publicationTierFromScore(score),
      blockers,
      warnings,
      recommendations,
      artifactResults: preflight.artifactResults,
      coverageResults,
      accessibilityResults: accessibility,
      traceabilityResults,
      qualityResults,
      exportResults,
      approvalResults,
      canPublish: blockers.length === 0 && artifacts.length > 0,
      canExport: preflight.canExport,
    };

    trackPublicationEvent('publication.readiness.evaluated',
      `Readiness del paquete "${pkg.name}": ${status} (puntaje ${score}).`,
      { packageId: pkg.id, status, score });

    return report;
  } catch {
    return {
      id: reportId(),
      packageId: pkg.id,
      profileId: profile.id,
      generatedAt: new Date().toISOString(),
      status: 'blocked',
      score: 0,
      tier: 'blocked',
      blockers: [{
        id: newPrefixedId('pubpf'),
        code: 'artifact-corrupt',
        severity: 'critical',
        blocking: true,
        message: 'La evaluación de readiness no pudo completarse.',
        recommendation: 'Reintenta la evaluación; revisa el centro de observabilidad si persiste.',
      }],
      warnings: [],
      recommendations: [],
      artifactResults: [],
      coverageResults: [],
      accessibilityResults: evaluatePublicationAccessibility([], profile.accessibilityLevel, 'package', pkg.id),
      traceabilityResults: buildTraceabilityResult(undefined, []),
      qualityResults: { score: 0, tier: 'blocked', belowThresholdArtifacts: [], message: 'No evaluado.' },
      exportResults: { availableFormats: [], missingFormats: profile.exportFormats, verdict: 'blocked', message: 'No evaluado.' },
      approvalResults: computeApprovalResult(profile, pkg),
      canPublish: false,
      canExport: false,
    };
  }
};

/* ------------------------------------------------------------------------- */
/* Publication report (Task 12)                                               */
/* ------------------------------------------------------------------------- */

const pct = (ratio: number): string => `${Math.round(clampPublicationScore(ratio * 100))}%`;

const bullets = (items: string[], empty: string): string =>
  items.length > 0 ? items.map((i) => `- ${i}`).join('\n') : `- ${empty}`;

/**
 * Render the human-facing publication report as Markdown. The output is fed to
 * the existing export adapters (MD / HTML / PDF / DOCX) by the orchestrator.
 */
export const buildPublicationReport = (
  pkg: PublicationPackage,
  profile: PublicationProfile,
  readiness: PublicationReadinessReport,
  projectName: string,
): PublicationReport => {
  const generatedAt = new Date().toISOString();
  const lines: string[] = [];

  lines.push(`# Reporte de publicación — ${pkg.name}`);
  lines.push('');
  lines.push(`**Proyecto:** ${projectName}`);
  lines.push(`**Paquete:** ${pkg.name} (versión ${pkg.version})`);
  lines.push(`**Perfil de publicación:** ${profile.name}`);
  lines.push(`**Audiencia:** ${profile.audience} · **Propósito:** ${profile.purpose}`);
  lines.push(`**Fecha:** ${generatedAt.slice(0, 10)}`);
  lines.push(`**Estado del paquete:** ${publicationStatusLabel(pkg.status)}`);
  lines.push(`**Frescura:** ${pkg.freshness}`);
  lines.push('');

  lines.push('## Veredicto global');
  lines.push('');
  lines.push(`- **Estado de readiness:** ${readiness.status}`);
  lines.push(`- **Puntaje global:** ${readiness.score}/100 (${publicationTierLabel(readiness.tier)})`);
  lines.push(`- **Puntaje de calidad:** ${readiness.qualityResults.score}/100`);
  lines.push(`- **Puntaje de accesibilidad:** ${readiness.accessibilityResults.score}/100`);
  lines.push(`- **Cobertura de trazabilidad (requerimientos):** ${pct(readiness.traceabilityResults.requirementCoverage)}`);
  lines.push(`- **Cobertura del grafo de arquitectura:** ${pct(readiness.traceabilityResults.graphCoverage)}`);
  lines.push(`- **¿Publicable?** ${readiness.canPublish ? 'Sí' : 'No'}`);
  lines.push('');

  lines.push('## Bloqueadores');
  lines.push('');
  lines.push(bullets(readiness.blockers.map((b) => b.message), 'Sin bloqueadores.'));
  lines.push('');

  lines.push('## Advertencias');
  lines.push('');
  lines.push(bullets(readiness.warnings.slice(0, 12).map((w) => w.message), 'Sin advertencias.'));
  lines.push('');

  lines.push('## Acciones requeridas');
  lines.push('');
  lines.push(bullets(
    readiness.recommendations.filter((r) => r.priority === 'critical' || r.priority === 'high')
      .map((r) => `${r.title} — ${r.detail}`),
    'Sin acciones requeridas.',
  ));
  lines.push('');

  lines.push('## Artefactos incluidos');
  lines.push('');
  lines.push('| Artefacto | Tipo | Versión | Calidad |');
  lines.push('|---|---|---|---|');
  for (const ref of pkg.artifactRefs) {
    lines.push(`| ${ref.name} | ${ref.type} | v${ref.version} | ${ref.compilerScore ?? '—'} (${ref.compilerTier ?? '—'}) |`);
  }
  if (pkg.artifactRefs.length === 0) lines.push('| _Sin artefactos_ | — | — | — |');
  lines.push('');

  lines.push('## Cobertura del perfil');
  lines.push('');
  lines.push(bullets(
    readiness.coverageResults.map((c) => `${c.satisfied ? 'OK' : 'PENDIENTE'} · ${c.label} — ${c.message}`),
    'Sin requisitos definidos.',
  ));
  lines.push('');

  lines.push('## Trazabilidad e inconsistencias');
  lines.push('');
  lines.push(`- ${readiness.traceabilityResults.message}`);
  lines.push(`- Requerimientos sin cobertura: ${readiness.traceabilityResults.uncoveredRequirementNames.length}`);
  lines.push(`- Riesgos sin mitigación: ${readiness.traceabilityResults.risksWithoutMitigationNames.length}`);
  lines.push(`- Inconsistencias del grafo: ${readiness.traceabilityResults.consistencyIssueCount}`);
  lines.push('');

  lines.push('## Formatos de exportación disponibles');
  lines.push('');
  lines.push(`- Disponibles: ${readiness.exportResults.availableFormats.join(', ') || '—'}`);
  lines.push(`- No disponibles para el perfil: ${readiness.exportResults.missingFormats.join(', ') || '—'}`);
  lines.push('');

  lines.push('## Aprobación');
  lines.push('');
  lines.push(`- ${readiness.approvalResults.message}`);
  if (pkg.approvedBy) lines.push(`- Aprobado por: ${pkg.approvedBy.name} (${pkg.approvedAt?.slice(0, 10) ?? '—'})`);
  lines.push('');

  lines.push('## Historial de auditoría');
  lines.push('');
  const recentAudit = pkg.auditTrail.slice(-10);
  lines.push(bullets(
    recentAudit.map((e) => `${e.timestamp.slice(0, 16).replace('T', ' ')} · ${e.action} · ${e.actor.name} — ${e.details}`),
    'Sin entradas de auditoría.',
  ));
  lines.push(`- Overrides usados: ${countOverrides(pkg)}`);
  lines.push('');

  lines.push('## Recomendaciones');
  lines.push('');
  lines.push(bullets(
    readiness.recommendations.map((r) => `${r.title} — ${r.detail}`),
    'Sin recomendaciones.',
  ));
  lines.push('');
  lines.push('---');
  lines.push('_Generado por el Pipeline de Publicación Profesional de Arky Pro._');

  const summary = `Reporte de publicación de "${pkg.name}" (proyecto ${projectName}): estado ${readiness.status}, `
    + `puntaje ${readiness.score}/100, ${readiness.blockers.length} bloqueador(es), `
    + `${readiness.warnings.length} advertencia(s). ${readiness.canPublish ? 'Publicable.' : 'No publicable.'}`;

  return {
    id: newPrefixedId('pubreport'),
    packageId: pkg.id,
    generatedAt,
    markdown: lines.join('\n'),
    summary,
  };
};
