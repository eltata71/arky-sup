import { describe, expect, it } from 'vitest';
import { resolveContract } from '../../services/artifactCompiler';
import { validateAgainstContract } from '../../services/artifactCompiler/validators';
import { computeUnifiedScore } from '../../services/artifactCompiler/scoring';
import { makeArtifact, brdComplete, richMarkdown, validDiagramIR } from './fixtures';

const score = (artifact: Parameters<typeof validateAgainstContract>[0]) => {
  const contract = resolveContract(artifact.type);
  const validation = validateAgainstContract(artifact, contract);
  return computeUnifiedScore(artifact, validation);
};

describe('computeUnifiedScore', () => {
  it('returns the ten canonical compilation dimensions', () => {
    const result = score(makeArtifact({ type: 'markdown', content: richMarkdown }));
    expect(result.dimensions).toHaveLength(10);
    const ids = result.dimensions.map((d) => d.id);
    expect(ids).toContain('cumplimiento-contrato');
    expect(ids).toContain('errores-criticos');
    expect(ids).toContain('exportabilidad');
    for (const dimension of result.dimensions) {
      expect(dimension.score).toBeGreaterThanOrEqual(0);
      expect(dimension.score).toBeLessThanOrEqual(100);
    }
  });

  it('scores an empty artifact at zero and blocks its tier', () => {
    const result = score(makeArtifact({ type: 'markdown', content: '' }));
    expect(result.value).toBe(0);
    expect(result.tier).toBe('blocked');
    expect(result.contractCompliance).toBe(0);
  });

  it('scores a complete SDD artifact above the blocked threshold', () => {
    const result = score(makeArtifact({ type: 'sdd-brd', content: brdComplete }));
    expect(result.value).toBeGreaterThan(50);
    expect(result.tier).not.toBe('blocked');
    expect(result.contractCompliance).toBeGreaterThan(70);
  });

  it('maps the world-class tier ladder onto fixed thresholds', () => {
    const result = score(makeArtifact({ type: 'markdown', content: richMarkdown }));
    const expectedTier =
      result.value >= 90 ? 'world-class'
        : result.value >= 80 ? 'ready'
          : result.value >= 70 ? 'usable-with-warnings'
            : result.value >= 50 ? 'needs-improvement'
              : 'blocked';
    expect(result.tier).toBe(expectedTier);
  });

  it('reuses the diagram quality gate for diagram artifacts (no document scoring)', () => {
    const result = score(makeArtifact({
      type: 'mermaid-c4-container',
      representation: 'diagram',
      content: 'C4Container\n  Container(a, "A")',
      ir: validDiagramIR(),
    }));
    expect(result.qualityReport.diagram).toBeDefined();
    expect(result.value).toBeGreaterThan(0);
  });
});
