export { AIErrorClassifier, geminiErrorClassifier, readErrorShape } from './AIErrorClassifier';
/**
 * What to do about a failure, decided from the canonical error rather than from
 * one vendor's SDK. See `retryDecisions` for why the split exists.
 */
export {
  isModelFallbackCandidate,
  isProviderFallbackCandidate,
  isRetryableError,
  reflectsProviderHealth,
} from './retryDecisions';
// The error surface the whole UI catches. It lives here rather than in the
// engine so `services/ai`'s public API stops resolving to `geminiService`.
export {
  AIServiceError,
  C4SelfHealingError,
  classifyAIError,
  isTransientGeminiError,
} from './aiServiceError';
