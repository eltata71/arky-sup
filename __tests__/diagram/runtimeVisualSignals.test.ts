import { describe, expect, it } from 'vitest';
import { deriveRuntimeVisualSignals } from '../../services/diagram/runtimeVisualSignals';

describe('deriveRuntimeVisualSignals', () => {
  it('adds generation trace errors and last diagram error', () => {
    const signals = deriveRuntimeVisualSignals({
      generationTrace: { errors: [{ message: 'a' }, { message: 'b' }] } as never,
      lastDiagramError: { reason: 'render-crash', timestamp: new Date().toISOString() } as never,
    });
    expect(signals.recentRenderErrors).toBe(3);
  });

  it('forwards export preflight readiness when provided', () => {
    const signals = deriveRuntimeVisualSignals({ generationTrace: undefined, lastDiagramError: undefined }, false);
    expect(signals.exportPreflightOk).toBe(false);
  });
});
