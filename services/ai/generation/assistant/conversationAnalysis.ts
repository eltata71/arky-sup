/**
 * The two analyses that read a conversation or a whole project rather than
 * one artifact: the context a chat turn fixed, and the contradictions between
 * artifacts. Moved out of the engine in F5-01 (corte 7); the prompts are
 * unchanged.
 */
import type { ConsistencySuggestion, Settings } from '../../../../types';
import { cleanJsonString } from '../../../../utils';
import type { Project } from '../../../architectureProjects';
import { resolveModelForSettings } from '../../catalog';
import { buildBasePrompt } from '../../prompts/projectPrompts';
import { aiGateway } from '../aiGateway';
import type { AssistantConversationTurn } from './assistantPorts';

/**
 * Did the last exchange fix a key constraint or technology choice? One
 * sentence when it did, `null` when it did not — or when the call failed,
 * because a missed context note must never interrupt the conversation.
 */
export async function analyzeChatForContext(
    _history: readonly AssistantConversationTurn[],
    latestUserMessage: string,
    latestAiResponse: string,
    settings: Settings,
): Promise<string | null> {
    const prompt = `Analyze conversation. Did user define a KEY constraint/tech choice? If yes, summarize in 1 sentence for context. If no, return "NO_CONTEXT".
        
        Last interaction:
        User: ${latestUserMessage}
        AI: ${latestAiResponse}`;

    try {
        const { text: raw } = await aiGateway.generateContent(
            settings,
            resolveModelForSettings('default', settings).id,
            prompt,
            {},
            { maxRetries: 1 },
        );
        const text = raw?.trim();
        return (text && text !== 'NO_CONTEXT') ? text : null;
    } catch { return null; }
}

/** Cross-artifact contradictions, each with the edit that would resolve it. `[]` on failure. */
export async function runConsistencyCheck(project: Project, settings: Settings): Promise<ConsistencySuggestion[]> {
    const prompt = `
${buildBasePrompt(project, settings)}
Analyze ALL artifacts for inconsistencies/contradictions.
Artifacts: ${JSON.stringify(project.artifacts.map(a => ({ id: a.id, name: a.name, content: a.content.substring(0, 1000) })))}

Return JSON Array: [{ "id": "1", "inconsistency": "desc", "suggestion": "fix", "isApplied": false, "changes": [{ "artifactId": "id", "oldContentSnippet": "...", "newContent": "FULL NEW CONTENT" }] }]
Return [] if none.
`;
    const modelName = resolveModelForSettings('default', settings).id;

    try {
        const { text } = await aiGateway.generateContent(settings, modelName, prompt, {
            temperature: 0.2,
            responseMimeType: 'application/json',
            responseSchema: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' }, inconsistency: { type: 'string' }, suggestion: { type: 'string' }, isApplied: { type: 'boolean' },
                        changes: { type: 'array', items: { type: 'object', properties: { artifactId: { type: 'string' }, oldContentSnippet: { type: 'string' }, newContent: { type: 'string' } } } },
                    },
                },
            },
        }, { timeoutMs: 300000 });
        const parsed: unknown = JSON.parse(cleanJsonString(text || '') || '[]');
        return Array.isArray(parsed) ? parsed as ConsistencySuggestion[] : [];
    } catch (e) {
        console.error('Consistency Check Error:', e);
        return [];
    }
}
