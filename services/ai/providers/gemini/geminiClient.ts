import { GoogleGenAI } from '@google/genai';

/**
 * Thin AI-provider boundary for Gemini calls.
 *
 * The current deployment is frontend-only, so this still returns the official
 * browser SDK client. Keeping construction behind this service prevents direct
 * SDK coupling from leaking into components and gives a single seam for a
 * future Vercel/serverless proxy (recommended for hiding API keys and shielding
 * iPad/Safari from SDK transport quirks).
 */
export interface GeminiAIProviderOptions {
  apiKey: string;
}

export function createGeminiAIClient({ apiKey }: GeminiAIProviderOptions): GoogleGenAI {
  return new GoogleGenAI({ apiKey });
}

