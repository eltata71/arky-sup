/** The same request brief used by C4, supplied to text-based diagrams (8.2b). */
import type { ArtifactTemplate, Settings } from '../../../../types';
import type { Project } from '../../../architectureProjects';
import { resolveDomainPacks } from '../../../../lib/domainPacks';
import { buildDiagramGenerationBrief } from '../../prompts/diagramGenerationBrief';
import type { ArtifactContentGenerationOptions } from '../artifacts/artifactGenerationSupport';

export function buildDiagramTextBrief(
    project: Project,
    template: ArtifactTemplate,
    settings: Settings,
    opts: ArtifactContentGenerationOptions,
): string {
    const request = template.requestContext?.userRequest ?? template.objective;
    return buildDiagramGenerationBrief({
        template,
        language: settings.language,
        businessMotivation: opts.businessMotivation,
        architectureGraphBlock: opts.architectureGraphPromptBlock,
        personaInstruction: opts.composePersonaInstruction?.('', request),
        domainPacks: resolveDomainPacks({
            motivations: opts.businessMotivation,
            texts: [project.description, ...(project.projectContext ?? []), template.objective, request],
        }),
    });
}
