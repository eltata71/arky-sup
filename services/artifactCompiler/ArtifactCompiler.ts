/**
 * Artifact Compiler — the orchestration core.
 *
 * `compileArtifact` is a formal stage between artifact generation/normalization
 * and persistence. It resolves a contract, validates, applies safe repairs,
 * scores, evaluates exportability and produces a structured, traceable result.
 *
 * Guarantees:
 *  - It NEVER throws. Any internal failure yields a safe `failed` result with
 *    the original artifact untouched, so the UI never gets a blank screen.
 *  - It NEVER mutates the input artifact. Repairs produce a new object; when no
 *    repair is applied, `compiled` is reference-equal to `original`.
 *  - Diagram quality stays owned by the existing deterministic diagram gate.
 */

import type { Artifact } from '../../lib/artifacts';
import { buildArtifactExportabilityState } from '../quality/artifactQualityGateService';
import { CompilationTraceRecorder } from './ArtifactCompilationTrace';
import { type ArtifactContract, compareSeverity } from './ArtifactContract';
import type {
  ArtifactCompilerSummary,
  CompileArtifactOptions,
  CompilationStatus,
  CompilationTier,
  CompiledArtifactResult,
  CompilerExportReadiness,
  CompilerIssue,
  CompilerIssueGroups,
  CompilerRecommendation,
  CompilerRepair,
} from './ArtifactCompilerTypes';
import { resolveContract } from './ArtifactContractRegistry';
import { computeArtifactCompilationSignature } from './artifactSignature';
import { repairAgainstContract } from './repair';
import { computeUnifiedScore, tierSummary } from './scoring';
import { validateAgainstContract, type ContractValidationResult } from './validators';

const EMPTY_GROUPS = (): CompilerIssueGroups => ({
  critical: [],
  high: [],
  medium: [],
  low: [],
  info: [],
});

const groupIssues = (issues: CompilerIssue[]): CompilerIssueGroups => {
  const groups = EMPTY_GROUPS();
  for (const issue of issues) groups[issue.severity].push(issue);
  return groups;
};

/** Drop duplicate findings that share an issue code (keeps the first seen). */
const dedupeIssues = (issues: CompilerIssue[]): CompilerIssue[] => {
  const seen = new Set<string>();
  const out: CompilerIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.code}|${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out.sort((a, b) => compareSeverity(a.severity, b.severity));
};

const artifactHasRenderableContent = (artifact: Artifact): boolean => {
  const content = (artifact.content ?? '').trim();
  return content.length > 0 || (artifact.ir?.nodes?.length ?? 0) > 0;
};

const resolveCanRender = (
  artifact: Artifact,
  contract: ArtifactContract,
  hasDiagram: boolean,
): boolean => {
  const content = (artifact.content ?? '').trim();
  if (contract.representation === 'document') return content.length > 0;
  if (contract.representation === 'diagram') return hasDiagram;
  return content.length > 0 || hasDiagram;
};

const buildRecommendations = (
  issues: CompilerIssue[],
  contract: ArtifactContract,
): CompilerRecommendation[] => {
  const recommendations: CompilerRecommendation[] = [];
  const seenCodes = new Set<string>();
  for (const issue of issues) {
    if (issue.severity === 'info' || issue.severity === 'low') continue;
    if (seenCodes.has(issue.code)) continue;
    seenCodes.add(issue.code);
    recommendations.push({
      id: `rec.${issue.id}`,
      title: issue.message,
      detail: issue.recommendation,
      priority: issue.severity === 'critical' || issue.severity === 'high' ? 'high' : 'medium',
    });
    if (recommendations.length >= 5) break;
  }
  for (const auto of contract.automaticRecommendations) {
    if (recommendations.length >= 7) break;
    if (seenCodes.has(auto.id)) continue;
    recommendations.push({ id: auto.id, title: auto.title, detail: auto.detail, priority: 'low' });
  }
  return recommendations;
};

