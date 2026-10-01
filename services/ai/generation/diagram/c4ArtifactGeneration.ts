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
import type { Artifact, ContextManifestSource } from '../../../../lib/artifacts';
import type { DiagramAudience } from '../../../../lib/diagram';
import type { Project } from '../../../architectureProjects';
import { resolveDomainPacks } from '../../../../lib/domainPacks';
import { c4LevelOfArtifactType, irToMermaidC4, mermaidToIR, type C4DiagramLevel } from '../../../diagram';
import { C4SelfHealingError } from '../../errors';
import { buildDiagramGenerationBrief, type UpperLevelDiagram } from '../../prompts/diagramGenerationBrief';
import type { ArtifactContentGenerationOptions, ArtifactGenerationSupport } from '../artifacts/artifactGenerationSupport';
import { generateDiagramIRWithSelfHealing } from './diagramIRGeneration';
import { correctDiagramOnce } from './diagramSelfCorrection';

/** The C4 level whose names a diagram must reuse (plan de diagramas, 6.2). */
const PARENT_LEVEL: Partial<Record<C4DiagramLevel, string>> = {
    container: 'mermaid-c4-context',
    component: 'mermaid-c4-container',
    deployment: 'mermaid-c4-container',
};

const MAX_UPPER_ELEMENTS = 24;

/**
 * The newest diagram of the level above in the same project, reduced to the
 * names a detail has to reuse. Its persisted IR when it has one — that is the
 * model's, with technologies — and its text otherwise.
 */
function resolveUpperLevel(project: Project, level: C4DiagramLevel, ownGroupId?: string): (UpperLevelDiagram & { source: ContextManifestSource }) | null {
    const parentType = PARENT_LEVEL[level];
    if (!parentType) return null;
    const parent = (project.artifacts ?? [])
        .filter((artifact) => artifact.type === parentType && artifact.versionGroupId !== ownGroupId)
        .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || (b.version ?? 0) - (a.version ?? 0))[0];
    if (!parent) return null;
    try {
        const nodes = parent.ir?.nodes?.length ? parent.ir.nodes : mermaidToIR(parent.content ?? '').nodes;
        const elements = nodes
            .slice(0, MAX_UPPER_ELEMENTS)
            .map((node) => (node.technology ? `${node.label} [${node.technology}]` : node.label));
        return elements.length ? { name: parent.name, elements, source: { id: parent.id, label: parent.name, revision: parent.revision } } : null;
    } catch {
        return null;
    }
}

/** The audience the request asked for wins over the one the last version had. */
function requestedAudience(template: ArtifactTemplate, previous?: Artifact): DiagramAudience | undefined {
    const asked = template.requestContext?.audience;
    if (asked === 'executive' || asked === 'technical') return asked;
    return previous?.audience;
}

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
        revision: previousArtifact?.revision,
        createdAt: previousArtifact?.createdAt ?? now,
        name: template.name,
        type: template.type,
        phase: template.phase,
        architecturalView: template.architecturalView,
        content: previousArtifact?.content ?? '',
        objective: structuredObjective,
        keyConcepts: template.keyConcepts,
        representation: template.representation,
        audience: requestedAudience(template, previousArtifact),
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
    previousArtifact: Artifact | undefined,
    opts: ArtifactContentGenerationOptions,
): Promise<string> {
    const { support } = opts;
    const level = c4LevelOfArtifactType(template.type) ?? 'context';
    const stub = artifactStubFromTemplate(template, project, support, previousArtifact);
    // The same context every other path gets, which this one used to skip
    // by returning before the engine resolved it (plan de diagramas, 6.2).
    const request = template.requestContext?.userRequest ?? template.objective;
    const upperLevel = resolveUpperLevel(project, level, previousArtifact?.versionGroupId);
    const brief = buildDiagramGenerationBrief({
        template,
        language: settings.language,
        businessMotivation: opts.businessMotivation,
        upperLevel,
        architectureGraphBlock: opts.architectureGraphPromptBlock,
        personaInstruction: opts.composePersonaInstruction?.('', request),
        domainPacks: resolveDomainPacks({
            motivations: opts.businessMotivation,
            texts: [project.description, ...(project.projectContext ?? []), template.objective, template.requestContext?.userRequest],
        }),
    });
    // A regeneration evolves the diagram it replaces instead of re-rolling it.
    const result = await generateDiagramIRWithSelfHealing(stub, project, settings, { brief, previousIR: previousArtifact?.ir, onContextCaptured: opts.onContextCaptured ? (record) => opts.onContextCaptured?.({
        ...record, sources: [...record.sources, ...(upperLevel && record.sections.some((section) => section.scope === 'brief') ? [upperLevel.source] : [])],
    }) : undefined });
    if (result.fallback === 'skeleton') {
        throw new C4SelfHealingError(
            result.declineReason
                ? `El modelo indicó que falta información para este diagrama: ${result.declineReason}. Se guardó un esqueleto base; completa el contexto del proyecto y vuelve a generarlo.`
                : 'El modelo no produjo un diagrama C4 válido tras dos intentos: se guardó un esqueleto base para completar a mano.',
            {
                reason: result.lastReason ?? 'skeleton-fallback',
                attempts: result.attempts,
                sampleMermaid: support.markSkeleton(irToMermaidC4(result.ir, level)),
                warnings: result.warnings,
            },
        );
    }
    if (result.dropped.length) {
        opts.onPhase?.({
            stage: 'validation',
            status: 'warning',
            message: `Se descartaron ${result.dropped.length} elemento(s) inválidos de la respuesta del modelo.`,
            detail: result.dropped.slice(0, 12).join(' · '),
            at: new Date().toISOString(),
        });
    }
    // One bounded correction, only when the deterministic evaluation finds
    // something, and kept only if it does not make things worse (6.3).
    const correction = await correctDiagramOnce(result.ir, {
        artifactType: template.type,
        audience: stub.audience ?? 'technical',
        request: template.requestContext ? {
            userRequest: template.requestContext.userRequest,
            acceptanceCriteria: template.requestContext.generationContract?.acceptanceCriteria?.length
                ? template.requestContext.generationContract.acceptanceCriteria
                : template.requestContext.acceptanceCriteria,
            audience: template.requestContext.audience,
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
    return irToMermaidC4(correction.ir, level);
}
