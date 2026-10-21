// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock('../../../services/ai/providers/gemini/geminiClient', () => ({
  createGeminiAIClient: () => ({ models: { generateContent } }),
}));
import { aiRequestExecutor } from '../../../services/ai/core/AIRequestExecutor';
import { generateProjectChatReplyMeasured } from '../../../services/ai/generation/assistant/projectChat';
import { legacyTransport } from '../../../services/ai/generation/legacyTransport';
import { coordinateRequest } from '../../../services/architectureOffice/application/officeCoordination';
import { exportOperationTrace } from '../../../services/architectureOffice/application/officeOperationTrace';
import { isTraceId } from '../../../lib/traceId';
import type { AgentInvocationMeasurement } from '../../../lib/ai/agentUsage';
import type { Settings } from '../../../types';

const settings: Settings = { theme: 'light', language: 'es', globalContext: [], aiConfig: {
  provider: 'gemini', model: 'gemini-2.5-flash', apiKeySource: 'user', temperature: 0.2,
  tone: 'professional', languageStyle: 'concise',
} };

beforeEach(() => {
  vi.stubEnv('VITE_AI_PROXY_URL', '');
  localStorage.setItem('user_gemini_key', 'test-key');
  generateContent.mockReset().mockResolvedValue({ text: 'Respuesta sin evidencia',
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('Office → gateway → canonical AITrace', () => {
  it('preserves runId and all four or more AITrace request ids and effective models in the export', async () => {
    const execute = vi.spyOn(aiRequestExecutor, 'execute');
    const outcome = await coordinateRequest({ request: 'arquitectura de software e integración',
      scope: { level: 'project', id: 'p', name: 'Proyecto', briefing: [] }, maxSpecialists: 2,
      invoke: (_persona, message, _stamp, options) => generateProjectChatReplyMeasured({
        settings, systemInstruction: 'Responde', message, history: [],
        operationId: options?.operationId, invocationId: options?.invocationId,
      }),
    });
    expect(execute.mock.calls.length).toBeGreaterThanOrEqual(4);
    const exported = exportOperationTrace(outcome);
    for (const call of execute.mock.calls) {
      expect(call[1].operationId).toBe(outcome.runId);
      expect(isTraceId(call[1].requestId)).toBe(true);
      expect(outcome.invocations?.some((item) => item.invocationId === call[1].requestId)).toBe(true);
    }
    for (const result of execute.mock.results) {
      const response = await result.value;
      expect(response.trace.operationId).toBe(outcome.runId);
      expect(exported).toContain(response.trace.requestId);
      expect(exported).toContain(response.trace.modelEffective);
    }
    expect(outcome.invocations?.every((item) => item.measurement.usage?.totalTokens === 15)).toBe(true);
  });

  it('sends the invocation id to the proxy and preserves its returned id without fabricating AITrace', async () => {
    vi.stubEnv('VITE_AI_PROXY_URL', '/api/ai');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: 'respuesta',
      requestId: 'server-canonical-id', model: 'actual-proxy-model', usage: { totalTokens: 17 } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await generateProjectChatReplyMeasured({ settings, systemInstruction: 'Responde',
      message: 'hola', history: [], operationId: 'run-test', invocationId: 'office-invocation-1234' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(Object.values(headers)).toContain('office-invocation-1234');
    expect(response).toMatchObject({ traceId: 'server-canonical-id', model: 'actual-proxy-model', usage: { totalTokens: 17 } });
  });

  it('measures the buffered production path per invocation and isolates broken observers', async () => {
    const measurements: AgentInvocationMeasurement[] = [];
    await legacyTransport.generateTextWithFallback(settings, 'gemini-2.5-flash', 'hola', {}, {
      operationId: 'run-production', onMeasurement: (item) => { measurements.push(item); throw new Error('observer'); },
    });
    expect(measurements).toHaveLength(1);
    expect(measurements[0]).toMatchObject({ runId: 'run-production', model: 'gemini-2.5-flash', usage: { totalTokens: 15 }, status: 'completed' });
    expect(isTraceId(measurements[0].traceId)).toBe(true);
    expect(measurements[0].traceId).toBe(measurements[0].invocationId);
  });
});
