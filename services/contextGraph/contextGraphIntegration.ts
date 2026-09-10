/**
 * contextGraphIntegration — the bridge between the Architecture Context Graph
 * and the rest of the app (AI generation, traceability, UI diagnostics).
 *
 * Responsibilities:
 *  - map a `Project` + `Settings` into a decoupled `ContextGraphInput`,
 *  - build a graph and a query-shaped `ContextPack`,
 *  - render a prompt-ready reinforcement block (used by `geminiService`),
 *  - produce a `ContextUsageReport` so every generation can explain the
 *    context it relied on,
 *  - render a copy-pasteable plain-text context report for the UI.
 *
 * Every entry point is defensive: a failure here must never break generation,
 * so the prompt-facing helper degrades to an empty string.
 */

import type { ArtifactRequestContext, Project, Settings } from '../../types';
import { getLatestArtifacts } from '../../utils';
import {
  type ArchitectureContextGraph,
  type ContextGraphInput,
  type ContextPack,
  type ContextPackQuery,
  type ContextSource,
  type ContextUsageReport,
} from './contextGraphTypes';
import { contextGraphBuilder } from './contextGraphBuilder';
import { contextPackBuilder } from './contextPackBuilder';

export interface ContextGraphBuildOptions {
  /** ISO override of "now". */
  now?: string;
  /** Days after which a signal is considered stale. */
  staleAfterDays?: number;
}

/** Map the mutable domain model into the decoupled builder input. */
export function buildGraphInputFromProject(
  project: Project,
  settings?: Settings,
  requestContext?: ArtifactRequestContext,
  options: ContextGraphBuildOptions = {},
): ContextGraphInput {
  return {
    projectId: project.id,
    projectName: project.name,
    projectDescription: project.description,
    projectContext: project.projectContext ?? [],
    agentMemory: project.agentMemory ?? [],
    initialCapture: project.initialCapture ?? [],
    globalContext: settings?.globalContext ?? [],
    artifacts: getLatestArtifacts(project.artifacts ?? []),
    requestContext,
    now: options.now,
    staleAfterDays: options.staleAfterDays,
  };
}

/** Build the Architecture Context Graph for a project. */
export function buildArchitectureContextGraph(
  project: Project,
  settings?: Settings,
  requestContext?: ArtifactRequestContext,
  options: ContextGraphBuildOptions = {},
): ArchitectureContextGraph {
  return contextGraphBuilder.build(
    buildGraphInputFromProject(project, settings, requestContext, options),
  );
}

/** Build a query-shaped context pack straight from a project. */
export function buildContextPackForProject(
  project: Project,
  settings: Settings | undefined,
  query: ContextPackQuery,
  requestContext?: ArtifactRequestContext,
  options: ContextGraphBuildOptions = {},
): ContextPack {
  const graph = buildArchitectureContextGraph(project, settings, requestContext, options);
  return contextPackBuilder.build(graph, query);
}

/**
 * Render a prompt-ready reinforcement block from a context pack. Returns an
 * empty string when there is nothing useful to inject.
 */
export function renderContextReinforcement(pack: ContextPack): string {
  if (pack.entities.length === 0) return '';
  const conflictWarning =
    pack.conflicts.length > 0
      ? '\nATENCIÓN: hay conflictos de contexto sin resolver. Señálalos en el artefacto en lugar de elegir en silencio.'
      : '';
  return `

*** ARCHITECTURE CONTEXT GRAPH (fuente estructurada del proyecto) ***
${pack.markdown}

INSTRUCCIONES DE TRAZABILIDAD:
- Usa exclusivamente las entidades, relaciones, decisiones, riesgos y restricciones listadas arriba.
- Cita el tag [ctx:*] que respalda cada sección relevante del artefacto.
- Cierra el artefacto con una nota corta "Contexto utilizado" enumerando los tags citados.${conflictWarning}
`;
}

/**
 * Convenience used by the generation pipeline: build graph → pack → prompt
 * block in one call. Never throws — degrades to an empty string.
 */
export function renderContextGraphReinforcement(
  project: Project,
  settings: Settings | undefined,
  query: ContextPackQuery,
  requestContext?: ArtifactRequestContext,
): string {
  try {
    const pack = buildContextPackForProject(project, settings, query, requestContext);
    return renderContextReinforcement(pack);
  } catch (_error) {
    return '';
  }
}

