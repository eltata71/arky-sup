import React, { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { Artifact } from '../../lib/artifacts';
import { buildArtifactTimeline, deriveArtifactLifecycle, type LifecyclePublication } from '../../lib/artifacts/artifactLifecycle';
import { artifactReviewService } from '../../services/review';
import { useOptionalAppContext } from '../../context/AppContext';
import { useUiText } from '../../hooks/useUiText';
import { formatDateTime } from '../../utils/datetime';
import { ArtifactLifecycleBadge } from './ArtifactLifecycleBadge';

const EMPTY: readonly LifecyclePublication[] = [];

/** The project's versions of this artifact and its packages, read from the context that holds them. */
function useArtifactProjectState(artifact: Artifact, projectId: string) {
  const project = useOptionalAppContext()?.getProject(projectId);
  const packages = (project?.publicationPackages ?? EMPTY) as readonly LifecyclePublication[];
  const versions = useMemo(
    () => (project?.artifacts ?? [artifact]).filter((item) => item.versionGroupId === artifact.versionGroupId),
    [project?.artifacts, artifact],
  );
  return { packages, versions };
}

/** The artifact's stage, for a place that only knows the artifact and its project. */
export const ArtifactLifecycleStage: React.FC<{ artifact: Artifact; projectId: string }> = ({ artifact, projectId }) => {
  const { packages } = useArtifactProjectState(artifact, projectId);
  return <ArtifactLifecycleBadge {...deriveArtifactLifecycle(artifact, packages)} />;
};

/**
 * The artifact's life in one line (14.0): its versions, the review decisions
 * and the publications that carried it, oldest first, each with its date. The
 * events come from `buildArtifactTimeline`; this only draws them.
 */
export const ArtifactLifecycleTimeline: React.FC<{ artifact: Artifact; projectId: string }> = ({ artifact, projectId }) => {
  const t = useUiText();
  const { packages, versions } = useArtifactProjectState(artifact, projectId);
  const decisions = useSyncExternalStore(
    useCallback((listener: () => void) => artifactReviewService.subscribe(listener), []),
    useCallback(() => artifactReviewService.listDecisions(artifact.id), [artifact.id]),
    useCallback(() => artifactReviewService.listDecisions(artifact.id), [artifact.id]),
  );
  const events = useMemo(() => buildArtifactTimeline({
    versions,
    packages,
    decisions: decisions.map((decision) => ({
      status: decision.status, decidedAt: decision.decidedAt, authorName: decision.author?.name, rationale: decision.rationale,
    })),
  }), [versions, packages, decisions]);

  return (
    <section aria-labelledby="artifact-lifecycle-title" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id="artifact-lifecycle-title" className="text-sm font-semibold text-gray-900 dark:text-white">{t('lifecycle.timelineTitle')}</h3>
        <ArtifactLifecycleBadge {...deriveArtifactLifecycle(artifact, packages)} />
      </div>
      {events.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('lifecycle.noEvents')}</p>
      ) : (
        <ol className="space-y-2 border-l border-gray-200 pl-4 dark:border-gray-700">
          {events.map((event, index) => (
            <li key={`${event.kind}-${event.at}-${index}`} className="text-sm">
              <time dateTime={event.at} className="block text-xs text-gray-500 dark:text-gray-400">{formatDateTime(event.at)}</time>
              <span className="text-gray-800 dark:text-gray-100">
                {event.kind === 'version' && t('lifecycle.event.version', { version: String(event.version) })}
                {event.kind === 'decision' && t('lifecycle.event.decision', {
                  stage: t(`lifecycle.decision.${event.status}`),
                  who: event.authorName ?? t('lifecycle.someone'),
                })}
                {event.kind === 'published' && t('lifecycle.event.published', { version: String(event.version), pkg: event.packageName })}
              </span>
              {event.kind === 'decision' && event.rationale && (
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{event.rationale}</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};

export default ArtifactLifecycleTimeline;
