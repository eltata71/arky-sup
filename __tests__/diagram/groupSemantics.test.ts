import { describe, expect, it } from 'vitest';
import { resolveGroupSemanticStyle } from '../../services/diagram/groupSemantics';

describe('groupSemantics', () => {
  it('returns lane semantics for swimlane groups', () => {
    const style = resolveGroupSemanticStyle('swimlane', 0);
    expect(style.semanticRole).toBe('lane');
    expect(style.padTop).toBeGreaterThan(style.padBottom);
  });

  it('returns security-specific boundary style', () => {
    const style = resolveGroupSemanticStyle('security', 1);
    expect(style.semanticRole).toBe('boundary');
    expect(style.borderStyle).toBe('dashed');
    expect(style.borderWidth).toBeGreaterThanOrEqual(1.8);
  });

  it('falls back deterministically when kind is missing', () => {
    const styleA = resolveGroupSemanticStyle(undefined, 7);
    const styleB = resolveGroupSemanticStyle(undefined, 7);
    expect(styleA.color.border).toBe(styleB.color.border);
    expect(styleA.semanticRole).toBe('zone');
  });
});
