import { observabilityService } from '../../observability';
import { AIServiceError, classifyAIError } from '../errors';
import type { AIErrorCategory, AIErrorSource } from '../core';
import type { ModelSource } from '../../../lib/ai/modelCatalog';

export type AiCallPurpose = 'guided-creation' | 'project-chat' | 'artifact-generation' | 'lms' | 'analyze-document' | 'review-architecture';

export interface AiCallMetadata {
  requestId?: string;
  purpose: AiCallPurpose;
  model: string;
  modelSource: ModelSource;
  promptSize: number;
  messageCount: number;
  dedupeKey: string;
  signal?: AbortSignal;
}

export interface AiCallResult<T> {
  requestId: string;
  value: T;
}

interface InFlightCall<T> {
  requestId: string;
  promise: Promise<AiCallResult<T>>;
}

const inFlight = new Map<string, InFlightCall<unknown>>();
const cooldownUntilByPurposeAndSource = new Map<string, number>();
const MIN_CHAT_DEBOUNCE_MS = 650;

const createRequestId = (purpose: AiCallPurpose): string => {
  const random = Math.random().toString(36).slice(2, 9);
  return `ai-${purpose}-${Date.now()}-${random}`;
};

const cooldownKey = (purpose: AiCallPurpose, source: AIErrorSource): string => `${purpose}:${source}`;

const getCooldownRemainingMs = (purpose: AiCallPurpose, source?: AIErrorSource): number => {
  const now = Date.now();
  if (source) {
    return Math.max(0, (cooldownUntilByPurposeAndSource.get(cooldownKey(purpose, source)) ?? 0) - now);
  }

  let remainingMs = 0;
  for (const [key, until] of cooldownUntilByPurposeAndSource.entries()) {
    if (key.startsWith(`${purpose}:`)) {
      remainingMs = Math.max(remainingMs, until - now);
    }
  }
  return Math.max(0, remainingMs);
};

export const estimatePayloadSize = (value: unknown): number => {
  if (typeof value === 'string') return value.length;
  try {
    return JSON.stringify(value).length;
  } catch {
    return String(value).length;
  }
};

const getBlockingCooldownRemainingMs = (purpose: AiCallPurpose): number => {
  const now = Date.now();
  let remainingMs = 0;
  for (const [key, until] of cooldownUntilByPurposeAndSource.entries()) {
    if (key.startsWith(`${purpose}:`) && !key.endsWith(':proxy-local-rate-limit')) {
      remainingMs = Math.max(remainingMs, until - now);
    }
  }
  return Math.max(0, remainingMs);
};

export const getAiCooldownRemainingMs = getCooldownRemainingMs;
export const getAiBlockingCooldownRemainingMs = getBlockingCooldownRemainingMs;

export const setAiCooldown = (purpose: AiCallPurpose, retryAfterMs: number, source: AIErrorSource = 'provider-rate-limit'): void => {
  if (retryAfterMs <= 0) return;
  cooldownUntilByPurposeAndSource.set(cooldownKey(purpose, source), Date.now() + retryAfterMs);
};

export const clearAiCooldown = (purpose: AiCallPurpose, source?: AIErrorSource): void => {
  if (source) {
    cooldownUntilByPurposeAndSource.delete(cooldownKey(purpose, source));
    return;
  }
  for (const key of Array.from(cooldownUntilByPurposeAndSource.keys())) {
    if (key.startsWith(`${purpose}:`)) cooldownUntilByPurposeAndSource.delete(key);
  }
};

const defaultCooldownFor = (category: AIErrorCategory, retryAfterMs?: number): number => {
  if (typeof retryAfterMs === 'number' && retryAfterMs > 0) return retryAfterMs;
  if (category === 'rate-limit') return 30_000;
  if (category === 'overloaded') return 5_000;
  return 0;
};

