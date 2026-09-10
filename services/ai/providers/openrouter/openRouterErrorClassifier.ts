/**
 * openRouterErrorClassifier — OpenRouter-scoped error classifier.
 *
 * `AIErrorClassifier` is a concrete class (not an interface); we subclass it
 * with `providerId = 'openrouter'` so every produced `AIError.provider` is
 * stamped correctly and `isRetryable` / `isTransient` / `isModelFallbackCandidate`
 * keep working through the base implementation.
 *
 * The base classifier already maps structured statuses (429 → rate-limit,
 * 401/403 → auth, 5xx → overloaded, network signals → network). OpenRouter
 * sometimes only surfaces an HTTP code or code-ish string inside the *message*
 * (e.g. "HTTP 429 Too Many Requests"), so we add message-text heuristics on top
 * and delegate everything else to the base classifier.
 */

import { AIErrorClassifier } from '../../errors/AIErrorClassifier';
import { AIError, type AIErrorCategory } from '../../core/AIError';

const RATE_LIMIT_RE = /429|rate.?limit|too many/i;
const AUTH_RE = /401|403|unauthorized|api key|invalid api/i;
const SERVER_RE =
  /5\d\d|high demand|overloaded|unavailable|internal|bad gateway|gateway timeout/i;

export class OpenRouterErrorClassifier extends AIErrorClassifier {
  constructor() {
    super('openrouter');
  }

  override classify(error: unknown): AIError {
    if (error instanceof AIError) return error;

    const message = error instanceof Error ? error.message : String(error);

    if (RATE_LIMIT_RE.test(message)) {
      return this.build('rate-limit', message, true);
    }
    if (AUTH_RE.test(message)) {
      return this.build('auth', message, false);
    }
    if (SERVER_RE.test(message)) {
      // 5xx — OpenRouter is overloaded/unavailable; retryable transient.
      return this.build('overloaded', message, true);
    }
    // Everything else (network, timeout, malformed response, structured
    // statuses, etc.) is delegated to the provider-scoped base classifier.
    return super.classify(error);
  }

  private build(category: AIErrorCategory, message: string, retryable: boolean): AIError {
    return new AIError({
      category,
      provider: 'openrouter',
      message,
      userMessage: USER_MESSAGES[category],
      retryable,
      errorCode: category,
      cause: message,
    });
  }
}

/** Localised, user-facing messages per OpenRouter error category. */
const USER_MESSAGES: Record<AIErrorCategory, string> = {
  'rate-limit':
    'Has alcanzado el límite de peticiones de OpenRouter. Reintenta en unos segundos.',
  auth: 'API Key de OpenRouter inválida. Revísala en Configuración > IA.',
  overloaded:
    'OpenRouter está saturado o con un problema interno. Reintenta en unos segundos.',
  'invalid-request': 'La solicitud a OpenRouter no es válida. Revisa los parámetros.',
  timeout: 'OpenRouter tardó demasiado en responder. Reintenta o simplifica la petición.',
  network:
    'No se pudo contactar con OpenRouter. Verifica tu conexión: se reintentará automáticamente.',
  'malformed-response': 'OpenRouter devolvió una respuesta malformada.',
  'empty-response': 'OpenRouter devolvió una respuesta vacía. Reintenta.',
  sdk: 'El SDK de OpenRouter devolvió un error inesperado.',
  configuration: 'La integración de OpenRouter no está configurada. Revisa tu API Key.',
  aborted: 'La operación de OpenRouter fue cancelada.',
  unknown: 'Ocurrió un error inesperado al hablar con OpenRouter. Reintenta.',
};

/** Shared OpenRouter-scoped classifier instance. */
export const openRouterErrorClassifier = new OpenRouterErrorClassifier();
