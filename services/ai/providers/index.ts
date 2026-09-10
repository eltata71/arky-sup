/**
 * `services/ai/providers` — concrete `AIProvider` implementations and the
 * factory that selects between them.
 */

export { GeminiProvider } from './gemini/GeminiProvider';
export type { GeminiProviderOptions } from './gemini/GeminiProvider';
export { OpenRouterProvider } from './openrouter/OpenRouterProvider';
export type { OpenRouterProviderOptions } from './openrouter/OpenRouterProvider';
export {
  AIProviderFactory,
  aiProviderFactory,
} from './AIProviderFactory';
export type {
  AIProviderBuilder,
  AIProviderCapability,
  AIProviderFactoryOptions,
} from './AIProviderFactory';