export async function executeAiCall<T>(metadata: AiCallMetadata, run: () => Promise<T>): Promise<AiCallResult<T>> {
  const duplicate = inFlight.get(metadata.dedupeKey) as InFlightCall<T> | undefined;
  if (duplicate) {
    observabilityService.trackEvent({
      severity: 'warning',
      source: 'operation',
      status: 'observed',
      title: 'Llamada IA duplicada bloqueada',
      message: 'Se bloqueó una llamada duplicada antes de llegar a Gemini.',
      operationId: duplicate.requestId,
      operationName: metadata.purpose,
      recoverable: true,
      userVisible: false,
      metadata: {
        purpose: metadata.purpose,
        model: metadata.model,
        modelSource: metadata.modelSource,
        promptSize: metadata.promptSize,
        messageCount: metadata.messageCount,
        duplicateBlocked: true,
      },
    });
    return duplicate.promise;
  }

  const cooldownRemainingMs = getBlockingCooldownRemainingMs(metadata.purpose);
  if (cooldownRemainingMs > 0) {
    throw new AIServiceError(
      'rate-limit',
      429,
      `AI cooldown active for ${Math.ceil(cooldownRemainingMs / 1000)}s`,
      `La cuota temporal de IA está en enfriamiento. Intenta nuevamente en ${Math.ceil(cooldownRemainingMs / 1000)} segundos.`,
      true,
      undefined,
      cooldownRemainingMs,
      { source: 'provider-rate-limit', errorCode: 'ai_cooldown_active' },
    );
  }

  const requestId = metadata.requestId ?? createRequestId(metadata.purpose);
  const startedAt = performance.now();

  const promise = (async (): Promise<AiCallResult<T>> => {
    observabilityService.trackEvent({
      severity: 'info',
      source: 'operation',
      status: 'started',
      title: 'Llamada IA iniciada',
      message: `Solicitud ${metadata.purpose} enviada al modelo ${metadata.model}.`,
      operationId: requestId,
      operationName: metadata.purpose,
      recoverable: true,
      userVisible: false,
      metadata: {
        purpose: metadata.purpose,
        model: metadata.model,
        modelSource: metadata.modelSource,
        promptSize: metadata.promptSize,
        messageCount: metadata.messageCount,
        retry: false,
        cooldown: false,
        duplicateBlocked: false,
      },
    });

    try {
      if (metadata.signal?.aborted) {
        throw new DOMException('AI request aborted before start', 'AbortError');
      }
      const value = await run();
      clearAiCooldown(metadata.purpose);
      const durationMs = Math.round(performance.now() - startedAt);
      observabilityService.trackEvent({
        severity: 'success',
        source: 'operation',
        status: 'succeeded',
        title: 'Llamada IA completada',
        message: `Solicitud ${metadata.purpose} completada en ${durationMs}ms.`,
        operationId: requestId,
        operationName: metadata.purpose,
        recoverable: true,
        userVisible: false,
        metadata: {
          purpose: metadata.purpose,
          model: metadata.model,
          modelSource: metadata.modelSource,
          promptSize: metadata.promptSize,
          messageCount: metadata.messageCount,
          durationMs,
          cooldownCleared: true,
        },
      });
      return { requestId, value };
    } catch (error) {
      const friendly = classifyAIError(error);
      const cooldownMs = defaultCooldownFor(friendly.category, friendly.retryAfterMs);
      if (cooldownMs > 0) setAiCooldown(metadata.purpose, cooldownMs, friendly.source);
      const durationMs = Math.round(performance.now() - startedAt);
      observabilityService.reportError(friendly, {
        source: 'operation',
        title: 'Llamada IA fallida',
        message: friendly.userMessage,
        operationId: requestId,
        operationName: metadata.purpose,
        recoverable: friendly.retryable,
        userVisible: false,
        metadata: {
          purpose: metadata.purpose,
          model: metadata.model,
          modelSource: metadata.modelSource,
          promptSize: metadata.promptSize,
          messageCount: metadata.messageCount,
          durationMs,
          status: friendly.status,
          category: friendly.category,
          retry: false,
          cooldown: cooldownMs > 0,
          retryAfterMs: cooldownMs || undefined,
          errorSource: friendly.source,
          errorCode: friendly.errorCode,
        },
      });
      if (cooldownMs > 0 && friendly.retryAfterMs === undefined) {
        throw new AIServiceError(friendly.category, friendly.status, friendly.message, friendly.userMessage, friendly.retryable, friendly.cause, cooldownMs, { source: friendly.source, errorCode: friendly.errorCode });
      }
      throw friendly;
    } finally {
      globalThis.setTimeout(() => {
        if (inFlight.get(metadata.dedupeKey)?.requestId === requestId) {
          inFlight.delete(metadata.dedupeKey);
        }
      }, MIN_CHAT_DEBOUNCE_MS);
    }
  })();

  inFlight.set(metadata.dedupeKey, { requestId, promise } as InFlightCall<unknown>);
  return promise;
}

export const __test__ = {
  reset(): void {
    inFlight.clear();
    cooldownUntilByPurposeAndSource.clear();
  },
};
