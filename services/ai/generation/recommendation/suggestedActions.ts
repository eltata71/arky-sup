/**
 * Suggest the next two catalogue artifacts for a project's current state.
 * Left the engine in F5-01 (corte 4); a failure returns no suggestions.
 */
import { ARTIFACT_TEMPLATES } from '../../../../constants';
import type { Settings } from '../../../../types';
import { cleanJsonString } from '../../../../utils';
import type { ArtifactTemplateSuggestion } from '../../../../lib/artifacts/artifactSuggestions';
import type { Project } from '../../../architectureProjects';
import { resolveModelForSettings } from '../../catalog';
import { buildArtifactsContext, buildBasePrompt } from '../../prompts/projectPrompts';
import { aiGateway } from '../aiGateway';

export async function getSuggestedActions(project: Project, settings: Settings): Promise<ArtifactTemplateSuggestion[]> {
    const prompt = `
${buildBasePrompt(project, settings)}
${buildArtifactsContext(project)}

Analyze architecture state. Suggest top 2 next artifacts from this list:
${ARTIFACT_TEMPLATES.filter(t => !project.artifacts.some(a => a.name === t.name)).map(t => t.name).join(', ')}

Return JSON Array: [{ "templateName": "string", "reason": "string" }]
`;
    const modelName = resolveModelForSettings('default', settings).id;

    try {
        const { text } = await aiGateway.generateContent(settings, modelName, prompt, {
            temperature: settings.aiConfig?.temperature ?? 0.7,
            responseMimeType: 'application/json',
            responseSchema: { type: 'array', items: { type: 'object', properties: { templateName: {type:'string'}, reason: {type:'string'} } } }
        });
        const cleanJson = cleanJsonString(text || '');
        return JSON.parse(cleanJson || '[]');
    } catch (e) {
        console.error("Suggestion Error:", e);
        return [];
    }
}
