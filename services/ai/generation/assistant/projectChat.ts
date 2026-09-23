/**
 * The project chat: a question answered with the whole project in view
 * (F5-01, corte 8).
 *
 * Two halves, split where the dependency points. What the project says —
 * the base prompt and a summary of every artifact — is composed here, because
 * it only needs this layer. Who answers is not: the persona and the Office's
 * standards are the Office's, and it frames the instruction before handing it
 * back (`services/architectureOffice/application/projectConversation`).
 */
import type { Settings } from '../../../../types';
import type { ModelTier } from '../../../../lib/ai/modelCatalog';
import type { Project } from '../../../architectureProjects';
import { resolveModelForSettings } from '../../catalog';
import { buildBasePrompt } from '../../prompts/projectPrompts';
import { aiGateway } from '../aiGateway';

/** A prior turn, in the shape the chat surfaces already keep. */
export interface ProjectChatTurn {
    role: 'user' | 'model';
    parts: Array<{ text: string }>;
}

/** The chief-architect instruction over the project and all its artifacts. */
export function buildProjectChatInstruction(project: Project, settings: Settings): string {
    const artifactsSummary = project.artifacts.map(a =>
        `--- Artifact: ${a.name} (${a.type}) ---\nObjective: ${a.objective}\nContent Snippet: ${a.content.substring(0, 500)}...\n`
    ).join('\n');

    return `
${buildBasePrompt(project, settings)}

You are the Chief Software Architect for this project. You have GLOBAL CONTEXT of all the artifacts in the system.
The user is asking a question or requesting an action that may span multiple artifacts or require understanding the system as a whole.

PROJECT ARTIFACTS SUMMARY:
${artifactsSummary}

INSTRUCTIONS:
1. Answer the user's question based on the global context of the project.
2. If the user asks about the impact of a change, analyze how it affects different artifacts.
3. Be concise, technical, and authoritative.
4. If you need to suggest code or configuration (like docker-compose, Kubernetes manifests, etc.), provide it in standard Markdown code blocks.
`;
}

export interface ProjectChatReplyRequest {
    /** The project instruction, already framed by whoever answers. */
    systemInstruction: string;
    message: string;
    history: readonly ProjectChatTurn[];
    settings: Settings;
    modelTier?: ModelTier;
}

export async function generateProjectChatReply(request: ProjectChatReplyRequest): Promise<string> {
    const { systemInstruction, message, history, settings, modelTier = 'default' } = request;

    // History travels inside the prompt so it survives a model fallback.
    const historyText = history.map(h => `${h.role === 'user' ? 'User' : 'Architect'}: ${h.parts[0]?.text ?? ''}`).join('\n\n');
    const fullMessage = historyText ? `Previous Conversation:\n${historyText}\n\nUser: ${message}` : message;

    const result = await aiGateway.generateContent(
        settings,
        resolveModelForSettings(modelTier, settings).id,
        fullMessage,
        {
            systemInstruction,
            temperature: settings.aiConfig?.temperature ?? 0.7,
        },
        { maxRetries: 1 },
    );
    return result.text;
}
