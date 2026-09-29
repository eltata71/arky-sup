/**
 * C4 artifacts through the self-healing IR path (plan de diagramas, 6.1).
 *
 * Out of the engine, like the rest of the diagram vertical (F5-01, corte 6):
 * the engine only decides that a C4 type goes this way. Two things changed on
 * the way out, and both are about not losing what the model produced:
 *
 * - The content is written in the **C4 dialect the type names**
 *   (`irToMermaidC4`). It used to go through `irToMermaid`, which always
 *   emits a flowchart, so a `mermaid-c4-container` artifact stored a
 *   flowchart without its technologies.
 * - The IR itself is **handed to the caller** (`onDiagramIR`), because a
 *   notation carries only part of it. Re-parsing the text was how data
 *   classification, compliance and the written story disappeared between the
 *   model and the database.
 */
import type { ArtifactTemplate, Settings } from '../../../../types';
import type { Artifact } from '../../../../lib/artifacts';
import type { DiagramIR } from '../../../../lib/diagram';
import type { Project } from '../../../architectureProjects';
import { c4LevelOfArtifactType, irToMermaidC4 } from '../../../diagram';
import { C4SelfHealingError } from '../../errors';
import type { ArtifactGenerationSupport } from '../artifacts/artifactGenerationSupport';
import { generateDiagramIRWithSelfHealing } from './diagramIRGeneration';

/** True for the C4 family, which is routed through the IR path. */
export function isC4ArtifactType(type: string): boolean {
    return c4LevelOfArtifactType(type) !== null;
}

/**
 * A transient {@link Artifact} built from a template, so the IR generator —
 * which expects an artifact — can run before one has been persisted.
 */
function artifactStubFromTemplate(
    template: ArtifactTemplate,
    project: Project,
    support: ArtifactGenerationSupport,
    previousArtifact?: Artifact,
): Artifact {
    const now = new Date().toISOString();
    const contract = template.requestContext?.generationContract;
    let controlledContext = '';
    if (contract) {
        const validation = support.controlledContext(project, contract, 700);
        controlledContext = validation.ok ? validation.promptBlock : `
## Selección controlada de fuentes/contexto
- Omitida por validación de seguridad: ${validation.errors.join(' · ')}
`;
    }
    const structuredObjective = contract
        ? `${template.objective}

Structured generation contract: ${contract.normalizedIntent}. Audience: ${contract.audience}. Purpose: ${contract.purpose}. Detail level: ${contract.detailLevel}. Acceptance criteria: ${contract.acceptanceCriteria.join(' | ')}. Excluded source ids: ${contract.excludedSourceArtifactIds.join(', ') || 'none'}.
${controlledContext}`
        : template.objective;
    return {
        id: previousArtifact?.id ?? `stub-${template.name}-${Date.now()}`,
        versionGroupId: previousArtifact?.versionGroupId ?? `stub-${template.name}`,
        version: previousArtifact?.version ?? 1,
        createdAt: previousArtifact?.createdAt ?? now,
        name: template.name,
        type: template.type,
        phase: template.phase,
        architecturalView: template.architecturalView,
        content: previousArtifact?.content ?? '',
        objective: structuredObjective,
        keyConcepts: template.keyConcepts,
        representation: template.representation,
        audience: previousArtifact?.audience,
        theme: previousArtifact?.theme,
        lastDiagramError: previousArtifact?.lastDiagramError,
    };
}

/**
 * Generates a C4 artifact and returns its Mermaid in the type's C4 dialect.
 * When the ladder ends in a skeleton, throws {@link C4SelfHealingError}
 * carrying the renderable skeleton, so the caller can persist it and say so.
 */
export async function generateC4ArtifactContent(
    project: Project,
    template: ArtifactTemplate,
    settings: Settings,
    support: ArtifactGenerationSupport,
    previousArtifact: Artifact | undefined,
    onDiagramIR?: (ir: DiagramIR) => void,
): Promise<string> {
    const level = c4LevelOfArtifactType(template.type) ?? 'context';
    const stub = artifactStubFromTemplate(template, project, support, previousArtifact);
    const result = await generateDiagramIRWithSelfHealing(stub, project, settings);
    const mermaid = irToMermaidC4(result.ir, level);
    if (result.fallback === 'skeleton') {
        throw new C4SelfHealingError(
            'C4 generation fell back to a deterministic skeleton after retries.',
            {
                reason: result.lastReason ?? 'skeleton-fallback',
                attempts: result.attempts,
                sampleMermaid: support.markSkeleton(mermaid),
                warnings: result.warnings,
            },
        );
    }
    onDiagramIR?.(result.ir);
    return mermaid;
}
