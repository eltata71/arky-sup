/**
 * Lo que un revisor de la Oficina recibe: la evidencia determinista —los
 * validadores de la Oficina y el compilador de artefactos, que mandan sobre el
 * modelo— y el prompt de revisión, con el contenido vallado y el aviso de
 * recorte (plan de agentes, 17.0). Separado de `OfficeRunnerAdapters` cuando
 * aquél pasó su techo de tamaño; el comportamiento no cambió.
 */
import type { Artifact } from '../../../lib/artifacts';
import { wrapUntrustedContent } from '../../../lib/untrustedContent';
import { compileArtifact } from '../../artifactCompiler';
import { validateOfficeArtifact } from '../domain/officeArtifactValidators';
import type { OfficeReviewFinding, OfficeTask } from '../domain/OfficeTypes';

export interface DeterministicReviewEvidence {
  findings: OfficeReviewFinding[];
  blockingValidatorIds: string[];
  score?: number;
  blocking: boolean;
}

export const gatherDeterministicEvidence = (artifact: Artifact): DeterministicReviewEvidence => {
  const findings: OfficeReviewFinding[] = [];
  const blockingValidatorIds: string[] = [];

  const validation = validateOfficeArtifact(artifact);
  for (const result of validation.results) {
    if (!result.passed) blockingValidatorIds.push(result.validatorId);
    for (const issue of result.issues) {
      findings.push({
        severity: issue.severity === 'error' ? 'high' : 'medium',
        message: issue.message,
        evidence: `${result.validatorId}:${issue.code}`,
      });
    }
  }

  // `applyRepairs: false` — the reviewer reports what the producer actually
  // delivered, not what auto-repair could have salvaged.
  const compilation = compileArtifact(artifact, { applyRepairs: false, source: 'manual' });
  const score = compilation.score.value;
  for (const issue of compilation.issues.critical) {
    findings.push({ severity: 'critical', message: issue.message, evidence: compilation.contractId });
  }
  for (const issue of compilation.issues.high) {
    findings.push({ severity: 'high', message: issue.message, evidence: compilation.contractId });
  }

  return {
    findings,
    blockingValidatorIds,
    score,
    blocking: validation.blocking || compilation.issues.critical.length > 0,
  };
};

/** Cuánto contenido ve el revisor. Lo que pasa de aquí se recorta y se dice. */
export const REVIEW_CONTENT_LIMIT = 12_000;

export const buildReviewPrompt = (
  task: OfficeTask,
  artifact: Artifact,
  evidence: DeterministicReviewEvidence,
): string => {
  // La persona del revisor va en el prompt de sistema (`chatWithProject` con
  // `personaOverride`); aquí sólo el encargo (plan de agentes, 16.0).
  return [
    'Revisas el trabajo de otro arquitecto de la Oficina.',
    '',
    `ARTEFACTO: ${artifact.name} (${artifact.type})`,
    `OBJETIVO DECLARADO: ${artifact.objective}`,
    '',
    // El contenido revisado no lo escribió la aplicación: viaja vallado, y si
    // se recorta se dice (plan de agentes, 17.0 y 17.1).
    wrapUntrustedContent('contenido del artefacto', artifact.content.slice(0, REVIEW_CONTENT_LIMIT)),
    ...(artifact.content.length > REVIEW_CONTENT_LIMIT
      ? [`(Contenido recortado: se muestran ${REVIEW_CONTENT_LIMIT} de ${artifact.content.length} caracteres. No juzgues lo que no ves.)`]
      : []),
    '',
    'CRITERIOS DE ACEPTACIÓN:',
    ...task.acceptanceCriteria.map((item) => `- ${item}`),
    '',
    'HALLAZGOS DETERMINISTAS YA DETECTADOS (no los repitas, complétalos):',
    evidence.findings.length > 0
      ? evidence.findings.map((finding) => `- [${finding.severity}] ${finding.message}`).join('\n')
      : '- ninguno',
    evidence.score !== undefined ? `\nPUNTUACIÓN DEL COMPILADOR: ${evidence.score}/100` : '',
    '',
    'Emite un veredicto sobre si el artefacto es utilizable como entregable de la Oficina.',
    'No inventes defectos: cada hallazgo debe citar algo presente o ausente en el contenido.',
    'Responde únicamente con JSON: {"verdict":"approved"|"changes-requested"|"rejected","summary":"...","findings":[{"severity":"critical"|"high"|"medium"|"low","message":"...","evidence":"..."}]}',
  ].join('\n');
};

