/**
 * 14.0 — an artifact's stage is derived, never typed in, and every surface
 * shows the same words for it.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  buildArtifactTimeline,
  countArtifactLifecycle,
  deriveArtifactLifecycle,
  type LifecyclePublication,
} from '../../lib/artifacts/artifactLifecycle';
import { ArtifactLifecycleBadge, ArtifactVersionLifecycle } from '../../components/artifacts/ArtifactLifecycleBadge';
import { ArtifactLifecyclePanel } from '../../components/dashboard/ArtifactLifecyclePanel';

const pkg = (version: number, status = 'published'): LifecyclePublication => ({
  id: `pkg-${version}`, name: `Paquete ${version}`, status, publishedAt: `2026-10-0${version}T10:00:00Z`,
  artifactRefs: [{ versionGroupId: 'g-1', version }],
});

describe('deriveArtifactLifecycle', () => {
  it('reads the review stage from the artifact', () => {
    expect(deriveArtifactLifecycle({ versionGroupId: 'g-1', version: 1, reviewStatus: 'pending-review' }).stage).toBe('in-review');
    expect(deriveArtifactLifecycle({ versionGroupId: 'g-1', version: 1, reviewStatus: 'changes-requested' }).stage).toBe('changes-requested');
    expect(deriveArtifactLifecycle({ versionGroupId: 'g-1', version: 1 }).stage).toBe('draft');
  });

  it('is published only when a published package carries this very version', () => {
    const v2 = { versionGroupId: 'g-1', version: 2, reviewStatus: 'approved' as const };
    expect(deriveArtifactLifecycle(v2, [pkg(2)]).stage).toBe('published');
    const v3 = { ...v2, version: 3 };
    const later = deriveArtifactLifecycle(v3, [pkg(2)]);
    expect(later.stage).toBe('approved');
    expect(later.earlierVersionPublished).toBe(true);
    expect(deriveArtifactLifecycle(v2, [pkg(2, 'approved')]).stage).toBe('approved');
  });
});

describe('countArtifactLifecycle', () => {
  it('counts the latest version of each artifact, and says what it cannot measure', () => {
    const counts = countArtifactLifecycle([
      {
        artifactsLoaded: true,
        artifacts: [
          { versionGroupId: 'a', version: 1, reviewStatus: 'approved' },
          { versionGroupId: 'a', version: 2, reviewStatus: 'pending-review' },
          { versionGroupId: 'b', version: 1 },
        ],
      },
      {
        artifactsLoaded: false,
        artifactIndex: [{ versionGroupId: 'g-1', version: 2 }, { versionGroupId: 'c', version: 1 }],
        publicationPackages: [pkg(2)],
      },
    ]);
    expect(counts.byStage['in-review']).toBe(1);
    expect(counts.byStage.draft).toBe(1);
    expect(counts.byStage.approved).toBe(0);
    expect(counts.byStage.published).toBe(1);
    expect(counts.unmeasured).toBe(1);
  });
});

describe('buildArtifactTimeline', () => {
  it('orders versions, decisions and publications by date and drops undated events', () => {
    const events = buildArtifactTimeline({
      versions: [
        { id: 'v2', version: 2, versionGroupId: 'g-1', createdAt: '2026-10-02T09:00:00Z' },
        { id: 'v1', version: 1, versionGroupId: 'g-1', createdAt: '2026-10-01T09:00:00Z' },
      ],
      decisions: [{ status: 'approved', decidedAt: '2026-10-02T09:30:00Z', authorName: 'Ana' }, { status: 'rejected', decidedAt: '' }],
      packages: [pkg(2)],
    });
    expect(events.map((event) => event.kind)).toEqual(['version', 'version', 'decision', 'published']);
  });
});

describe('the same label everywhere', () => {
  it('the canvas badge, the hub row and the dashboard panel name a stage the same way', () => {
    render(
      <>
        <div data-testid="canvas"><ArtifactLifecycleBadge stage="changes-requested" /></div>
        <div data-testid="hub"><ArtifactVersionLifecycle artifact={{ versionGroupId: 'g', version: 1, reviewStatus: 'changes-requested' }} /></div>
        <div data-testid="dashboard">
          <ArtifactLifecyclePanel counts={{ byStage: { draft: 0, 'in-review': 0, 'changes-requested': 1, rejected: 0, approved: 0, published: 0 }, unmeasured: 0 }} />
        </div>
      </>,
    );
    for (const id of ['canvas', 'hub', 'dashboard']) {
      expect(screen.getByTestId(id)).toHaveTextContent('Cambios pedidos');
    }
  });

  it('the dashboard says how many it could not measure', () => {
    render(<ArtifactLifecyclePanel counts={{ byStage: { draft: 0, 'in-review': 0, 'changes-requested': 0, rejected: 0, approved: 0, published: 0 }, unmeasured: 4 }} />);
    expect(screen.getByText(/4 artefacto\(s\) sin medir/)).toBeInTheDocument();
  });
});