const resolveStatus = (
  tier: CompilationTier,
  repairs: CompilerRepair[],
  groups: CompilerIssueGroups,
): CompilationStatus => {
  if (tier === 'blocked') return 'blocked';
  if (repairs.length > 0) return 'repaired';
  if ((tier === 'ready' || tier === 'world-class') && groups.high.length === 0) return 'passed';
  return 'warning';
};

const buildFailedResult = (
  artifact: Artifact,
  recorder: CompilationTraceRecorder,
  error: unknown,
): CompiledArtifactResult => {
  const message = error instanceof Error ? error.message : String(error);
  recorder.step('finalize', 'error', 'La compilación falló de forma controlada.', message);
  const issue: CompilerIssue = {
    id: 'compiler.internal-error',
    code: 'COMPILER_INTERNAL_ERROR',
    severity: 'high',
    source: 'compiler',
    message: 'El compilador no pudo evaluar el artefacto.',
    recommendation: 'El artefacto se conserva sin cambios; revisa el contenido o reintenta la compilación.',
  };
  const groups = groupIssues([issue]);
  const exportReadiness: CompilerExportReadiness = {
    document: false,
    diagram: false,
    table: false,
    any: false,
  };
  return {
    original: artifact,
    compiled: artifact,
    contractId: 'contract.unknown',
    contractLabel: 'Desconocido',
    status: 'failed',
    score: { value: 0, tier: 'blocked', dimensions: [], summary: tierSummary('blocked') },
    issues: groups,
    repairs: [],
    recommendations: [],
    // The compiler failing must NOT prevent the app from rendering the artifact.
    canRender: artifactHasRenderableContent(artifact),
    canExport: false,
    exportReadiness,
    requiresHumanReview: true,
    trace: recorder.build({
      artifactId: artifact.id,
      contractId: 'contract.unknown',
      status: 'failed',
      score: 0,
      tier: 'blocked',
      repairs: [],
    }),
  };
};

/**
 * Compile an artifact candidate. Returns a structured, traceable result and
 * never throws.
 */
