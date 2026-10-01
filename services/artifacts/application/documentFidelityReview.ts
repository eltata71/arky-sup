/**
 * A generated document is checked against the request, corrected once at
 * most, and never degrades in silence (plan de calidad de artefactos, 7.4c) —
 * the document counterpart of `diagramFidelityReview` and `correctDiagramOnce`.
 *
 * The correction is the evaluator-optimizer kept cheap: the evaluation is
 * deterministic (`checkDocumentFidelity`), and only a *fixable* gap — a
 * required section missing, a name the request committed to, the executive
 * summary — spends one patch call. The patch is kept only if it closes gaps
 * and loses nothing (`checkContentPreservation`); otherwise the original
 * stays, and what is still missing is told to the person in one sentence.
 */
import type { ArtifactTemplate, Settings } from '../../../types';
import type { Artifact, ArtifactGenerationTraceStep } from '../../../lib/artifacts';
import { checkContentPreservation } from '../../../lib/artifacts';
import type { Project } from '../../architectureProjects';
import { makeTraceStep } from '../domain/artifactGenerationTrace';
import { checkDocumentFidelity, describeFidelityGaps, type DocumentFidelityReport } from './documentFidelity';
import { proposeDocumentModification } from './documentModification';

export interface DocumentFidelityReview {
  /** The document to persist: corrected when the correction was kept. */
  content: string;
  report: DocumentFidelityReport;
  corrected: boolean;
  steps: ArtifactGenerationTraceStep[];
  /** One sentence for the person, when something they asked for is still missing. */
  warning: string | null;
}

const MAX_LISTED = 3;

const fixableCount = (report: DocumentFidelityReport): number => report.warnings.filter((check) => check.fixable).length;

/** Whether a template's output is a document this review reads: prose, not a diagram nor YAML. */
const isReviewableDocument = (template: ArtifactTemplate): boolean =>
  template.representation === 'document' && template.type !== 'yaml'
  && !template.type.startsWith('mermaid') && template.type !== 'react-flow-graph';

/** `null` for anything that is not a document — a diagram has its own review. */
export async function reviewDocumentFidelity(params: {
  template: ArtifactTemplate;
  content: string;
  project: Project;
  settings: Settings;
}): Promise<DocumentFidelityReview | null> {
  const { template, project, settings } = params;
  if (!isReviewableDocument(template)) return null;
  const request = template.requestContext;
  const check = (content: string) => checkDocumentFidelity({
    templateName: template.name,
    content,
    request: request ? {
      userRequest: request.userRequest,
      acceptanceCriteria: request.generationContract?.acceptanceCriteria?.length
        ? request.generationContract.acceptanceCriteria
        : request.acceptanceCriteria,
      audience: request.audience,
    } : undefined,
  });

  let content = params.content;
  let report = check(content);
  let corrected = false;
  const steps: ArtifactGenerationTraceStep[] = [];
  const instruction = describeFidelityGaps(report);
  if (instruction) {
    const stub = { name: template.name, objective: template.objective, representation: 'document', content } as Artifact;
    const outcome = await proposeDocumentModification({ artifact: stub, instruction, project }, settings);
    if (outcome.kind === 'proposal') {
      const after = check(outcome.content);
      const preserved = checkContentPreservation(content, outcome.content, { mode: 'document' });
      if (fixableCount(after) < fixableCount(report) && preserved.ok) {
        steps.push(makeTraceStep('refinement', 'success', `Corrección de fidelidad aplicada: ${outcome.applied.join(' ')}`));
        content = outcome.content;
        report = after;
        corrected = true;
      } else {
        steps.push(makeTraceStep('refinement', 'warning', preserved.ok
          ? 'La corrección de fidelidad no cerró ninguna brecha y se descartó.'
          : `La corrección de fidelidad se descartó: ${preserved.reason}`));
      }
    } else if (outcome.kind === 'refused') {
      steps.push(makeTraceStep('refinement', 'warning', `No se pudo corregir la fidelidad: ${outcome.reason}`));
    }
  }

  for (const item of report.checks) {
    steps.push(makeTraceStep('validation', item.status === 'ok' ? 'success' : 'warning', `Fidelidad a la solicitud · ${item.message}`));
  }
  const messages = report.warnings.map((item) => item.message);
  const listed = messages.slice(0, MAX_LISTED);
  const more = messages.length - listed.length;
  const warning = messages.length === 0
    ? null
    : `Revisa «${template.name}»: ${listed.join(' ')}${more > 0 ? ` (y ${more} aviso${more === 1 ? '' : 's'} más en la traza)` : ''}`;
  return { content, report, corrected, steps, warning };
}
