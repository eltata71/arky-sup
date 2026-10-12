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
import { resolveModelForSettings } from '../../catalog';
import { buildProjectChatInstruction } from './projectChatInstruction';
import { aiGateway } from '../aiGateway';

export { buildProjectChatInstruction };

/** A prior turn, in the shape the chat surfaces already keep. */
export interface ProjectChatTurn {
    role: 'user' | 'model';
    parts: Array<{ text: string }>;
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
