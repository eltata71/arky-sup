import { describe, expect, it } from 'vitest';
import {
  createPublicationPackage,
  resolvePublicationProfile,
  evaluatePackageReadiness,
  buildPublicationReport,
  resolveArtifactCompilation,
  buildTraceabilityResult,
  evaluateProjectPackage,
  createPackageForProject,
  runProjectPackagePreflight,
  validatePublicationPackages,
  validatePublicationPackage,
  readPublicationPackages,
  attachPublicationPackages,
  runPublicationExportBatch,
  type PublicationProjectInput,
} from '../../services/publicationPipeline';
import { buildArchitectureKnowledgeGraphForProject } from '../../services/architectureKnowledgeGraph';
import { validateProject } from '../../services/architectureProjects/projectRuntimeValidation';
import {
  worldClassDocument,
  c4ContextDiagram,
  c4ContainerDiagram,
  corruptDocument,
  makeArtifact,
  makeProject,
} from './fixtures';

const executiveProfile = resolvePublicationProfile('executive-architecture-brief');
const technicalProfile = resolvePublicationProfile('technical-architecture-package');

describe('publication readiness — profile evaluation', () => {
  it('grades a complete executive package as ready to publish', () => {
    const artifacts = [c4ContextDiagram(), worldClassDocument()];
    const pkg = createPublicationPackage(
      { projectId: 'p', name: 'Brief', profileId: 'executive-architecture-brief', artifactIds: artifacts.map((a) => a.id) },
      artifacts,
    );
    const readiness = evaluatePackageReadiness({ pkg, profile: executiveProfile, artifacts });
    expect(readiness.canPublish).toBe(true);
    expect(readiness.blockers).toHaveLength(0);
  });

  it('blocks a technical package that is missing required artifacts', () => {
    const artifacts = [worldClassDocument()];
    const pkg = createPublicationPackage(
      { projectId: 'p', name: 'Técnico', profileId: 'technical-architecture-package', artifactIds: ['art-wc-doc'] },
      artifacts,
    );
    const readiness = evaluatePackageReadiness({ pkg, profile: technicalProfile, artifacts });
    expect(readiness.status).toBe('blocked');
    expect(readiness.coverageResults.some((c) => c.required && !c.satisfied)).toBe(true);
    expect(readiness.blockers.some((b) => b.code === 'profile-requirement-unmet')).toBe(true);
  });

  it('grades a complete technical package without required-coverage blockers', () => {
    const artifacts = [c4ContextDiagram(), c4ContainerDiagram(), worldClassDocument()];
    const pkg = createPublicationPackage(
      { projectId: 'p', name: 'Técnico', profileId: 'technical-architecture-package', artifactIds: artifacts.map((a) => a.id) },
      artifacts,
    );
    const readiness = evaluatePackageReadiness({ pkg, profile: technicalProfile, artifacts });
    expect(readiness.coverageResults.filter((c) => c.required && !c.satisfied)).toHaveLength(0);
  });

  it('generates a publication report with the key sections', () => {
    const artifacts = [c4ContextDiagram(), worldClassDocument()];
    const pkg = createPublicationPackage(
      { projectId: 'p', name: 'Brief', profileId: 'executive-architecture-brief', artifactIds: artifacts.map((a) => a.id) },
      artifacts,
    );
    const readiness = evaluatePackageReadiness({ pkg, profile: executiveProfile, artifacts });
    const report = buildPublicationReport(pkg, executiveProfile, readiness, 'Proyecto X');
    expect(report.markdown).toContain('Reporte de publicación');
    expect(report.markdown).toContain('Veredicto global');
    expect(report.markdown).toContain('Historial de auditoría');
    expect(report.summary).toContain('Proyecto X');
  });
});

describe('publication — Artifact Compiler integration', () => {
  it('reuses a persisted compiler snapshot when present', () => {
    const summary = resolveArtifactCompilation(worldClassDocument());
    expect(summary.compilerScore).toBe(95);
    expect(summary.compilerTier).toBe('world-class');
  });

  it('computes a compiler snapshot when none is persisted', () => {
    const artifact = makeArtifact({ id: 'no-comp', compilation: undefined });
    const summary = resolveArtifactCompilation(artifact);
    expect(typeof summary.compilerScore).toBe('number');
    expect(summary.compilerStatus).toBeTruthy();
  });

  it('recomputes when the persisted snapshot is stale (content drifted)', () => {
    // The persisted snapshot describes the original world-class content.
    const original = worldClassDocument();
    expect(resolveArtifactCompilation(original).compilerScore).toBe(95);

    // The artifact's content drifts after the snapshot was written. Preflight
    // must NOT keep trusting the obsolete score — it recompiles instead.
    const drifted = { ...original, content: '# Vacío parcial\n\nContenido recortado.' };
    const summary = resolveArtifactCompilation(drifted);
    expect(summary.compilerScore).not.toBe(95);
    // The recomputed summary is fresh for the drifted content.
    expect(summary.sourceSignature).toBeTruthy();
  });
});

