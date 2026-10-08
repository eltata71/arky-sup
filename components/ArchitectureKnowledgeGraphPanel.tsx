/**
 * ArchitectureKnowledgeGraphPanel — the architect-facing window into the
 * Architecture Knowledge Graph.
 *
 * It surfaces, for the active project (and optionally the active artifact):
 *  - detected entities with their type, confidence and evidence;
 *  - detected relations;
 *  - cross-artifact consistency issues;
 *  - traceability coverage and gaps;
 *  - impact analysis for the current artifact;
 *  - actions to recalculate/persist the graph and copy a full report.
 *
 * The graph is rebuilt deterministically in-memory on every render (the build
 * never throws); "Recalcular y persistir" stores it on the project. Designed
 * for dark mode and keyboard/AT accessibility.
 */

import React, { useMemo, useState } from 'react';
import { Badge, Alert, Button, EmptyState, Tabs, TabList, Tab, TabPanel } from './ui';
import { useAppContext } from '../context/AppContext';
import type { Artifact } from '../lib/artifacts';
import {
  analyzeArchitectureConsistency,
  analyzeArchitectureImpact,
  analyzeArchitectureTraceability,
  buildArchitectureGraphReportText,
  buildArchitectureKnowledgeGraphForProject,
  buildArtifactGraphInsight,
  describeArchitectureGraphFreshness,
  resolveProjectArchitectureGraphFreshness,
  type ArchitectureEntity,
  type ArchitectureGraphFreshness,
  type ArchitectureIssueSeverity,
} from '../services/architectureKnowledgeGraph';

interface ArchitectureKnowledgeGraphPanelProps {
  projectId: string;
  /** When provided, the panel also shows artifact-scoped insight + impact. */
  artifact?: Artifact;
}

type GraphTab = 'resumen' | 'consistencia' | 'trazabilidad' | 'impacto';

const SEVERITY_TONE: Record<ArchitectureIssueSeverity, 'danger' | 'warning' | 'gray'> = {
  critical: 'danger',
  high: 'danger',
  medium: 'warning',
  low: 'gray',
  info: 'gray',
};

const Section: React.FC<{ title: string; count?: number; children: React.ReactNode }> = ({
  title,
  count,
  children,
}) => (
  <div>
    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
      {title}
      {typeof count === 'number' && <span className="ml-1 text-gray-400">({count})</span>}
    </p>
    {children}
  </div>
);

const EntityRow: React.FC<{ entity: ArchitectureEntity }> = ({ entity }) => {
  const { t } = useAppContext();
  const evidence = entity.sourceRefs.length;
  return (
    <li className="flex items-start gap-2 text-sm">
      <Badge tone="gray" size="xs">{entity.type}</Badge>
      <span className="flex-1 text-gray-800 dark:text-gray-100">
        {entity.name}
        {entity.status === 'candidate-duplicate' && (
          <span className="ml-1 text-amber-500" title={t('kg.possibleDuplicate')}>⚑</span>
        )}
        {entity.status === 'unverified' && (
          <span className="ml-1 text-gray-400" title={t('kg.lowEvidence')}>?</span>
        )}
        <span className="ml-1 text-2xs text-gray-400" title={t('kg.evidenceSources')}>
          · {t(evidence === 1 ? 'kg.sourceOne' : 'kg.sourceMany', { count: String(evidence) })}
        </span>
      </span>
      <span className="text-2xs tabular-nums text-gray-400" title={t('kg.confidence')}>
        {Math.round(entity.confidence * 100)}%
      </span>
    </li>
  );
};

