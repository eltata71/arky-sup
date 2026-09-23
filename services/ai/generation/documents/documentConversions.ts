/**
 * Rewrite one piece of content into another form: a diagram into a Markdown
 * document, and study material into a short mnemonic note. Moved out of the
 * engine in F5-01 (corte 5); the prompts are unchanged.
 */
import type { Settings } from '../../../../types';
import type { Artifact } from '../../../../lib/artifacts';
import type { Project } from '../../../architectureProjects';
import { resolveModelForSettings } from '../../catalog';
import { buildBasePrompt } from '../../prompts/projectPrompts';
import { aiGateway } from '../aiGateway';

export async function convertDiagramToDocument(artifact: Artifact, project: Project, settings: Settings): Promise<string> {
    const prompt = `${buildBasePrompt(project, settings)}\nConvert this diagram to a detailed Markdown document:\n${artifact.content}`;
    const modelName = resolveModelForSettings('default', settings).id;
    const { text } = await aiGateway.generateContent(settings, modelName, prompt, {
        temperature: settings.aiConfig?.temperature ?? 0.7
    });
    return text;
}

export async function synthesizeSmartNote(content: string, settings: Settings): Promise<string> {
    const prompt = `
    Synthesize the following content into an ultra-short mnemonic format (max 150 words).
    Use bullet points, golden rules, and bold text for key concepts.
    
    Content:
    ${content}
    `;

    const modelName = resolveModelForSettings('default', settings).id;

    const { text } = await aiGateway.generateContent(settings, modelName, prompt, {
        temperature: 0.3
    });
    return text;
}