describe('publication — Architecture Knowledge Graph integration', () => {
  it('folds graph traceability into the readiness report', () => {
    const project = makeProject([worldClassDocument(), c4ContextDiagram()]);
    const graph = buildArchitectureKnowledgeGraphForProject(project);
    const result = buildTraceabilityResult(graph, project.artifacts.map((a) => a.id));
    expect(result.verdict).toMatch(/passed|warning|blocked/);
    expect(typeof result.graphCoverage).toBe('number');
  });

  it('evaluates a project package end-to-end with a graph', () => {
    const project = makeProject([worldClassDocument(), c4ContextDiagram()]);
    const graph = buildArchitectureKnowledgeGraphForProject(project);
    const input: PublicationProjectInput = {
      projectId: project.id,
      projectName: project.name,
      artifacts: project.artifacts,
      architectureKnowledgeGraph: graph,
    };
    const pkg = createPackageForProject(input, {
      name: 'Brief', profileId: 'executive-architecture-brief',
      artifactIds: project.artifacts.map((a) => a.id),
    });
    const evaluation = evaluateProjectPackage(input, pkg);
    expect(evaluation.readiness.packageId).toBe(pkg.id);
    expect(evaluation.report.markdown.length).toBeGreaterThan(0);
  });
});

describe('publication — export reuses existing adapters', () => {
  it('exports the publication report and manifest through the export adapters', async () => {
    const artifacts = [worldClassDocument(), c4ContextDiagram()];
    const input: PublicationProjectInput = {
      projectId: 'p', projectName: 'Proyecto X', artifacts,
    };
    const pkg = createPackageForProject(input, {
      name: 'Brief', profileId: 'executive-architecture-brief', artifactIds: artifacts.map((a) => a.id),
    });
    const evaluation = evaluateProjectPackage(input, pkg);
    const { manifest } = (await import('../../services/publicationPipeline')).generateProjectPackageManifest(input, pkg);
    const batch = await runPublicationExportBatch({
      pkg,
      profile: evaluation.profile,
      readiness: evaluation.readiness,
      report: evaluation.report,
      manifest,
      artifacts,
      jobs: [
        { kind: 'report', format: 'md' },
        { kind: 'manifest', format: 'json' },
        { kind: 'artifact', format: 'md', artifactId: 'art-wc-doc' },
      ],
      triggerDownload: false,
    });
    expect(batch.outcomes).toHaveLength(3);
    expect(batch.outcomes.every((o) => o.success)).toBe(true);
    expect(batch.manifestFiles.length).toBe(3);
  });
});

describe('publication — runtime validation', () => {
  it('drops corrupt packages and keeps valid ones', () => {
    const valid = createPublicationPackage(
      { projectId: 'p', name: 'OK', profileId: 'executive-architecture-brief', artifactIds: [] }, [],
    );
    const result = validatePublicationPackages([valid, { id: '' }, null, { foo: 'bar' }]);
    expect(result.value).toHaveLength(1);
    expect(result.value?.[0].id).toBe(valid.id);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('applies safe defaults to a partially-corrupt package', () => {
    const result = validatePublicationPackage({
      id: 'pkg-x', projectId: 'p', artifactRefs: 'not-an-array', auditTrail: null,
    });
    expect(result.value).not.toBeNull();
    expect(result.value?.status).toBe('draft');
    expect(result.value?.artifactRefs).toEqual([]);
    expect(result.value?.profileId).toBe('executive-architecture-brief');
  });
});

describe('publication — persistence compatibility', () => {
  it('reads an empty package list from a legacy project', () => {
    const legacy = makeProject([worldClassDocument()]);
    expect(readPublicationPackages(legacy)).toEqual([]);
  });

  it('round-trips packages through attach/read', () => {
    const pkg = createPublicationPackage(
      { projectId: 'p', name: 'OK', profileId: 'executive-architecture-brief', artifactIds: [] }, [],
    );
    const project = attachPublicationPackages(makeProject([]), [pkg]);
    expect(readPublicationPackages(project)).toHaveLength(1);
  });

  it('validateProject preserves valid publication packages and drops corrupt ones', () => {
    const pkg = createPublicationPackage(
      { projectId: 'proj-pub-1', name: 'OK', profileId: 'executive-architecture-brief', artifactIds: [] }, [],
    );
    const result = validateProject({
      ...makeProject([]),
      publicationPackages: [pkg, { id: '' }],
    });
    expect(result.value?.publicationPackages).toHaveLength(1);
  });

  it('keeps legacy projects valid when no publication packages are present', () => {
    const result = validateProject(makeProject([worldClassDocument()]));
    expect(result.value).not.toBeNull();
    expect(result.value?.publicationPackages).toBeUndefined();
  });
});

describe('publication — degrades safely (no blank screen)', () => {
  it('never throws when evaluating a package built from corrupt artifacts', () => {
    const artifacts = [corruptDocument()];
    const pkg = createPublicationPackage(
      { projectId: 'p', name: 'Roto', profileId: 'executive-architecture-brief', artifactIds: ['art-corrupt'] },
      artifacts,
    );
    expect(() => evaluatePackageReadiness({ pkg, profile: executiveProfile, artifacts })).not.toThrow();
    const readiness = evaluatePackageReadiness({ pkg, profile: executiveProfile, artifacts });
    expect(readiness.status).toBe('blocked');
  });

  it('runProjectPackagePreflight always returns a report', () => {
    const input: PublicationProjectInput = { projectId: 'p', projectName: 'X', artifacts: [corruptDocument()] };
    const pkg = createPackageForProject(input, {
      name: 'Roto', profileId: 'technical-architecture-package', artifactIds: ['art-corrupt'],
    });
    const report = runProjectPackagePreflight(input, pkg);
    expect(report.scope).toBe('package');
    expect(report.blocked).toBe(true);
  });
});
