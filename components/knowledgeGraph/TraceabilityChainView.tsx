import React, { useMemo, useState } from 'react';
import { Alert, Badge, Button } from '../ui';
import { useAppContext } from '../../context/AppContext';
import {
  analyzeTraceabilityChains,
  explainEntity,
  type ArchitectureGraph,
  type ArchitectureIssueSeverity,
} from '../../services/architectureKnowledgeGraph';

interface TraceabilityChainViewProps {
  graph: ArchitectureGraph;
  artifacts: ReadonlyArray<{ id: string; name: string }>;
}

const TONE: Record<ArchitectureIssueSeverity, 'danger' | 'warning' | 'gray'> = {
  critical: 'danger',
  high: 'danger',
  medium: 'warning',
  low: 'gray',
  info: 'gray',
};

const TraceabilityChainView: React.FC<TraceabilityChainViewProps> = ({ graph, artifacts }) => {
  const { t } = useAppContext();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const report = useMemo(
    () => analyzeTraceabilityChains(graph, { knownArtifactIds: artifacts.map((a) => a.id) }),
    [graph, artifacts],
  );
  const explanation = useMemo(
    () => (selectedId ? explainEntity(graph, selectedId) : null),
    [graph, selectedId],
  );
  const artifactName = (id: string): string => artifacts.find((a) => a.id === id)?.name ?? id;

  return (
    <div className="space-y-3">
      {report.findings.length === 0 ? (
        <Alert tone="success" variant="soft">{t('kg.chainNoFindings')}</Alert>
      ) : (
        <ul className="space-y-1.5" aria-label={t('kg.chainFindings')}>
          {report.findings.map((finding) => (
            <li key={finding.id} className="rounded-md border border-gray-200 dark:border-gray-800 p-2">
              <div className="flex items-center gap-2">
                <Badge tone={TONE[finding.severity]} size="xs">{t(`kg.chain.${finding.type}`)}</Badge>
                <span className="text-xs text-gray-800 dark:text-gray-100">{finding.message}</span>
              </div>
              <p className="mt-0.5 text-2xs text-gray-500 dark:text-gray-400">{finding.recommendation}</p>
              {finding.entityId && (
                <Button size="xs" variant="ghost" onClick={() => setSelectedId(finding.entityId)}>
                  {t('kg.chainExplain')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ul className="space-y-1">
        {report.chains.map(({ requirement, decisions, artifactIds }) => (
          <li key={requirement.id} className="rounded-md border border-gray-200 dark:border-gray-800 p-2 text-xs">
            <button type="button" className="font-medium text-left underline-offset-2 hover:underline" onClick={() => setSelectedId(requirement.id)}>
              {requirement.name}
            </button>
            <p className="text-gray-500 dark:text-gray-400">
              {decisions.length === 0
                ? t('kg.chainNoDecision')
                : decisions.map((d) => d.name).join(' · ')}
              {artifactIds.length > 0 && ` → ${artifactIds.map(artifactName).join(', ')}`}
            </p>
          </li>
        ))}
      </ul>

      {explanation && (
        <div className="rounded-lg border border-primary-200 dark:border-primary-800 p-3 space-y-2 text-xs" role="region" aria-label={t('kg.chainExplain')}>
          {!explanation.resolved || !explanation.entity ? (
            <Alert tone="warning" variant="soft">{t('kg.chainUnresolved')}</Alert>
          ) : (
            <>
              <p className="font-semibold text-gray-900 dark:text-white">{explanation.entity.name}</p>
              <p><strong>{t('kg.chainWhy')}</strong>{' '}
                {explanation.drivers.length === 0 && explanation.originArtifactIds.length === 0
                  ? t('kg.chainNoReason')
                  : [...explanation.drivers.map((d) => d.name), ...explanation.originArtifactIds.map(artifactName)].join(', ')}
              </p>
              <p><strong>{t('kg.chainBreaks')}</strong>{' '}
                {explanation.impact && explanation.impact.impactedArtifacts.length > 0
                  ? explanation.impact.impactedArtifacts.map((i) => artifactName(i.artifactId)).join(', ')
                  : t('kg.isolated')}
                {explanation.impact?.requiresHumanReview && ` · ${t('kg.humanReview')}`}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default TraceabilityChainView;
