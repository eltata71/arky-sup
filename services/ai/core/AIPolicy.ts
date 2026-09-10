/**
 * AIPolicy — the operating contract for a single AI request.
 *
 * A policy bundles the *resilience* and *quality* knobs (model tier,
 * temperature, thinking budget, timeout, retries, fallback flags, structured
 * output requirement) so call sites pick a named mode instead of spreading
 * magic numbers. The six presets below mirror the `AIGenerationModeId` modes.
 */

import type { AIModelTier } from './AIModel';
import type { AIGenerationModeId } from './AIRequest';

/** How strict the structured-output requirement is for a request. */
export type StructuredOutputRequirement = 'required' | 'optional' | 'off';

/** Named policy mode — one preset per high-level generation mode. */
export type AIPolicyMode = AIGenerationModeId;

export interface AIPolicy {
  /** Mode this policy was derived from. */
  mode: AIGenerationModeId;
  /** Model tier the router should resolve. */
  modelTier: AIModelTier;
  /** Sampling temperature (0..1). */
  temperature: number;
  /** Nucleus sampling cutoff. */
  topP?: number;
  /** Reasoning/thinking token budget (0 disables thinking). */
  thinkingBudget?: number;
  /** Per-attempt timeout in ms. */
  timeoutMs: number;
  /** Max in-model retries on transient errors. */
  maxRetries: number;
  /** Whether the executor may try other models in the fallback chain. */
  allowModelFallback: boolean;
  /** Whether the executor may try other providers. */
  allowProviderFallback: boolean;
  /** Whether a deterministic local fallback may replace a failed generation. */
  allowLocalFallback: boolean;
  /** How strict the structured-output requirement is. */
  structuredOutput: StructuredOutputRequirement;
  /** Defensive hard cap on prompt size in characters. */
  maxPromptChars: number;
}

const DEFAULT_MAX_PROMPT_CHARS = 1_500_000;

/**
 * Canonical policy presets — one per generation mode.
 *
 *  - `fast`        mechanical hops; flash-lite tier, thinking off, tight timeout.
 *  - `balanced`    default UX; flash tier, light thinking.
 *  - `high-quality`pro tier, generous thinking + timeout, no local shortcut.
 *  - `executive`   concise outputs; flash tier, low temperature, JSON optional.
 *  - `technical`   detailed outputs; flash tier, more thinking than executive.
 *  - `diagnostic`  verbose critique/trace path; pro tier, deterministic temp.
 */
export const AI_POLICIES: Record<AIGenerationModeId, AIPolicy> = {
  fast: {
    mode: 'fast',
    modelTier: 'quick',
    temperature: 0.2,
    thinkingBudget: 0,
    timeoutMs: 45_000,
    maxRetries: 2,
    allowModelFallback: true,
    allowProviderFallback: false,
    allowLocalFallback: true,
    structuredOutput: 'optional',
    maxPromptChars: DEFAULT_MAX_PROMPT_CHARS,
  },
  balanced: {
    mode: 'balanced',
    modelTier: 'default',
    temperature: 0.6,
    thinkingBudget: 512,
    timeoutMs: 90_000,
    maxRetries: 2,
    allowModelFallback: true,
    allowProviderFallback: false,
    allowLocalFallback: true,
    structuredOutput: 'optional',
    maxPromptChars: DEFAULT_MAX_PROMPT_CHARS,
  },
  'high-quality': {
    mode: 'high-quality',
    modelTier: 'deep',
    temperature: 0.5,
    thinkingBudget: 4096,
    timeoutMs: 180_000,
    maxRetries: 3,
    allowModelFallback: true,
    allowProviderFallback: false,
    allowLocalFallback: false,
    structuredOutput: 'optional',
    maxPromptChars: DEFAULT_MAX_PROMPT_CHARS,
  },
  executive: {
    mode: 'executive',
    modelTier: 'default',
    temperature: 0.4,
    thinkingBudget: 512,
    timeoutMs: 90_000,
    maxRetries: 2,
    allowModelFallback: true,
    allowProviderFallback: false,
    allowLocalFallback: true,
    structuredOutput: 'optional',
    maxPromptChars: DEFAULT_MAX_PROMPT_CHARS,
  },
  technical: {
    mode: 'technical',
    modelTier: 'default',
    temperature: 0.45,
    thinkingBudget: 1024,
    timeoutMs: 120_000,
    maxRetries: 2,
    allowModelFallback: true,
    allowProviderFallback: false,
    allowLocalFallback: true,
    structuredOutput: 'optional',
    maxPromptChars: DEFAULT_MAX_PROMPT_CHARS,
  },
  diagnostic: {
    mode: 'diagnostic',
    modelTier: 'deep',
    temperature: 0.3,
    thinkingBudget: 2048,
    timeoutMs: 180_000,
    maxRetries: 3,
    allowModelFallback: true,
    allowProviderFallback: false,
    allowLocalFallback: false,
    structuredOutput: 'required',
    maxPromptChars: DEFAULT_MAX_PROMPT_CHARS,
  },
};

/**
 * Resolve the policy for a mode, applying optional per-call overrides.
 * Returns a fresh object so callers can never mutate the shared preset.
 */
export function resolvePolicy(
  mode: AIGenerationModeId = 'balanced',
  overrides: Partial<AIPolicy> = {},
): AIPolicy {
  const base = AI_POLICIES[mode] ?? AI_POLICIES.balanced;
  return { ...base, ...overrides, mode: base.mode };
}

/** All policy mode ids — handy for tests and settings UIs. */
export const AI_POLICY_MODES: readonly AIGenerationModeId[] = Object.keys(
  AI_POLICIES,
) as AIGenerationModeId[];
