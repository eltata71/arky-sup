import { describe, expect, it } from 'vitest';
import {
  runArtifactPreflight,
  runSingleArtifactPreflight,
  runPackagePreflight,
  resolvePublicationProfile,
} from '../../services/publicationPipeline';
import {
  worldClassDocument,
  emptyDocument,
  corruptDocument,
  compilationFailedDocument,
  mediumScoreDocument,
  skeletonDiagram,
  c4ContextDiagram,
} from './fixtures';

const technicalProfile = resolvePublicationProfile('technical-architecture-package');

describe('publication preflight — per-artifact checks', () => {
  it('passes a world-class artifact', () => {
    const result = runArtifactPreflight(worldClassDocument(), { qualityThreshold: 80 });
    expect(result.verdict).toBe('passed');
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.findings).toHaveLength(0);
  });

  it('blocks an empty artifact', () => {
    const result = runArtifactPreflight(emptyDocument());
    expect(result.verdict).toBe('blocked');
    expect(result.score).toBe(0);
    expect(result.findings.some((f) => f.code === 'artifact-empty' && f.blocking)).toBe(true);
  });

  it('blocks a corrupt artifact', () => {
    const result = runArtifactPreflight(corruptDocument());
    expect(result.verdict).toBe('blocked');
    expect(result.findings.some((f) => f.code === 'artifact-corrupt')).toBe(true);
  });

  it('blocks an artifact whose compilation failed', () => {
    const result = runArtifactPreflight(compilationFailedDocument());
    expect(result.verdict).toBe('blocked');
    expect(result.findings.some((f) => f.code === 'artifact-compilation-failed')).toBe(true);
  });

  it('warns (does not block) an artifact with a medium score', () => {
    const result = runArtifactPreflight(mediumScoreDocument(), { qualityThreshold: 80 });
    expect(result.verdict).toBe('warning');
    expect(result.findings.some((f) => f.code === 'artifact-low-score')).toBe(true);
    expect(result.findings.every((f) => !f.blocking)).toBe(true);
  });

  it('blocks a diagram that fell back to the skeleton', () => {
    const result = runArtifactPreflight(skeletonDiagram());
    expect(result.findings.some((f) => f.code === 'diagram-skeleton-fallback' && f.blocking)).toBe(true);
    expect(result.verdict).toBe('blocked');
  });

  it('never throws on a single-artifact preflight report', () => {
    expect(() => runSingleArtifactPreflight(corruptDocument(), technicalProfile)).not.toThrow();
    const report = runSingleArtifactPreflight(worldClassDocument(), technicalProfile);
    expect(report.scope).toBe('artifact');
    expect(report.artifactResults).toHaveLength(1);
  });
});

describe('publication preflight — package scope', () => {
  it('blocks an empty package', () => {
    const report = runPackagePreflight({
      packageId: 'pkg-1',
      artifacts: [],
      profile: technicalProfile,
    });
    expect(report.blocked).toBe(true);
    expect(report.canPublish).toBe(false);
  });

  it('runs the 27-check preflight over a package and degrades safely', () => {
    const report = runPackagePreflight({
      packageId: 'pkg-1',
      artifacts: [worldClassDocument(), c4ContextDiagram()],
      profile: technicalProfile,
    });
    expect(report.scope).toBe('package');
    expect(report.artifactResults).toHaveLength(2);
    expect(typeof report.score).toBe('number');
    expect(report.requiresApproval).toBe(true);
  });

  it('surfaces a blocked verdict when the package mixes good and corrupt artifacts', () => {
    const report = runPackagePreflight({
      packageId: 'pkg-1',
      artifacts: [worldClassDocument(), corruptDocument()],
      profile: technicalProfile,
    });
    expect(report.blocked).toBe(true);
    expect(report.requiredActions.length).toBeGreaterThan(0);
  });
});
