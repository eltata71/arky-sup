import React from 'react';
import { Badge, type BadgeTone } from '../ui/Badge';
import { deriveArtifactLifecycle, type ArtifactLifecycleStage, type LifecyclePublication } from '../../lib/artifacts/artifactLifecycle';
import type { Artifact } from '../../lib/artifacts';
import { useUiText } from '../../hooks/useUiText';

const STAGE_TONE: Record<ArtifactLifecycleStage, BadgeTone> = {
  draft: 'gray',
  'in-review': 'info',
  'changes-requested': 'warning',
  approved: 'success',
  rejected: 'danger',
  published: 'primary',
};

export interface ArtifactLifecycleBadgeProps {
  stage: ArtifactLifecycleStage;
  /** An earlier version was published and this one has not been. */
  earlierVersionPublished?: boolean;
  className?: string;
}

/**
 * The artifact's stage (14.0), with the same words on the canvas, the hub and
 * the dashboard. The stage comes from `deriveArtifactLifecycle`; nothing here
 * decides it. No live region: a list of artifacts is not a list of
 * announcements.
 */
export const ArtifactLifecycleBadge: React.FC<ArtifactLifecycleBadgeProps> = ({ stage, earlierVersionPublished = false, className }) => {
  const t = useUiText();
  return (
    <Badge tone={STAGE_TONE[stage]} dot size="sm" className={className} data-lifecycle-stage={stage}>
      {t(`lifecycle.stage.${stage}`)}
      {earlierVersionPublished && <span className="font-normal opacity-80"> · {t('lifecycle.earlierPublished')}</span>}
    </Badge>
  );
};

export interface ArtifactVersionLifecycleProps {
  artifact: Pick<Artifact, 'version' | 'versionGroupId' | 'reviewStatus'>;
  packages?: readonly LifecyclePublication[];
  className?: string;
}

/** Version and stage together — what a card or a table row shows. */
export const ArtifactVersionLifecycle: React.FC<ArtifactVersionLifecycleProps> = ({ artifact, packages = [], className }) => {
  const lifecycle = deriveArtifactLifecycle(artifact, packages);
  return (
    <span className={`inline-flex flex-wrap items-center justify-end gap-1.5 ${className ?? ''}`}>
      <ArtifactLifecycleBadge stage={lifecycle.stage} earlierVersionPublished={lifecycle.earlierVersionPublished} />
      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600 ring-1 ring-slate-200 dark:bg-white/[0.06] dark:text-slate-300 dark:ring-white/10">v{artifact.version}</span>
    </span>
  );
};

export default ArtifactLifecycleBadge;
