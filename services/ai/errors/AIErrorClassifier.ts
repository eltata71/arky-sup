/**
 * AIErrorClassifier — turns arbitrary SDK/network failures into a canonical
 * `AIError` with a stable `category`.
 *
 * The classifier is HTTP-status + message aware. It is provider-scoped (the
 * thrown `AIError.provider` is stamped from `providerId`) but the heuristics
 * themselves are generic enough to cover every REST-backed LLM SDK.
 */

import {
  AIError,
  type AIErrorCategory,
  MODEL_FALLBACK_CATEGORIES,
  TRANSIENT_ERROR_CATEGORIES,
} from '../core/AIError';
import type { AIProviderId } from '../core/AIModel';

interface ErrorShape {
  status?: number;
  message?: string;
  retryAfterMs?: number;
  name?: string;
}

/** Extract status / message / retry-after from an arbitrary error object. */
export function readErrorShape(error: unknown): ErrorShape {
  if (!error || typeof error !== 'object') {
    return { message: typeof error === 'string' ? error : undefined };
  }
  const e = error as {
    status?: number;
    code?: number;
    message?: string;
    name?: string;
    retryAfter?: number | string;
    retryAfterMs?: number;
    headers?: { get?: (name: string) => string | null };
    error?: { code?: number; status?: string; message?: string };
  };
  let status = e.status ?? e.code ?? e.error?.code;
  const rawMessage = e.message ?? e.error?.message;
  let message = rawMessage;

  const retryAfterHeader =
    e.headers?.get?.('retry-after') ?? e.headers?.get?.('Retry-After') ?? undefined;
  const retryAfterValue = e.retryAfterMs ?? e.retryAfter ?? retryAfterHeader;
  const retryAfterMs = ((): number | undefined => {
    if (typeof retryAfterValue === 'number') {
      return retryAfterValue > 1000 ? retryAfterValue : retryAfterValue * 1000;
    }
    if (typeof retryAfterValue === 'string' && retryAfterValue.trim().length > 0) {
      const seconds = Number(retryAfterValue);
      if (Number.isFinite(seconds)) return seconds * 1000;
      const dateMs = Date.parse(retryAfterValue);
      if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
    }
    return undefined;
  })();

  // Many SDKs (incl. @google/genai) stuff the server JSON into `.message`.
  if (typeof rawMessage === 'string') {
    const prefixMatch = rawMessage.match(/got status:\s*(\d{3})/i);
    if (prefixMatch && status === undefined) status = Number(prefixMatch[1]);
    const jsonStart = rawMessage.indexOf('{');
    if (jsonStart >= 0) {
      try {
        const parsed = JSON.parse(rawMessage.slice(jsonStart)) as {
          error?: { code?: number; status?: string; message?: string };
        };
        if (parsed.error) {
          if (status === undefined && typeof parsed.error.code === 'number') {
            status = parsed.error.code;
          }
          if (typeof parsed.error.message === 'string' && parsed.error.message.length > 0) {
            message = parsed.error.message;
          } else if (typeof parsed.error.status === 'string' && parsed.error.status.length > 0) {
            message = parsed.error.status;
          }
        }
      } catch {
        // Body wasn't valid JSON — keep the original stringified message.
      }
    }
  }

  return {
    status,
    message,
    retryAfterMs,
    name: typeof e.name === 'string' ? e.name : undefined,
  };
}

/** Localised, user-facing message per category. */
const USER_MESSAGES: Record<AIErrorCategory, string> = {
  overloaded:
    'El modelo de IA está saturado o con un problema interno. Reintenta en unos segundos.',
  'rate-limit':
    'Has alcanzado el límite de peticiones por minuto. Espera unos segundos antes de reintentar.',
  auth: 'No se pudo autenticar con la API de IA. Revisa la clave de API en Configuración.',
  'invalid-request':
    'La solicitud al modelo no es válida. Simplifica el contexto y reintenta.',
  timeout:
    'El modelo tardó demasiado en responder. Reintenta o reduce la complejidad de la generación.',
  network:
    'No se pudo contactar al modelo de IA. Verifica tu conexión — el sistema reintentará automáticamente.',
  'malformed-response':
    'El modelo devolvió una respuesta malformada. Se usará la ruta local determinística cuando aplique.',
  'empty-response':
    'El modelo devolvió una respuesta vacía. Reintenta — el sistema reintentará automáticamente.',
  sdk: 'El SDK de IA devolvió un error antes de completar la respuesta.',
  configuration:
    'La integración de IA no está configurada. Revisa la clave de API en Configuración.',
  aborted: 'La operación de IA fue cancelada.',
  unknown: 'Ocurrió un error inesperado al hablar con el modelo. Reintenta en unos segundos.',
};