export const ArchitectureKnowledgeGraphPanel: React.FC<ArchitectureKnowledgeGraphPanelProps> = ({
  projectId,
  artifact,
}) => {
  const { getProject, settings, rebuildArchitectureGraph, t } = useAppContext();
  const project = getProject(projectId);
  const [tab, setTab] = useState<GraphTab>('resumen');
  const [copied, setCopied] = useState(false);
  const [persistNote, setPersistNote] = useState<string | null>(null);

  const model = useMemo(() => {
    if (!project) return null;
    const graph = buildArchitectureKnowledgeGraphForProject(project, {
      globalContext: settings.globalContext,
      previousGraph: project.architectureKnowledgeGraph,
    });
    const consistency = analyzeArchitectureConsistency(
      graph,
      project.artifacts.map((a) => ({ id: a.id, name: a.name, type: a.type })),
    );
    const traceability = analyzeArchitectureTraceability(graph);
    const reportText = buildArchitectureGraphReportText(graph, consistency, traceability);
    const insight = artifact ? buildArtifactGraphInsight(graph, artifact.id) : null;
    const impact = artifact
      ? analyzeArchitectureImpact(graph, { kind: 'artifact', targetId: artifact.id })
      : null;
    const freshness: ArchitectureGraphFreshness = resolveProjectArchitectureGraphFreshness(project, {
      globalContext: settings.globalContext,
    });
    return { graph, consistency, traceability, reportText, insight, impact, freshness };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    projectId,
    project?.updatedAt,
    project?.artifacts.length,
    artifact?.id,
    settings.globalContext,
  ]);

  if (!project || !model) {
    return <EmptyState title={t('kg.noProject')} description={t('kg.noProjectDesc')} />;
  }

  const { graph, consistency, traceability, reportText, insight, impact, freshness } = model;
  const freshnessInfo = describeArchitectureGraphFreshness(freshness);

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(reportText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleRebuild = (): void => {
    const result = rebuildArchitectureGraph(projectId);
    setPersistNote(
      result
        ? t('kg.rebuilt', { count: String(result.statistics.entityCount) })
        : t('kg.rebuildFailed'),
    );
    window.setTimeout(() => setPersistNote(null), 3500);
  };

  if (graph.statistics.entityCount === 0) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="gray" size="xs">{t('kg.empty')}</Badge>
          <Badge tone={freshnessInfo.tone} size="xs" dot>{freshnessInfo.label}</Badge>
        </div>
        <EmptyState
          title={t('kg.empty')}
          description={t('kg.emptyDesc')}
        />
        <Button size="xs" variant="secondary" onClick={handleRebuild} className="w-full">
          {t('kg.rebuild')}
        </Button>
        {persistNote && <Alert tone="info" variant="soft"><span className="text-xs">{persistNote}</span></Alert>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary" size="sm">{t('kg.entities', { count: String(graph.statistics.entityCount) })}</Badge>
        <Badge tone="gray" size="sm">{t('kg.relations', { count: String(graph.statistics.relationCount) })}</Badge>
        <Badge tone={graph.quality.score >= 70 ? 'success' : graph.quality.score >= 45 ? 'warning' : 'danger'} size="sm">
          {t('kg.health', { score: String(graph.quality.score) })}
        </Badge>
        <Badge tone={freshnessInfo.tone} size="xs" dot>{freshnessInfo.label}</Badge>
      </div>

      {freshness === 'stale' && (
        <Alert tone="warning" variant="soft">
          <span className="text-xs">
            {freshnessInfo.description} {t('kg.staleNote')}
          </span>
        </Alert>
      )}
      {freshness === 'missing' && (
        <Alert tone="info" variant="soft">
          <span className="text-xs">
            {t('kg.missingNote')}
          </span>
        </Alert>
      )}

      <Tabs value={tab} onChange={(v) => setTab(v as GraphTab)} variant="underline">
        <TabList aria-label={t('kg.views')}>
          <Tab value="resumen">{t('kg.tabSummary')}</Tab>
          <Tab
            value="consistencia"
            badge={consistency.issues.length > 0 ? <Badge tone="warning" size="xs">{consistency.issues.length}</Badge> : undefined}
          >
            {t('kg.tabConsistency')}
          </Tab>
          <Tab
            value="trazabilidad"
            badge={traceability.gaps.length > 0 ? <Badge tone="warning" size="xs">{traceability.gaps.length}</Badge> : undefined}
          >
            {t('kg.tabTraceability')}
          </Tab>
          <Tab value="impacto">{t('kg.tabImpact')}</Tab>
        </TabList>

        <div className="pt-3">
          <TabPanel value="resumen">
            <div className="space-y-4">
              <p className="text-xs text-gray-500 dark:text-gray-400">{graph.quality.summary}</p>
              <Section title={t('kg.mainEntities')} count={graph.entities.length}>
                <ul className="space-y-1">
                  {graph.entities.slice(0, 16).map((entity) => (
                    <EntityRow key={entity.id} entity={entity} />
                  ))}
                </ul>
              </Section>
              {graph.relations.length > 0 && (
                <Section title={t('kg.detectedRelations')} count={graph.relations.length}>
                  <ul className="space-y-0.5 text-xs text-gray-700 dark:text-gray-200">
                    {graph.relations.slice(0, 12).map((relation) => {
                      const from = graph.entities.find((e) => e.id === relation.sourceEntityId);
                      const to = graph.entities.find((e) => e.id === relation.targetEntityId);
                      return (
                        <li key={relation.id}>
                          {from?.name ?? '—'} <span className="text-gray-400">— {relation.type} →</span>{' '}
                          {to?.name ?? '—'}
                          {relation.protocol && <span className="text-gray-400"> [{relation.protocol}]</span>}
                        </li>
                      );
                    })}
                  </ul>
                </Section>
              )}
              {insight && (
                <Alert tone={insight.shouldBlock ? 'danger' : insight.shouldWarn ? 'warning' : 'success'} variant="soft">
                  <span className="text-xs">{insight.recommendation}</span>
                </Alert>
              )}
            </div>
          </TabPanel>

          <TabPanel value="consistencia">
            {consistency.issues.length === 0 ? (
              <Alert tone="success" variant="soft">{t('kg.noInconsistencies')}</Alert>
            ) : (
              <ul className="space-y-2">
                {consistency.issues.map((issue) => (
                  <li key={issue.id} className="rounded-md border border-gray-200 dark:border-gray-800 p-2.5">
                    <div className="flex items-center gap-2">
                      <Badge tone={SEVERITY_TONE[issue.severity]} size="xs">{issue.severity}</Badge>
                      <span className="text-sm text-gray-800 dark:text-gray-100">{issue.message}</span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{issue.recommendation}</p>
                  </li>
                ))}
              </ul>
            )}
          </TabPanel>

          <TabPanel value="trazabilidad">
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2">
                  <p className="text-2xs uppercase tracking-wider text-gray-400">{t('kg.requirements')}</p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">
                    {Math.round(traceability.requirementCoverage * 100)}%
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2">
                  <p className="text-2xs uppercase tracking-wider text-gray-400">{t('kg.risks')}</p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">
                    {Math.round(traceability.riskCoverage * 100)}%
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2">
                  <p className="text-2xs uppercase tracking-wider text-gray-400">{t('kg.links')}</p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{traceability.linkCount}</p>
                </div>
              </div>
              {traceability.gaps.length === 0 ? (
                <Alert tone="success" variant="soft">{t('kg.noGaps')}</Alert>
              ) : (
                <ul className="space-y-1.5">
                  {traceability.gaps.map((gap) => (
                    <li key={gap.id} className="rounded-md border border-gray-200 dark:border-gray-800 p-2">
                      <div className="flex items-center gap-2">
                        <Badge tone={SEVERITY_TONE[gap.severity]} size="xs">{gap.severity}</Badge>
                        <span className="text-xs text-gray-800 dark:text-gray-100">{gap.message}</span>
                      </div>
                      <p className="mt-0.5 text-2xs text-gray-500 dark:text-gray-400">{gap.recommendation}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </TabPanel>

          <TabPanel value="impacto">
            {!impact ? (
              <EmptyState title={t('kg.noArtifact')} description={t('kg.noArtifactDesc')} />
            ) : !impact.resolved ? (
              <Alert tone="info" variant="soft">
                <span className="text-xs">{t('kg.noEntities')}</span>
              </Alert>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge tone={SEVERITY_TONE[impact.severity]} size="sm">{t('kg.impact', { severity: impact.severity })}</Badge>
                  {impact.requiresArtifactRegeneration && (
                    <Badge tone="warning" size="xs">{t('kg.regenSuggested')}</Badge>
                  )}
                  {impact.requiresHumanReview && <Badge tone="danger" size="xs">{t('kg.humanReview')}</Badge>}
                </div>
                <Section title={t('kg.impactedArtifacts')} count={impact.impactedArtifacts.length}>
                  {impact.impactedArtifacts.length === 0 ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400">{t('kg.isolated')}</p>
                  ) : (
                    <ul className="space-y-1 text-xs text-gray-700 dark:text-gray-200">
                      {impact.impactedArtifacts.map((item) => (
                        <li key={item.artifactId}>
                          <Badge tone={SEVERITY_TONE[item.severity]} size="xs">{item.severity}</Badge>{' '}
                          {item.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
                <Section title={t('kg.recommendations')}>
                  <ul className="list-disc pl-4 space-y-0.5 text-xs text-gray-600 dark:text-gray-300">
                    {impact.recommendations.map((rec, i) => <li key={i}>{rec}</li>)}
                  </ul>
                </Section>
              </div>
            )}
          </TabPanel>
        </div>
      </Tabs>

      {persistNote && (
        <Alert tone="info" variant="soft"><span className="text-xs">{persistNote}</span></Alert>
      )}

      <div className="flex gap-2 pt-1">
        <Button size="xs" variant="secondary" onClick={handleRebuild} className="flex-1">
          {t('kg.rebuild')}
        </Button>
        <Button size="xs" variant="ghost" onClick={handleCopy} className="flex-1">
          {copied ? t('kg.copied') : t('kg.copy')}
        </Button>
      </div>
    </div>
  );
};

export default ArchitectureKnowledgeGraphPanel;
