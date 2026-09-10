/**
 * The OpenRouter barrel must re-export the model catalog so consumers can
 * import everything from `providers/openrouter` instead of reaching into the
 * module files directly (follow-up of PR #204).
 */

import { describe, expect, it } from 'vitest';
import * as barrel from '../../../../services/ai/providers/openrouter';
import {
  listCurrentOpenRouterModels,
  OPENROUTER_FALLBACK_MODELS,
  OPENROUTER_MODEL_TIERS,
} from '../../../../services/ai/providers/openrouter/openRouterModels';

describe('openrouter barrel', () => {
  it('re-exports the model catalog identities', () => {
    expect(barrel.OPENROUTER_MODEL_TIERS).toBe(OPENROUTER_MODEL_TIERS);
    expect(barrel.OPENROUTER_FALLBACK_MODELS).toBe(OPENROUTER_FALLBACK_MODELS);
    expect(barrel.listCurrentOpenRouterModels).toBe(listCurrentOpenRouterModels);
  });

  it('keeps exporting the provider and error/SSE helpers', () => {
    expect(barrel.OpenRouterProvider).toBeTypeOf('function');
    expect(barrel.openRouterErrorClassifier).toBeDefined();
    expect(barrel.parseSSE).toBeTypeOf('function');
    expect(barrel.openRouterDelta).toBeTypeOf('function');
  });
});
