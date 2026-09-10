/**
 * ContextGraphPanel — the "Contexto usado" diagnostic panel.
 *
 * Renders, for the active artifact, the slice of the Architecture Context
 * Graph that an AI generation would receive: main entities, relationships,
 * sources, conflicts, stale signals and the signals dropped by low relevance.
 * It also lets the architect copy a full plain-text context report.
 */

import React, { useMemo, useState } from 'react';
import { Badge, Alert, Button, EmptyState } from './ui';
import { useAppContext } from '../context/AppContext';
import { Artifact } from '../types';
import {
  buildArchitectureContextGraph,
  buildContextReportText,
  buildContextUsageReport,
  contextPackBuilder,
  type ContextEntityType,
} from '../services/contextGraph';

interface ContextGraphPanelProps {
  projectId: string;
  artifact: Artifact;
}

const ENTITY_TYPE_LABEL: Record<ContextEntityType, string> = {
  actor: 'Actor',
  'user-role': 'Rol',
  'business-capability': 'Capacidad',
  system: 'Sistema',
  application: 'Aplicación',
  'external-platform': 'Plataforma externa',
  integration: 'Integración',
  api: 'API',
  'data-entity': 'Entidad de datos',
  'data-store': 'Almacén de datos',
  process: 'Proceso',
  workflow: 'Flujo de trabajo',
  risk: 'Riesgo',
  decision: 'Decisión',
  constraint: 'Restricción',
  assumption: 'Supuesto',
  requirement: 'Requisito',
  'non-functional-requirement': 'NFR',
  technology: 'Tecnología',
  vendor: 'Proveedor',
  country: 'País',
  'compliance-regulation': 'Regulación',
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

export const ContextGraphPanel: React.FC<ContextGraphPanelProps> = ({ projectId, artifact }) => {
  const { getProject, settings } = useAppContext();
  const project = getProject(projectId);
  const [copied, setCopied] = useState(false);

  const model = useMemo(() => {
    if (!project) return null;
    const graph = buildArchitectureContextGraph(project, settings);
    const pack = contextPackBuilder.build(graph, {
      artifactType: artifact.type,
      intent: `${artifact.name}. ${artifact.objective}`,
      audience: artifact.audience,
      architecturalView: artifact.architecturalView,
      phase: artifact.phase,
      language: settings.language,
      detailLevel: 'standard',
      relatedArtifactIds: [artifact.id],
    });
    const usage = buildContextUsageReport(pack, artifact.id);
    const reportText = buildContextReportText(graph, pack);
    return { graph, pack, usage, reportText };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    projectId,
    project?.updatedAt,
    project?.artifacts.length,
    artifact.id,
    artifact.type,
    artifact.objective,
    settings.language,
  ]);

  if (!project || !model) {
    return <EmptyState title="Sin proyecto" description="No se encontró el proyecto asociado al artefacto." />;
  }

  const { graph, pack, usage, reportText } = model;

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(reportText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  if (graph.stats.entityCount === 0) {
    return (
      <EmptyState
        title="Contexto vacío"
        description="No se detectaron señales estructuradas en la descripción, el contexto del proyecto ni los artefactos."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary" size="sm">{graph.stats.entityCount} entidades</Badge>
        <Badge tone="gray" size="sm">{graph.stats.relationshipCount} relaciones</Badge>
        <Badge tone="gray" size="sm">{graph.stats.signalCount} señales</Badge>
        {graph.stats.conflictCount > 0 && (
          <Badge tone="danger" size="sm">{graph.stats.conflictCount} conflictos</Badge>
        )}
        {graph.stats.staleCount > 0 && (
          <Badge tone="warning" size="sm">{graph.stats.staleCount} obsoletas</Badge>
        )}
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Esta es la porción del grafo de contexto que recibiría una generación de este artefacto.
      </p>

      <Section title="Entidades principales" count={pack.entities.length}>
        <ul className="space-y-1">
          {pack.entities.slice(0, 14).map((entity) => (
            <li key={entity.id} className="flex items-start gap-2 text-sm">
              <Badge tone="gray" size="xs">{ENTITY_TYPE_LABEL[entity.type]}</Badge>
              <span className="flex-1 text-gray-800 dark:text-gray-100">
                <span className="text-2xs text-gray-400 mr-1">{entity.citation}</span>
                {entity.label}
                {entity.freshness.stale && <span className="ml-1 text-amber-500" title="Posible contexto obsoleto">⏳</span>}
              </span>
              <span className="text-2xs tabular-nums text-gray-400">{Math.round(entity.relevance * 100)}%</span>
            </li>
          ))}
        </ul>
      </Section>

      {pack.relationships.length > 0 && (
        <Section title="Relaciones principales" count={pack.relationships.length}>
          <ul className="space-y-0.5 text-xs text-gray-700 dark:text-gray-200">
            {usage.usedRelationships.slice(0, 10).map((rel) => (
              <li key={rel.id}>
                {rel.fromLabel} <span className="text-gray-400">— {rel.type} →</span> {rel.toLabel}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(pack.decisions.length > 0 || pack.risks.length > 0 || pack.constraints.length > 0) && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2">
            <p className="text-2xs uppercase tracking-wider text-gray-400">Decisiones</p>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">{pack.decisions.length}</p>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2">
            <p className="text-2xs uppercase tracking-wider text-gray-400">Riesgos</p>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">{pack.risks.length}</p>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2">
            <p className="text-2xs uppercase tracking-wider text-gray-400">Restricciones</p>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">{pack.constraints.length}</p>
          </div>
        </div>
      )}

      {pack.conflicts.length > 0 && (
        <Section title="Conflictos de contexto" count={pack.conflicts.length}>
          <div className="space-y-1.5">
            {pack.conflicts.map((conflict) => (
              <Alert key={conflict.id} tone="danger" variant="soft">
                <span className="text-xs">{conflict.description}</span>
              </Alert>
            ))}
          </div>
        </Section>
      )}

      {usage.staleSignals.length > 0 && (
        <Section title="Señales posiblemente obsoletas" count={usage.staleSignals.length}>
          <ul className="space-y-0.5 text-xs text-amber-700 dark:text-amber-400">
            {usage.staleSignals.map((signal) => (
              <li key={signal.id}>
                {signal.label}
                {typeof signal.ageDays === 'number' && <span className="text-gray-400"> · {signal.ageDays} días</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {pack.ignoredSignals.length > 0 && (
        <Section title="Señales ignoradas por baja relevancia" count={pack.ignoredSignals.length}>
          <ul className="space-y-0.5 text-xs text-gray-500 dark:text-gray-400">
            {pack.ignoredSignals.slice(0, 8).map((signal) => (
              <li key={signal.entityId}>
                {signal.label} <span className="text-gray-400">— {signal.reason}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Fuentes citadas" count={usage.sources.length}>
        <ul className="space-y-0.5 text-xs text-gray-500 dark:text-gray-400">
          {usage.sources.slice(0, 10).map((source) => (
            <li key={source.id}>
              <span className="text-gray-400">[{source.type}]</span> {source.label}
            </li>
          ))}
        </ul>
      </Section>

      <div className="pt-1">
        <Button size="xs" variant="secondary" onClick={handleCopy} className="w-full">
          {copied ? 'Reporte copiado ✓' : 'Copiar reporte de contexto'}
        </Button>
      </div>
    </div>
  );
};

export default ContextGraphPanel;
