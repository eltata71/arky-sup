/**
 * Repair a diagram that failed to render. Moved out of the engine in F5-01
 * (corte 6); the prompt and the model choice are unchanged.
 */
import type { Settings } from '../../../../types';
import type { Artifact } from '../../../../lib/artifacts';
import { MODEL_TIERS } from '../../../../lib/ai/modelCatalog';
import { cleanJsonString } from '../../../../utils';
import type { Project } from '../../../architectureProjects';
import { buildAutoFixPrompt } from '../../prompts/diagramPrompts';
import { buildBasePrompt } from '../../prompts/projectPrompts';
import { aiGateway } from '../aiGateway';
import { buildDiagramGenerationConfig } from './diagramGenerationConfig';

export async function fixDiagramError(
    artifact: Artifact,
    errorDetails: string,
    project: Project,
    settings: Settings
): Promise<string> {
    const hasMermaidFence = artifact.content.includes('```mermaid');
    const isReactFlow = artifact.type.includes('react-flow');
    const isMermaidArtifact = artifact.type.startsWith('mermaid') || hasMermaidFence;

    // Prefer the canonical auto-fix prompt for any Mermaid-bearing artifact.
    // Falls back to a minimal instruction prompt for pure JSON artifacts.
    let prompt: string;
    if (isMermaidArtifact) {
        // Extract the mermaid body so the auto-fix prompt stays surgical.
        const fenceMatch = artifact.content.match(/```mermaid\s*([\s\S]*?)\s*```/);
        const mermaidBody = fenceMatch ? fenceMatch[1] : artifact.content;
        prompt = buildAutoFixPrompt({ mermaid: mermaidBody, error: errorDetails });
    } else {
        const basePrompt = buildBasePrompt(project, settings);
        prompt = `${basePrompt}

TASK: SELF-HEALING DIAGRAM.
The following diagram code generated a syntax or rendering error. You must fix it.

Artifact Name: ${artifact.name}
Type: ${artifact.type}

ERROR DETAILS:
${errorDetails}

CURRENT BROKEN CODE:
${artifact.content}

INSTRUCTIONS:
1. Analyze the error and the broken code.
2. Fix the syntax error so the diagram renders correctly.
3. Return ONLY valid JSON for ReactFlow. No markdown blocks, no explanations.`;
    }

    // Surgical syntax fix is mechanical → cheap tier + thinking off.
    const modelName = MODEL_TIERS.quick;

    const { text } = await aiGateway.generateContent(settings, modelName, prompt, buildDiagramGenerationConfig({
        temperature: 0.1,
        thinking: 'off',
    }));

    {
        let fixedContent = text || artifact.content;
        if (isMermaidArtifact) {
            // Strip any accidental fences the model still added.
            fixedContent = fixedContent.replace(/```mermaid\s*/gi, '').replace(/```\s*$/g, '').trim();
            if (hasMermaidFence) {
                fixedContent = `\`\`\`mermaid\n${fixedContent}\n\`\`\``;
            }
        } else if (isReactFlow) {
            fixedContent = cleanJsonString(fixedContent);
        }
        return fixedContent;
    }
}