const uniqueSources = (sources: ContextSource[]): ContextSource[] => {
  const seen = new Set<string>();
  const out: ContextSource[] = [];
  for (const source of sources) {
    if (seen.has(source.id)) continue;
    seen.add(source.id);
    out.push(source);
  }
  return out;
};

/**
 * Build a traceability report explaining which context an artifact generation
 * used. Lets every generated artifact answer "what did you rely on?".
 */
export function buildContextUsageReport(pack: ContextPack, artifactId?: string): ContextUsageReport {
  const labelById = new Map(pack.entities.map((e) => [e.id, e.label]));

  return {
    packId: pack.id,
    projectId: pack.projectId,
    artifactId,
    generatedAt: new Date().toISOString(),
    usedEntities: pack.entities.map((e) => ({
      id: e.id,
      label: e.label,
      type: e.type,
      citation: e.citation,
      relevance: e.relevance,
    })),
    usedRelationships: pack.relationships.map((r) => ({
      id: r.id,
      type: r.type,
      fromLabel: labelById.get(r.fromId) ?? r.fromId,
      toLabel: labelById.get(r.toId) ?? r.toId,
    })),
    usedDecisions: pack.decisions.map((d) => ({ id: d.id, label: d.label })),
    consideredRisks: pack.risks.map((r) => ({ id: r.id, label: r.label })),
    appliedConstraints: pack.constraints.map((c) => ({ id: c.id, label: c.label })),
    usedDataEntities: pack.dataEntities.map((d) => ({ id: d.id, label: d.label })),
    usedIntegrations: pack.integrations.map((i) => ({ id: i.id, label: i.label })),
    ignoredSignals: pack.ignoredSignals,
    conflicts: pack.conflicts,
    staleSignals: pack.entities
      .filter((e) => e.freshness.stale)
      .map((e) => ({ id: e.id, label: e.label, ageDays: e.freshness.ageDays })),
    sources: uniqueSources(pack.entities.flatMap((e) => e.sources)),
  };
}

/** Render a human-readable, copy-pasteable context report for the UI. */
export function buildContextReportText(
  graph: ArchitectureContextGraph,
  pack?: ContextPack,
): string {
  const lines: string[] = [];
  lines.push(`# Reporte de contexto — ${graph.projectName ?? graph.projectId}`);
  lines.push(`Generado: ${graph.generatedAt}`);
  lines.push(
    `Entidades: ${graph.stats.entityCount} · Relaciones: ${graph.stats.relationshipCount} · ` +
      `Señales: ${graph.stats.signalCount} · Conflictos: ${graph.stats.conflictCount} · ` +
      `Obsoletas: ${graph.stats.staleCount}`,
  );

  lines.push('', '## Entidades principales');
  const topEntities = (pack?.entities ?? graph.entities).slice(0, 25);
  for (const entity of topEntities) {
    const cite = 'citation' in entity ? `${(entity as { citation: string }).citation} ` : '';
    const stale = entity.freshness.stale ? ' [obsoleto]' : '';
    lines.push(`- ${cite}(${entity.type}) ${entity.label}${stale}`);
  }

  const relationships = pack?.relationships ?? graph.relationships;
  if (relationships.length > 0) {
    lines.push('', '## Relaciones principales');
    const entityLabel = new Map(graph.entities.map((e) => [e.id, e.label]));
    for (const rel of relationships.slice(0, 25)) {
      lines.push(
        `- ${entityLabel.get(rel.fromId) ?? rel.fromId} --${rel.type}--> ` +
          `${entityLabel.get(rel.toId) ?? rel.toId}`,
      );
    }
  }

  lines.push('', '## Fuentes');
  for (const source of graph.sources.slice(0, 30)) {
    lines.push(`- [${source.type}] ${source.label}`);
  }

  if (graph.conflicts.length > 0) {
    lines.push('', '## Conflictos de contexto');
    for (const conflict of graph.conflicts) {
      lines.push(`- (${conflict.severity}) ${conflict.description}`);
    }
  }

  const stale = graph.entities.filter((e) => e.freshness.stale);
  if (stale.length > 0) {
    lines.push('', '## Señales posiblemente obsoletas');
    for (const entity of stale) {
      lines.push(`- ${entity.label} (${entity.freshness.ageDays ?? '?'} días)`);
    }
  }

  return lines.join('\n');
}
