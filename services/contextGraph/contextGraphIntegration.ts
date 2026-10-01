/**
 * contextGraphIntegration — the bridge between the Architecture Context Graph
 * and the rest of the app (AI generation, traceability, UI diagnostics).
 *
 * Responsibilities:
 *  - map a `Project` + `Settings` into a decoupled `ContextGraphInput`,
 *  - build a graph and a query-shaped `ContextPack`,
 *  - render a prompt-ready reinforcement block (used by `geminiService`),
 *  - hand the rendered pack to `onContextCaptured`, so the generation records
 *    the context it relied on (plan artefactos 7.5a) instead of the UI
 *    rebuilding it later from a project that has since changed.
 *
 * Every entry point is defensive: a failure here must never break generation,
 * so the prompt-facing helper degrades to an empty string.
 */

import type { ArtifactRequestContext, Settings } from '../../types';
import type { ArtifactContextPorts } from '../../lib/artifacts';
import type { Project } from '../architectureProjects';
import { getLatestArtifacts } from '../../utils';
import {
  type ArchitectureContextGraph,
  type ContextGraphInput,
  type ContextPack,
  type ContextPackQuery,
  type ContextSource,
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
  onContextCaptured?: ArtifactContextPorts['onContextCaptured'],
): string {
  try {
    const pack = buildContextPackForProject(project, settings, query, requestContext);
    const block = renderContextReinforcement(pack);
    if (block) onContextCaptured?.({
      label: 'Grafo de contexto',
      sources: [
        { id: project.id, label: project.name, revision: project.revision },
        ...uniqueSources(pack.entities.flatMap((entity) => entity.sources)).map(({ id, label }) => ({ id, label })),
      ],
      sections: [{ scope: 'Entidades, relaciones y citas', items: [{ text: pack.markdown }] }],
      omitted: pack.ignoredSignals.map((signal) => ({ scope: signal.label, count: 1, reason: signal.reason })),
      citations: pack.entities.map((entity) => ({
        tag: entity.citation,
        label: entity.label,
        entityType: entity.type,
        sources: uniqueSources(entity.sources).map((source) => source.label),
      })),
    });
    return block;
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