export const compileArtifact = (
  artifact: Artifact,
  options: CompileArtifactOptions = {},
): CompiledArtifactResult => {
  const recorder = new CompilationTraceRecorder();
  const applyRepairs = options.applyRepairs !== false;

  try {
    // 1 — Contract resolution.
    const contract = resolveContract(artifact.type);
    recorder.step(
      'contract-resolution',
      'success',
      `Contrato aplicado: ${contract.label}.`,
      `representación=${contract.representation} · origen=${options.source ?? 'unknown'}`,
    );

    // 2 — Pre-validation.
    const preValidation = validateAgainstContract(artifact, contract);
    recorder.step(
      'pre-validation',
      preValidation.issues.some((i) => i.severity === 'critical')
        ? 'error'
        : preValidation.issues.length > 0
          ? 'warning'
          : 'success',
      `Validación de contrato: ${preValidation.issues.length} hallazgo(s).`,
    );

    // 3 — Safe repair (documents/hybrids only; never diagrams or empty docs).
    let compiled = artifact;
    let appliedRepairs: CompilerRepair[] = [];
    const repairEligible = applyRepairs
      && contract.representation !== 'diagram'
      && (artifact.content ?? '').trim().length > 0;
    if (repairEligible) {
      const outcome = repairAgainstContract({
        content: artifact.content ?? '',
        contract,
        validation: preValidation,
        artifactName: artifact.name ?? 'Artefacto',
      });
      if (outcome.repairs.length > 0) {
        compiled = { ...artifact, content: outcome.content };
        appliedRepairs = outcome.repairs;
        recorder.step(
          'repair',
          'success',
          `Se aplicaron ${appliedRepairs.length} reparación(es) segura(s) no destructiva(s).`,
          appliedRepairs.map((r) => r.id).join(', '),
        );
      } else {
        recorder.step('repair', 'skipped', 'No se requirieron reparaciones.');
      }
    } else {
      recorder.step(
        'repair',
        'skipped',
        applyRepairs ? 'Reparación no aplicable a este artefacto.' : 'Reparación deshabilitada por el llamador.',
      );
    }

    // 4 — Post-validation (re-run only when content actually changed).
    const postValidation: ContractValidationResult = appliedRepairs.length > 0
      ? validateAgainstContract(compiled, contract)
      : preValidation;
    recorder.step(
      'post-validation',
      postValidation.issues.some((i) => i.severity === 'critical') ? 'error' : 'success',
      `Estado tras reparación: ${postValidation.issues.length} hallazgo(s) restante(s).`,
    );

    // 5 — Unified scoring.
    const scoreResult = computeUnifiedScore(compiled, postValidation);
    recorder.step(
      'scoring',
      scoreResult.tier === 'blocked' ? 'error' : 'success',
      `Score de compilación: ${scoreResult.value}/100 (${scoreResult.tier}).`,
    );

    // 6 — Export evaluation (delegates to the existing export quality gate).
    const exportability = buildArtifactExportabilityState(compiled, {
      report: scoreResult.qualityReport,
    });
    const exportReadiness: CompilerExportReadiness = {
      document: exportability.state.document.passed,
      diagram: exportability.state.diagram.passed,
      table: exportability.state.table.passed,
      any:
        exportability.state.document.passed
        || exportability.state.diagram.passed
        || exportability.state.table.passed,
    };
    recorder.step(
      'export-evaluation',
      exportReadiness.any ? 'success' : 'warning',
      `Exportabilidad — documento:${exportReadiness.document} diagrama:${exportReadiness.diagram} tabla:${exportReadiness.table}.`,
    );

    // 7 — Consolidate findings and finalise.
    const mergedIssues = dedupeIssues([...postValidation.issues, ...scoreResult.qualityIssues]);
    const groups = groupIssues(mergedIssues);
    const status = resolveStatus(scoreResult.tier, appliedRepairs, groups);
    const recommendations = buildRecommendations(mergedIssues, contract);
    const canRender = resolveCanRender(compiled, contract, postValidation.hasDiagram);
    const canExport = exportReadiness.any && status !== 'blocked' && status !== 'failed';
    const requiresHumanReview = status !== 'passed';

    recorder.step(
      'finalize',
      status === 'blocked' ? 'error' : status === 'passed' ? 'success' : 'warning',
      `Compilación finalizada con estado "${status}".`,
      `revisión humana=${requiresHumanReview}`,
    );

    return {
      original: artifact,
      compiled,
      contractId: contract.id,
      contractLabel: contract.label,
      status,
      score: {
        value: scoreResult.value,
        tier: scoreResult.tier,
        dimensions: scoreResult.dimensions,
        summary: tierSummary(scoreResult.tier),
      },
      issues: groups,
      repairs: appliedRepairs,
      recommendations,
      canRender,
      canExport,
      exportReadiness,
      requiresHumanReview,
      trace: recorder.build({
        artifactId: artifact.id,
        contractId: contract.id,
        status,
        score: scoreResult.value,
        tier: scoreResult.tier,
        repairs: appliedRepairs,
      }),
    };
  } catch (error) {
    return buildFailedResult(artifact, recorder, error);
  }
};

/** Project a compilation result onto the persistable summary block (Task 10). */
export const buildCompilerSummary = (result: CompiledArtifactResult): ArtifactCompilerSummary => ({
  compilerContractId: result.contractId,
  compilerContractLabel: result.contractLabel,
  compilerStatus: result.status,
  compilerScore: result.score.value,
  compilerTier: result.score.tier,
  compilerIssues: {
    critical: result.issues.critical.length,
    high: result.issues.high.length,
    medium: result.issues.medium.length,
    low: result.issues.low.length,
    info: result.issues.info.length,
  },
  compilerRepairs: result.repairs.map((r) => r.description),
  compilerRecommendations: result.recommendations.map((r) => r.title),
  compiledAt: new Date().toISOString(),
  requiresHumanReview: result.requiresHumanReview,
  exportReadiness: result.exportReadiness,
  // Freshness is `current` the instant the summary is written; `sourceSignature`
  // fingerprints the artifact this summary actually describes, so later flows
  // can detect when the artifact drifts away from it (Task 5/6).
  compilationFreshness: 'current',
  sourceSignature: computeArtifactCompilationSignature(result.compiled),
});
