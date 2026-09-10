import { describe, expect, it } from 'vitest';
import {
  listPublicationProfiles,
  getPublicationProfile,
  resolvePublicationProfile,
  getProfileByAudience,
  listPublicationTemplates,
  resolvePublicationTemplate,
  createPublicationPackage,
  suggestPackageArtifacts,
} from '../../services/publicationPipeline';
import { worldClassDocument, c4ContextDiagram, c4ContainerDiagram, makeArtifact } from './fixtures';

describe('publication profile registry', () => {
  it('registers the six baseline publication profiles', () => {
    const ids = listPublicationProfiles().map((p) => p.id).sort();
    expect(ids).toEqual([
      'audit-evidence-package',
      'executive-architecture-brief',
      'implementation-handoff-package',
      'solution-design-document-package',
      'technical-architecture-package',
      'vendor-evaluation-package',
    ]);
  });

  it('resolves a profile by id', () => {
    const profile = getPublicationProfile('executive-architecture-brief');
    expect(profile?.audience).toBe('executive');
    expect(profile?.purpose).toBe('executive-briefing');
    expect(profile?.requiredSections.length).toBeGreaterThan(0);
  });

  it('falls back to the executive brief for an unknown profile id', () => {
    expect(resolvePublicationProfile('does-not-exist').id).toBe('executive-architecture-brief');
    expect(resolvePublicationProfile(undefined).id).toBe('executive-architecture-brief');
  });

  it('resolves a profile by audience', () => {
    expect(getProfileByAudience('audit')?.id).toBe('audit-evidence-package');
    expect(getProfileByAudience('technical')?.audience).toBe('technical');
  });

  it('derives flat artifact-type lists from the rich requirements', () => {
    const technical = getPublicationProfile('technical-architecture-package');
    expect(technical?.requiredArtifactTypes).toContain('mermaid-c4-context');
    expect(technical?.requiredArtifactTypes).toContain('mermaid-c4-container');
  });

  it('resolves an editorial template per profile and audience', () => {
    expect(listPublicationTemplates().length).toBeGreaterThanOrEqual(6);
    expect(resolvePublicationTemplate({ profileId: 'audit-evidence-package' }).audience).toBe('audit');
    expect(resolvePublicationTemplate({ audience: 'executive' }).audience).toBe('executive');
    // unknown query never misses
    expect(resolvePublicationTemplate({}).id).toBeTruthy();
  });
});

describe('publication package creation', () => {
  it('creates an empty package from a manual (empty) selection', () => {
    const pkg = createPublicationPackage(
      { projectId: 'proj-1', name: 'Paquete vacío', profileId: 'executive-architecture-brief', artifactIds: [] },
      [],
    );
    expect(pkg.status).toBe('draft');
    expect(pkg.version).toBe(1);
    expect(pkg.artifactRefs).toHaveLength(0);
    expect(pkg.auditTrail.some((e) => e.action === 'package-created')).toBe(true);
  });

  it('creates a package from a manual artifact selection in editorial order', () => {
    const artifacts = [c4ContainerDiagram(), worldClassDocument(), c4ContextDiagram()];
    const pkg = createPublicationPackage(
      {
        projectId: 'proj-1',
        name: 'Paquete técnico',
        profileId: 'technical-architecture-package',
        artifactIds: artifacts.map((a) => a.id),
      },
      artifacts,
    );
    expect(pkg.artifactRefs).toHaveLength(3);
    // documents sort before diagrams editorially
    expect(pkg.artifactRefs[0].type).toBe('markdown');
  });

  it('suggests artifacts that satisfy a profile when no selection is given', () => {
    const artifacts = [c4ContextDiagram(), c4ContainerDiagram(), makeArtifact()];
    const suggested = suggestPackageArtifacts(
      getPublicationProfile('technical-architecture-package')!,
      artifacts,
    );
    expect(suggested).toContain('art-c4-context');
    expect(suggested).toContain('art-c4-container');
  });
});
