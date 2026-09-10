/**
 * Publication pipeline — Architecture Knowledge Graph freshness gate.
 *
 * A traceability-required profile must not silently publish against a stale
 * (or absent) canonical graph: preflight raises a non-blocking `graph-stale`
 * warning. Profiles that do not require traceability are never penalized.
 */

import { describe, expect, it } from 'vitest';
import {
  runPackagePreflight,
  resolvePublicationProfile,
} from '../../services/publicationPipeline';
import { buildArchitectureKnowledgeGraph } from '../../services/architectureKnowledgeGraph';
import { fullBuildInput } from '../architectureKnowledgeGraph/fixtures';
import { worldClassDocument } from './fixtures';

const traceabilityProfile = resolvePublicationProfile('solution-design-document-package');
const graph = buildArchitectureKnowledgeGraph(fullBuildInput);

describe('publication preflight — graph freshness gate', () => {
  it('the chosen profile requires traceability (test premise)', () => {
    expect(traceabilityProfile.traceabilityRequired).toBe(true);
  });

  it('warns (does not block) when the graph is stale for a traceability-required profile', () => {
    const report = runPackagePreflight({
      packageId: 'pkg-stale',
      artifacts: [worldClassDocument()],
      profile: traceabilityProfile,
      graph,
      graphFreshness: 'stale',
    });
    const finding = report.findings.find((f) => f.code === 'graph-stale');
    expect(finding).toBeDefined();
    // The staleness gate warns — it is never itself a blocking finding.
    expect(finding!.blocking).toBe(false);
    expect(finding!.severity).toBe('high');
    expect(report.warnings.some((w) => w.code === 'graph-stale')).toBe(true);
  });

  it('warns when a traceability-required profile has no persisted graph at all', () => {
    const report = runPackagePreflight({
      packageId: 'pkg-no-graph',
      artifacts: [worldClassDocument()],
      profile: traceabilityProfile,
    });
    expect(report.findings.some((f) => f.code === 'graph-stale')).toBe(true);
  });

  it('does not warn when the graph is current', () => {
    const report = runPackagePreflight({
      packageId: 'pkg-current',
      artifacts: [worldClassDocument()],
      profile: traceabilityProfile,
      graph,
      graphFreshness: 'current',
    });
    expect(report.findings.some((f) => f.code === 'graph-stale')).toBe(false);
  });

  it('never raises a graph-stale finding for a profile that does not require traceability', () => {
    const nonTraceabilityProfile = { ...traceabilityProfile, traceabilityRequired: false };
    const report = runPackagePreflight({
      packageId: 'pkg-non-trace',
      artifacts: [worldClassDocument()],
      profile: nonTraceabilityProfile,
      graphFreshness: 'stale',
    });
    expect(report.findings.some((f) => f.code === 'graph-stale')).toBe(false);
  });
});
