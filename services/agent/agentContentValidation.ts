/**
 * Whether what an agent action produced may replace what the artifact holds
 * (plan de calidad de artefactos, 7.1a).
 *
 * Out of `agentExecutor` so the executor orchestrates and this decides: the
 * gate grew a content-preservation rule — the one the chat and the refinement
 * apply too — and the executor was already over its size ceiling.
 */
import type { Artifact } from '../../lib/artifacts';
import { checkContentPreservation } from '../../lib/artifacts';
import { assessDocumentArtifact } from '../quality';
import { runDiagramQualityGate } from '../diagram';
import type { AgentActionResult } from './agentTypes';

/**
 * Lightweight quality gate. For diagrams that have an IR field we run the
 * existing deterministic gate. For everything else we apply structural sanity
 * checks (non-empty, length sanity, no truncation markers). This is a
 * pre-flight — the canvas-level renderability gate still runs on the actual
 * persisted artifact when the user navigates to it.
 */
export const validateArtifactContent = (
  artifact: Artifact,
  newContent: string,
  options: { permitsRemoval?: boolean } = {},
): NonNullable<AgentActionResult['validationResult']> => {
  const trimmed = newContent.trim();
  if (trimmed.length === 0) {
    return { passed: false, summary: 'El contenido generado está vacío.' };
  }
  if (trimmed.length < 16) {
    return { passed: false, summary: 'El contenido generado es demasiado corto para ser válido.' };
  }
  if (/```\s*$/m.test(trimmed) && !/```[\s\S]*```/.test(trimmed)) {
    return { passed: false, summary: 'El contenido contiene un bloque de código sin cerrar.' };
  }
  // Document-quality parity with the Workspace generation gate: agent paths
  // (improve / patch / applySuggestion) bypass `generateArtifactContent`, so
  // without this check a truncated or gutted document would persist silently.
  // We fail only on hard signals (truncation, drastic shrinkage); structural
  // warnings pass through with the score in the summary.
  if (artifact.representation === 'document' && artifact.type !== 'yaml' && !artifact.ir) {
    const assessment = assessDocumentArtifact(trimmed, { expectStructuredDocument: true });
    if (assessment.truncated) {
      const issues = assessment.issues.map((i) => i.message).join(' · ');
      return { passed: false, summary: `El documento llegó truncado: ${issues}`, score: assessment.score };
    }
    // What a rewrite may not lose is the one policy the chat and the
    // refinement apply too (plan de calidad de artefactos, 7.1a).
    const preservation = checkContentPreservation(artifact.content ?? '', trimmed, {
      mode: 'document',
      permitsRemoval: options.permitsRemoval,
    });
    if (!preservation.ok) {
      return { passed: false, summary: preservation.reason, score: assessment.score };
    }
    return {
      passed: true,
      summary: assessment.ok
        ? `Documento válido (calidad estimada ${assessment.score}/100).`
        : `Documento aceptado con advertencias (${assessment.issues.map((i) => i.code).join(', ')}) — calidad estimada ${assessment.score}/100.`,
      score: assessment.score,
    };
  }

  // A hybrid carries prose, sections and tables beside its diagram, and loses
  // them the same way a document does.
  if (artifact.representation === 'hybrid') {
    const preservation = checkContentPreservation(artifact.content ?? '', trimmed, {
      mode: 'hybrid',
      permitsRemoval: options.permitsRemoval,
    });
    if (!preservation.ok) return { passed: false, summary: preservation.reason };
  }

  // Diagram-specific: if we already have an IR snapshot, run the existing
  // deterministic quality gate. We only USE its score; we don't apply its
  // automatic rewrites (those are reserved for the explicit "Auto-mejorar"
  // button so the user retains control over deterministic patches).
  if (artifact.ir) {
    try {
      const gate = runDiagramQualityGate(artifact.ir, {
        artifact: {
          name: artifact.name,
          type: artifact.type,
          objective: artifact.objective,
          audience: artifact.audience,
          theme: artifact.theme,
        },
        audience: artifact.audience ?? 'technical',
        targetScore: 60,
        maxPasses: 1,
      });
      return {
        passed: gate.quality.score >= 40,
        summary:
          gate.quality.score >= 40
            ? `Calidad estimada ${gate.quality.score}/100.`
            : `Calidad estimada ${gate.quality.score}/100 — por debajo del umbral mínimo (40).`,
        score: gate.quality.score,
      };
    } catch {
      // Fall through to "structural OK".
    }
  }
  return { passed: true, summary: 'Contenido estructuralmente válido.' };
};
