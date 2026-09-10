import { describe, expect, it } from 'vitest';
import {
  AI_POLICIES,
  AI_POLICY_MODES,
  resolvePolicy,
} from '../../../../services/ai/core/AIPolicy';

describe('AIPolicy presets', () => {
  it('defines exactly the six named modes', () => {
    expect(AI_POLICY_MODES).toHaveLength(6);
    expect(AI_POLICY_MODES).toEqual(
      expect.arrayContaining([
        'fast',
        'balanced',
        'high-quality',
        'executive',
        'technical',
        'diagnostic',
      ]),
    );
  });

  it('routes fast → quick tier and high-quality → deep tier', () => {
    expect(AI_POLICIES.fast.modelTier).toBe('quick');
    expect(AI_POLICIES.balanced.modelTier).toBe('default');
    expect(AI_POLICIES['high-quality'].modelTier).toBe('deep');
    expect(AI_POLICIES.diagnostic.modelTier).toBe('deep');
  });

  it('keeps fast cheaper/quicker than high-quality', () => {
    expect(AI_POLICIES.fast.temperature).toBeLessThan(AI_POLICIES.balanced.temperature);
    expect(AI_POLICIES.fast.timeoutMs).toBeLessThan(AI_POLICIES['high-quality'].timeoutMs);
    expect(AI_POLICIES.fast.thinkingBudget).toBe(0);
  });

  it('diagnostic requires structured output; balanced keeps it optional', () => {
    expect(AI_POLICIES.diagnostic.structuredOutput).toBe('required');
    expect(AI_POLICIES.balanced.structuredOutput).toBe('optional');
  });

  it('high-quality / diagnostic disable the local shortcut', () => {
    expect(AI_POLICIES['high-quality'].allowLocalFallback).toBe(false);
    expect(AI_POLICIES.diagnostic.allowLocalFallback).toBe(false);
    expect(AI_POLICIES.balanced.allowLocalFallback).toBe(true);
  });

  it('resolvePolicy applies overrides without mutating the preset', () => {
    const custom = resolvePolicy('balanced', { maxRetries: 0, timeoutMs: 1000 });
    expect(custom.maxRetries).toBe(0);
    expect(custom.timeoutMs).toBe(1000);
    expect(custom.mode).toBe('balanced');
    // The shared preset stays untouched.
    expect(AI_POLICIES.balanced.maxRetries).not.toBe(0);
  });

  it('resolvePolicy falls back to balanced for an unknown mode', () => {
    const policy = resolvePolicy(undefined);
    expect(policy.mode).toBe('balanced');
  });
});