export class AIErrorClassifier {
  constructor(private readonly providerId: AIProviderId = 'gemini') {}

  /** Classify an arbitrary error into a canonical `AIError`. */
  classify(error: unknown): AIError {
    if (error instanceof AIError) return error;

    const { status, message, retryAfterMs, name } = readErrorShape(error);
    const lower = (message ?? '').toLowerCase();
    const lowerName = (name ?? '').toLowerCase();

    const category = this.categorise(status, lower, lowerName, error);
    const retryable = TRANSIENT_ERROR_CATEGORIES.has(category);

    return new AIError({
      category,
      provider: this.providerId,
      status,
      message: message ?? `${category} error`,
      userMessage: USER_MESSAGES[category],
      retryable,
      retryAfterMs,
      cause: error,
      errorCode: `${category}${status ? `_${status}` : ''}`,
    });
  }

  private categorise(
    status: number | undefined,
    lower: string,
    lowerName: string,
    error: unknown,
  ): AIErrorCategory {
    if (lowerName === 'aborterror' && !lower.includes('timed out')) {
      // A caller-driven abort. Our own timeout fires a TimeoutError instead.
      return 'aborted';
    }
    if (
      status === 503 ||
      status === 500 ||
      status === 502 ||
      status === 504 ||
      (typeof status === 'number' && status >= 500 && status <= 599) ||
      lower.includes('high demand') ||
      lower.includes('overloaded') ||
      lower.includes('unavailable') ||
      lower.includes('internal') ||
      lower.includes('bad gateway') ||
      lower.includes('gateway timeout')
    ) {
      return 'overloaded';
    }
    if (status === 429 || lower.includes('rate') || lower.includes('quota')) {
      return 'rate-limit';
    }
    if (
      status === 401 ||
      status === 403 ||
      lower.includes('api key') ||
      lower.includes('permission denied')
    ) {
      return 'auth';
    }
    if (lower.includes('no se encontró una api key') || lower.includes('no api key')) {
      return 'configuration';
    }
    if (
      lower.includes('json parse error') ||
      lower.includes('json.parse') ||
      lower.includes('unexpected token') ||
      lower.includes('unterminated string') ||
      lower.includes('malformed') ||
      lower.includes('not valid json') ||
      (error instanceof SyntaxError && lower.includes('json'))
    ) {
      return 'malformed-response';
    }
    if (lower.includes('empty response') || lower.includes('respuesta vacía')) {
      return 'empty-response';
    }
    if (status === 400 || lower.includes('invalid')) {
      return 'invalid-request';
    }
    if (
      lowerName === 'timeouterror' ||
      lower.includes('timeout') ||
      lower.includes('timed out')
    ) {
      return 'timeout';
    }
    if (
      lower.includes('fetch failed') ||
      lower.includes('failed to fetch') ||
      lower.includes('load failed') ||
      lower.includes('networkerror') ||
      lower.includes('econnreset') ||
      lower.includes('econnrefused') ||
      lower.includes('etimedout') ||
      lower.includes('network') ||
      lower.includes('connection')
    ) {
      return 'network';
    }
    if (
      lowerName.includes('apierror') ||
      lowerName.includes('google') ||
      lower.includes('@google/genai') ||
      lower.includes('sdk')
    ) {
      return 'sdk';
    }
    return 'unknown';
  }

  /** True when retrying the *same* model could plausibly succeed. */
  isTransient(error: unknown): boolean {
    return TRANSIENT_ERROR_CATEGORIES.has(this.classify(error).category);
  }

  /**
   * True when the executor should retry within one model. Rate-limit is
   * excluded: hammering a shared per-key quota only deepens the throttle.
   */
  isRetryable(error: unknown): boolean {
    const category = this.classify(error).category;
    return TRANSIENT_ERROR_CATEGORIES.has(category) && category !== 'rate-limit';
  }

  /** True when the executor should try the next model in the fallback chain. */
  isModelFallbackCandidate(error: unknown): boolean {
    const aiError = this.classify(error);
    if (MODEL_FALLBACK_CATEGORIES.has(aiError.category)) return true;
    const { status, message } = readErrorShape(error);
    const lower = (message ?? '').toLowerCase();
    return (
      status === 404 ||
      lower.includes('not found') ||
      lower.includes('unsupported') ||
      lower.includes('invalid model') ||
      lower.includes('unknown model')
    );
  }
}

/** Shared Gemini-scoped classifier instance. */
export const geminiErrorClassifier = new AIErrorClassifier('gemini');
