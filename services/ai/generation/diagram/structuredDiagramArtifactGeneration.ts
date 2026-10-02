/** IR generation and one bounded correction for flowcharts and React Flow (8.2c). */
import type { ArtifactTemplate, Settings } from '../../../../types';
import type { Artifact } from '../../../../lib/artifacts';
import type { DiagramAudience, DiagramIR } from '../../../../lib/diagram';
import type { Project } from '../../../architectureProjects';
import { serializeFlowArtifact } from '../../../diagram';
import type { ArtifactContentGenerationOptions } from '../artifacts/artifactGenerationSupport';
import { buildDiagramTextBrief } from './diagramTextBrief';
import { generateDiagramIRWithSelfHealing } from './diagramIRGeneration';
import { correctDiagramOnce } from './diagramSelfCorrection';

function requestedAudience(template: ArtifactTemplate, previous?: Artifact): DiagramAudience {
    const asked = template.requestContext?.audience;
    if (asked === 'executive' || asked === 'technical') return asked;
    return previous?.audience ?? 'technical';
}

function serializeDiagram(ir: DiagramIR, type: ArtifactTemplate['type']): string {
    return serializeFlowArtifact(ir, type === 'react-flow-graph' ? 'react-flow-graph' : 'mermaid-graph');
}

export async function generateStructuredDiagramArtifactContent(
    project: Project,
    template: ArtifactTemplate,
    settings: Settings,
    previous: Artifact | undefined,
    opts: ArtifactContentGenerationOptions,
): Promise<string> {
    const audience = requestedAudience(template, previous);
    const contract = template.requestContext?.generationContract;
    const controlled = contract ? opts.support.controlledContext(project, contract, 700) : null;
    const controlledBlock = controlled
        ? controlled.ok ? controlled.promptBlock : `Selección controlada omitida: ${controlled.errors.join(' · ')}`
        : '';
    const brief = [buildDiagramTextBrief(project, template, settings, opts), controlledBlock].filter(Boolean).join('\n\n');
    const request = template.requestContext;
    const stub: Artifact = {
        id: previous?.id ?? `stub-${template.type}`,
        versionGroupId: previous?.versionGroupId ?? `stub-${template.type}`,
        version: previous?.version ?? 1,
        revision: previous?.revision,
        createdAt: previous?.createdAt ?? new Date().toISOString(),
        name: template.name,
        type: template.type,
        phase: template.phase,
        architecturalView: template.architecturalView,
        content: previous?.content ?? '',
        objective: template.objective,
        keyConcepts: template.keyConcepts,
        representation: template.representation,
        audience,
        theme: previous?.theme,
        lastDiagramError: previous?.lastDiagramError,
    };
    const result = await generateDiagramIRWithSelfHealing(stub, project, settings, {
        audience,
        previousIR: previous?.ir,
        brief,
        onContextCaptured: opts.onContextCaptured,
    });
    if (result.fallback === 'skeleton') {
        opts.onDegraded?.(result.declineReason
            ? `El modelo indicó que falta información: ${result.declineReason}. Se guardó un esqueleto base.`
            : 'El modelo no produjo un diagrama válido tras dos intentos: se guardó un esqueleto base.');
        opts.onDiagramIR?.(result.ir);
        const content = serializeDiagram(result.ir, template.type);
        return template.type === 'mermaid-graph' ? opts.support.markSkeleton(content) : content;
    }
    const correction = await correctDiagramOnce(result.ir, {
        artifactType: template.type,
        audience,
        request: request ? {
            userRequest: request.userRequest,
            acceptanceCriteria: request.generationContract?.acceptanceCriteria?.length
                ? request.generationContract.acceptanceCriteria : request.acceptanceCriteria,
            audience: request.audience,
        } : undefined,
        context: `${project.name}: ${template.objective}`,
        onContextCaptured: opts.onContextCaptured,
    }, settings);
    opts.onPhase?.({
        stage: 'refinement',
        status: correction.corrected ? 'success' : correction.calls ? 'warning' : 'skipped',
        message: correction.note,
        detail: correction.findings.join(' · ') || undefined,
        at: new Date().toISOString(),
    });
    opts.onDiagramIR?.(correction.ir);
    return serializeDiagram(correction.ir, template.type);
}
