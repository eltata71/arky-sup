/**
 * One turn of the Arquitecto Agente — buffered or streamed — with the system
 * instruction already composed (F5-01, corte 8).
 *
 * The engine used to compose it here: the agent's own instruction and an
 * Office persona. Both `services/agent` and `services/architectureOffice`
 * import this layer, so composing here meant looking them up from below. The
 * agent composes its turn now (`services/agent/agentConversation`) and hands
 * over the result; this file only knows how to ask a model and read back the
 * `modifyArtifact` call.
 */
import type { Settings } from '../../../../types';
import { resolveModelForSettings } from '../../catalog';
import { classifyAIError } from '../../errors';
import { MODIFY_ARTIFACT_TOOL } from '../../tools';
import { aiGateway } from '../aiGateway';

/** A history turn in the shape the model reads. */
export interface AgentModelTurn {
    role: 'user' | 'model';
    parts: Array<{ text: string }>;
}

export interface AgentTurnRequest {
    /** Composed by the caller: base persona, memory, scopes, persona, rules. */
    systemInstruction: string;
    /** Already budgeted by the caller; `[]` when history is off. */
    history: readonly AgentModelTurn[];
    question: string;
    settings: Settings;
    /** Offer the `modifyArtifact` tool — only when an artifact is open. */
    offerArtifactTool: boolean;
}

export interface AgentFunctionCall {
    name: string;
    args: Record<string, unknown>;
}

export interface AgentTurnResult {
    text: string;
    functionCall?: AgentFunctionCall;
}

const turnConfig = (request: AgentTurnRequest) => ({
    systemInstruction: request.systemInstruction,
    temperature: request.settings.aiConfig?.temperature ?? 0.7,
    tools: request.offerArtifactTool ? [MODIFY_ARTIFACT_TOOL] : undefined,
});

const turnContents = (request: AgentTurnRequest) =>
    [...request.history, { role: 'user', parts: [{ text: request.question }] }];

export async function runAgentTurn(request: AgentTurnRequest): Promise<AgentTurnResult> {
    const result = await aiGateway.generateContent(
        request.settings,
        resolveModelForSettings('default', request.settings).id,
        turnContents(request),
        turnConfig(request),
        { maxRetries: 1 },
    );
    const call = result.functionCalls?.[0];
    return call?.name
        ? { text: result.text, functionCall: { name: call.name, args: call.args ?? {} } }
        : { text: result.text };
}

/**
 * Streamed variant: `onDelta(fullText, deltaText)` per chunk. Only opening the
 * stream is retried — once output is on screen a retry would duplicate it — and
 * a failure mid-stream is rewrapped so the UI gets a message it can show.
 */
export async function streamAgentTurn(
    request: AgentTurnRequest,
    onDelta: (fullText: string, deltaText: string) => void,
): Promise<AgentTurnResult> {
    const stream = await aiGateway.generateContentStream(
        request.settings,
        resolveModelForSettings('default', request.settings).id,
        turnContents(request),
        turnConfig(request),
        { maxRetries: 1 },
    );

    let fullText = '';
    let functionCall: AgentFunctionCall | undefined;
    try {
        for await (const chunk of stream) {
            // The tool call arrives on its own field; keep the first one.
            const calls = (chunk as { functionCalls?: Array<{ name?: string; args?: Record<string, unknown> }> }).functionCalls;
            const call = calls?.[0];
            if (!functionCall && call?.name) functionCall = { name: call.name, args: call.args ?? {} };
            const delta = (chunk as { text?: string }).text ?? '';
            if (delta) {
                fullText += delta;
                onDelta(fullText, delta);
            }
        }
    } catch (err) {
        throw classifyAIError(err);
    }
    return functionCall ? { text: fullText, functionCall } : { text: fullText };
}
