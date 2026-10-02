/**
 * The request-fidelity verdict of a generated diagram, as the run records and
 * tells it (plan de diagramas, 6.3).
 *
 * The verifier is `checkRequestFidelity` in `services/diagram`; this decides
 * what the run does with its answer. Nothing is blocked — a diagram that
 * misses a criterion is still the architect's to fix, and refusing to save it
 * would lose the work — but nothing is silent either: every gap goes to the
 * trace, and the person who generated the diagram is told in one sentence.
 */
import type { ArtifactTemplate } from '../../../types';
import type { ArtifactGenerationTraceStep } from '../../../lib/artifacts';
import type { DiagramIR } from '../../../lib/diagram';
import { checkRequestFidelity, fidelityLosses, type FidelityReport } from '../../diagram';
import { isSkeletonFallbackContent } from '../domain/deterministicArtifactFallbacks';
import { makeTraceStep } from '../domain/artifactGenerationTrace';

export interface DiagramFidelityReview {
    report: FidelityReport;
    steps: ArtifactGenerationTraceStep[];
    /** One sentence for the person, when something they asked for is missing. */
    warning: string | null;
}

const MAX_LISTED = 3;

/**
 * The request's checks against a diagram text and its IR — the one reading of
 * what was asked, shared by the review after a run and by the refinement,
 * which may not lose what holds (plan de diagramas, 8.2d).
 */
export function diagramFidelityReport(
    template: ArtifactTemplate,
    content: string,
    ir: DiagramIR | null,
    skeleton = false,
): FidelityReport {
    const body = template.type === 'hybrid-text-diagram'
        ? content.match(/```mermaid\s*([\s\S]*?)```/i)?.[1] ?? ''
        : content;
    const request = template.requestContext;
    return checkRequestFidelity({
        artifactType: template.type,
        content: body,
        ir,
        skeleton,
        request: request ? {
            userRequest: request.userRequest,
            acceptanceCriteria: request.generationContract?.acceptanceCriteria?.length
                ? request.generationContract.acceptanceCriteria
                : request.acceptanceCriteria,
            audience: request.audience,
        } : undefined,
    });
}

export function reviewDiagramFidelity(
    template: ArtifactTemplate,
    content: string,
    ir: DiagramIR | null,
    /** The run's fallback put a skeleton in, and already told the person. */
    skeleton: boolean,
    /** What the generation path said when it saved something other than what was asked. */
    degradations: readonly string[] = [],
): DiagramFidelityReview {
    const report = diagramFidelityReport(template, content, ir, skeleton || isSkeletonFallbackContent(content));
    const steps = [
        ...degradations.map((message) => makeTraceStep('ai-generation', 'warning', message)),
        ...report.checks.map((check) => makeTraceStep(
            'validation',
            check.status === 'ok' ? 'success' : 'warning',
            `Fidelidad a la solicitud · ${check.message}`,
        )),
    ];
    // The path's own reason says more than the generic notation or skeleton
    // check, and saying both would tell the person the same thing twice.
    // `skeleton` means the run's own fallback already warned about it.
    const pending = report.warnings.filter((check) => (degradations.length
        ? check.kind !== 'dialect' && check.kind !== 'skeleton'
        : !(skeleton && check.kind === 'skeleton')));
    const messages = [...degradations, ...pending.map((check) => check.message)];
    const listed = messages.slice(0, MAX_LISTED);
    const more = messages.length - listed.length;
    const warning = messages.length === 0
        ? null
        : `Revisa «${template.name}»: ${listed.join(' ')}${more > 0 ? ` (y ${more} aviso${more === 1 ? '' : 's'} más en la traza)` : ''}`;
    return { report, steps, warning };
}

/**
 * Why a refinement candidate may not replace the diagram, or `null`: a higher
 * score does not buy a diagram of something else (plan de diagramas, 8.2d).
 * Only a request has something to lose.
 */
export function describeFidelityLoss(
    template: ArtifactTemplate,
    baselineContent: string,
    baselineIR: DiagramIR | null | undefined,
    candidateContent: string,
    candidateIR: DiagramIR | null | undefined,
): string | null {
    if (!template.requestContext) return null;
    const losses = fidelityLosses(
        diagramFidelityReport(template, baselineContent, baselineIR ?? null),
        diagramFidelityReport(template, candidateContent, candidateIR ?? null),
    );
    return losses.length > 0
        ? `La mejora propuesta deja de cumplir lo pedido: ${losses.map((l) => `«${l.target}»`).join(', ')}.`
        : null;
}
