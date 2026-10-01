/**
 * One bounded correction of a generated diagram (plan de diagramas, 6.3).
 *
 * `generateAndRefineDiagramIR` — draft, critique, refine — existed and
 * nothing called it: production took the first answer the model gave. It
 * also rewrote the whole IR to apply a critique, so a correction could move
 * ids and lose the parts nobody flagged; it was removed with this task.
 * This is the evaluator-optimizer pattern the Office's consolidator already
 * uses, kept cheap and kept safe:
 *
 * - **The evaluation is deterministic.** Architectural violations of high
 *   severity, and the request-fidelity gaps (a named element, a criterion, the
 *   audience) — no model is asked whether the diagram is good.
 * - **At most one call, and only when there is a finding.** A clean diagram
 *   costs nothing extra; a flawed one costs exactly one proposal.
 * - **The correction is a semantic patch**, proposed by the diagram edit
 *   vertical and applied by the engine: ids stay, nothing unflagged moves,
 *   and every operation is checked before it lands.
 * - **It is kept only if it does not make things worse.** A correction that
 *   closes a fidelity gap may cost up to five points of the heuristic quality
 *   score — adding what the person asked for outweighs a visual heuristic,
 *   the tolerance `generateAndRefineDiagramIR` already used. One that closes
 *   none must not lower the score at all. Otherwise the first answer stands.
 * - **Criteria do not trigger it.** Their check is a word match that reports
 *   "no evidence", honestly unverified; spending a call to chase a string
 *   would make the model write words, not satisfy the criterion.
 *
 * Applying without a person's click is right here and wrong in the editor:
 * this runs before anything is saved, on the system's own draft, and the
 * change is reported in the generation trace.
 */
import type { ArtifactType, Settings } from '../../../../types';
import type { ArtifactContextPorts } from '../../../../lib/artifacts';
import type { DiagramAudience, DiagramIR } from '../../../../lib/diagram';
import { analyzeDiagramQuality, checkRequestFidelity, detectArchitecturalViolations } from '../../../diagram';
import { diagramEditService } from '../diagramEdit/diagramEditService';

export interface SelfCorrectionInput extends Pick<ArtifactContextPorts, 'onContextCaptured'> {
    artifactType: ArtifactType;
    audience: DiagramAudience;
    request?: {
        userRequest?: string;
        acceptanceCriteria?: readonly string[];
        audience?: 'technical' | 'executive' | 'mixed';
    };
    /** Grounding for the proposal: the artifact's objective and the project. */
    context?: string;
}

export interface SelfCorrectionOutcome {
    ir: DiagramIR;
    /** True when a correction was applied and kept. */
    corrected: boolean;
    /** Why nothing was done, or what was done — for the trace. */
    note: string;
    findings: string[];
    /** Model calls spent: 0 or 1. */
    calls: number;
}

const MAX_FINDINGS = 8;

/** What is wrong with the diagram, in sentences a model can act on. */
export function diagramFindings(ir: DiagramIR, input: SelfCorrectionInput): string[] {
    const violations = detectArchitecturalViolations(ir, { type: input.artifactType, audience: input.audience })
        .filter((violation) => violation.severity === 'critical' || violation.severity === 'high')
        .map((violation) => `${violation.message} → ${violation.recommendation}`);
    const fidelity = checkRequestFidelity({ artifactType: '', content: '', ir, request: input.request })
        .warnings
        .filter((check) => check.kind === 'entity' || check.kind === 'audience')
        .map((check) => check.message);
    return [...fidelity, ...violations].slice(0, MAX_FINDINGS);
}

const fidelityGaps = (ir: DiagramIR, input: SelfCorrectionInput): number =>
    checkRequestFidelity({ artifactType: '', content: '', ir, request: input.request }).warnings.length;

/** How many quality points closing a fidelity gap may cost. */
const QUALITY_TOLERANCE_FOR_FIDELITY = 5;

export async function correctDiagramOnce(
    ir: DiagramIR,
    input: SelfCorrectionInput,
    settings: Settings,
): Promise<SelfCorrectionOutcome> {
    const findings = diagramFindings(ir, input);
    if (findings.length === 0) {
        return { ir, corrected: false, note: 'Sin hallazgos: no hace falta corregir.', findings, calls: 0 };
    }

    const proposal = await diagramEditService.proposeEdit({
        ir,
        instruction: [
            'Corrige estos hallazgos del diagrama que acabas de generar, con el cambio mínimo y sin tocar lo que no se menciona:',
            ...findings.map((finding) => `- ${finding}`),
        ].join('\n'),
        context: input.context,
        onContextCaptured: input.onContextCaptured,
    }, settings);
    if (!proposal.ok || !proposal.preview) {
        return { ir, corrected: false, note: `No se aplicó corrección: ${proposal.reason || 'sin propuesta'}.`, findings, calls: 1 };
    }

    const candidate = proposal.preview.ir;
    const before = analyzeDiagramQuality(ir).score;
    const after = analyzeDiagramQuality(candidate).score;
    const gapsBefore = fidelityGaps(ir, input);
    const gapsAfter = fidelityGaps(candidate, input);
    const tolerance = gapsAfter < gapsBefore ? QUALITY_TOLERANCE_FOR_FIDELITY : 0;
    if (gapsAfter > gapsBefore || after < before - tolerance) {
        return {
            ir,
            corrected: false,
            note: `Se descartó la corrección porque empeoraba el diagrama (calidad ${before} → ${after}).`,
            findings,
            calls: 1,
        };
    }
    return {
        ir: candidate,
        corrected: true,
        note: `Corrección aplicada (${proposal.preview.applied.length} operaciones, calidad ${before} → ${after})${proposal.patch?.rationale ? `: ${proposal.patch.rationale}` : ''}.`,
        findings,
        calls: 1,
    };
}
