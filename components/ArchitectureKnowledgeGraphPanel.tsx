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
import { Artifact } from '../types';
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
  const evidence = entity.sourceRefs.length;
  return (
    <li className="flex items-start gap-2 text-sm">
      <Badge tone="gray" size="xs">{entity.type}</Badge>
      <span className="flex-1 text-gray-800 dark:text-gray-100">
        {entity.name}
        {entity.status === 'candidate-duplicate' && (
          <span className="ml-1 text-amber-500" title="Posible duplicado">⚑</span>
        )}
        {entity.status === 'unverified' && (
          <span className="ml-1 text-gray-400" title="Baja evidencia">?</span>
        )}
        <span className="ml-1 text-2xs text-gray-400" title="Fuentes de evidencia">
          · {evidence} fuente{evidence === 1 ? '' : 's'}
        </span>
      </span>
      <span className="text-2xs tabular-nums text-gray-400" title="Confianza">
        {Math.round(entity.confidence * 100)}%
      </span>
    </li>
  );
};

export const ArchitectureKnowledgeGraphPanel: React.FC<ArchitectureKnowledgeGraphPanelProps> = ({
  projectId,
  artifact,
}) => {
  const { getProject, settings, rebuildArchitectureGraph } = useAppContext();
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
    return <EmptyState title="Sin proyecto" description="No se encontró el proyecto asociado." />;
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
        ? `Grafo recalculado y persistido: ${result.statistics.entityCount} entidades.`
        : 'No se pudo recalcular el grafo.',
    );
    window.setTimeout(() => setPersistNote(null), 3500);
  };

  if (graph.statistics.entityCount === 0) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="gray" size="xs">Grafo vacío</Badge>
          <Badge tone={freshnessInfo.tone} size="xs" dot>{freshnessInfo.label}</Badge>
        </div>
        <EmptyState
          title="Grafo vacío"
          description="Aún no se detectó conocimiento arquitectónico. Genera artefactos o enriquece el contexto del proyecto."
        />
        <Button size="xs" variant="secondary" onClick={handleRebuild} className="w-full">
          Recalcular y persistir
        </Button>
        {persistNote && <Alert tone="info" variant="soft"><span className="text-xs">{persistNote}</span></Alert>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary" size="sm">{graph.statistics.entityCount} entidades</Badge>
        <Badge tone="gray" size="sm">{graph.statistics.relationCount} relaciones</Badge>
        <Badge tone={graph.quality.score >= 70 ? 'success' : graph.quality.score >= 45 ? 'warning' : 'danger'} size="sm">
          Salud {graph.quality.score}/100
        </Badge>
        <Badge tone={freshnessInfo.tone} size="xs" dot>{freshnessInfo.label}</Badge>
      </div>

      {freshness === 'stale' && (
        <Alert tone="warning" variant="soft">
          <span className="text-xs">
            {freshnessInfo.description} El grafo mostrado se recalculó en memoria; usa
            «Recalcular y persistir» para guardarlo.
          </span>
        </Alert>
      )}
      {freshness === 'missing' && (
        <Alert tone="info" variant="soft">
          <span className="text-xs">
            Este grafo aún no está persistido en el proyecto. Púlsalo con «Recalcular y
            persistir» para fijarlo como fuente canónica.
          </span>
        </Alert>
      )}

      <Tabs value={tab} onChange={(v) => setTab(v as GraphTab)} variant="underline">
        <TabList aria-label="Vistas del grafo de conocimiento">
          <Tab value="resumen">Resumen</Tab>
          <Tab
            value="consistencia"
            badge={consistency.issues.length > 0 ? <Badge tone="warning" size="xs">{consistency.issues.length}</Badge> : undefined}
          >
            Consistencia
          </Tab>
          <Tab
            value="trazabilidad"
            badge={traceability.gaps.length > 0 ? <Badge tone="warning" size="xs">{traceability.gaps.length}</Badge> : undefined}
          >
            Trazabilidad
          </Tab>
          <Tab value="impacto">Impacto</Tab>
        </TabList>

        <div className="pt-3">
          <TabPanel value="resumen">
            <div className="space-y-4">
              <p className="text-xs text-gray-500 dark:text-gray-400">{graph.quality.summary}</p>
              <Section title="Entidades principales" count={graph.entities.length}>
                <ul className="space-y-1">
                  {graph.entities.slice(0, 16).map((entity) => (
                    <EntityRow key={entity.id} entity={entity} />
                  ))}
                </ul>
              </Section>
              {graph.relations.length > 0 && (
                <Section title="Relaciones detectadas" count={graph.relations.length}>
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
              <Alert tone="success" variant="soft">Sin inconsistencias detectadas entre artefactos.</Alert>
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
                  <p className="text-2xs uppercase tracking-wider text-gray-400">Requisitos</p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">
                    {Math.round(traceability.requirementCoverage * 100)}%
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2">
                  <p className="text-2xs uppercase tracking-wider text-gray-400">Riesgos</p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">
                    {Math.round(traceability.riskCoverage * 100)}%
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2">
                  <p className="text-2xs uppercase tracking-wider text-gray-400">Enlaces</p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{traceability.linkCount}</p>
                </div>
              </div>
              {traceability.gaps.length === 0 ? (
                <Alert tone="success" variant="soft">Sin vacíos de trazabilidad pendientes.</Alert>
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
              <EmptyState title="Sin artefacto" description="Abre un artefacto para analizar su impacto en el grafo." />
            ) : !impact.resolved ? (
              <Alert tone="info" variant="soft">
                <span className="text-xs">Este artefacto aún no aporta entidades al grafo.</span>
              </Alert>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge tone={SEVERITY_TONE[impact.severity]} size="sm">Impacto {impact.severity}</Badge>
                  {impact.requiresArtifactRegeneration && (
                    <Badge tone="warning" size="xs">Regeneración sugerida</Badge>
                  )}
                  {impact.requiresHumanReview && <Badge tone="danger" size="xs">Revisión humana</Badge>}
                </div>
                <Section title="Artefactos impactados" count={impact.impactedArtifacts.length}>
                  {impact.impactedArtifacts.length === 0 ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400">El cambio parece aislado.</p>
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
                <Section title="Recomendaciones">
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
          Recalcular y persistir
        </Button>
        <Button size="xs" variant="ghost" onClick={handleCopy} className="flex-1">
          {copied ? 'Reporte copiado ✓' : 'Copiar reporte'}
        </Button>
      </div>
    </div>
  );
};

export default ArchitectureKnowledgeGraphPanel;
