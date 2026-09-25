/**
 * The public API of `services/ai` does not resolve to the engine.
 *
 * Finding 10 of the modular-monolith review was "the canonical AI layer leaks
 * the legacy engine through its own public API", and the first pass fixed the
 * half that was visible: no module outside `services/ai` imports
 * `geminiService`. The other half survived it — the barrel itself re-exported
 * `AIServiceError`, `classifyAIError`, `C4SelfHealingError`, four deterministic
 * fallbacks and a type, straight out of the monolith. Seven screens catch
 * `AIServiceError`; every one of them was reaching the engine through the door
 * built to hide it, and nothing said so.
 *
 * ESLint enforces the rule on `services/ai/index.ts`. This asserts the same
 * thing on the file, because a lint rule can be relaxed in a config nobody
 * reads twice, and because the interesting assertion is the second one: the
 * symbols still exist. Moving them was not allowed to remove them.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const BARREL = readFileSync('services/ai/index.ts', 'utf8');

/**
 * El barril de la IA en frío tarda ~10 s en transformarse; con la suite
 * completa en un equipo cargado pasaba de los 20 s de límite y la primera
 * aserción que lo importaba fallaba por tiempo, no por lo que comprueba. Se
 * paga aquí, una vez y con su propio límite (F6-01; mismo caso que
 * `OfficeContext.test.tsx`).
 */
beforeAll(async () => {
  await import('../../../services/ai');
}, 120_000);

describe('the barrel does not re-export the engine', () => {
  it('names the engine nowhere, under its old name or its new one', () => {
    expect(BARREL).not.toMatch(/geminiService|artifactGenerationEngine/);
  });

  it('sources the error surface from `./errors`', () => {
    // Where they live now: `services/ai/errors/aiServiceError.ts`, beside the
    // per-provider classifier that came later.
    expect(BARREL).toMatch(/AIServiceError,[\s\S]*?\}\s*from '\.\/errors'/);
  });

  it('does not publish the deterministic fallbacks at all', () => {
    // They are `services/artifacts`: pure functions from a project and a
    // template to Mermaid or Markdown, with no model call in them.
    for (const symbol of [
      'buildDeterministicArtifactFallback',
      'buildDeterministicDiagramSkeleton',
      'isSkeletonFallbackContent',
      'markMermaidAsSkeletonFallback',
    ]) {
      expect(BARREL, `${symbol} is back in the AI barrel`).not.toContain(symbol);
    }
  });
});

describe('what the barrel promised is still there', () => {
  it('exports the error surface the UI catches', async () => {
    const ai = await import('../../../services/ai');
    expect(typeof ai.AIServiceError).toBe('function');
    expect(typeof ai.C4SelfHealingError).toBe('function');
    expect(typeof ai.classifyAIError).toBe('function');
    expect(typeof ai.isTransientGeminiError).toBe('function');
  }, 30000);

  it('classifies an error into the same category as before the move', async () => {
    const { classifyAIError, AIServiceError } = await import('../../../services/ai');
    const rateLimited = classifyAIError({ status: 429, message: 'Too many requests' });
    expect(rateLimited).toBeInstanceOf(AIServiceError);
    expect(rateLimited.category).toBe('rate-limit');
    expect(rateLimited.retryable).toBe(true);
    expect(rateLimited.source).toBe('provider-rate-limit');
  });

  it('keeps `classifyAIError` idempotent on an already-classified error', async () => {
    const { classifyAIError } = await import('../../../services/ai');
    const once = classifyAIError({ status: 503, message: 'Unavailable' });
    expect(classifyAIError(once)).toBe(once);
  });
});

describe('the deterministic fallbacks kept working from their new home', () => {
  it('stamps the skeleton marker the canvas looks for', async () => {
    const { buildDeterministicDiagramSkeleton, isSkeletonFallbackContent } = await import(
      '../../../services/artifacts/deterministicArtifactFallbacks'
    );
    const content = buildDeterministicDiagramSkeleton(
      { id: 'p1', name: 'Siniestros', description: 'Core de siniestros', artifacts: [] } as never,
      { name: 'Contexto', type: 'mermaid-flowchart', objective: 'Vista general' } as never,
    );
    expect(isSkeletonFallbackContent(content)).toBe(true);
  });
});
