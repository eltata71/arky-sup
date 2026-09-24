/**
 * Keeps a project's Architecture Knowledge Graph in step with its artifacts.
 *
 * Two paths, and the second is the one worth reading. "Recalcular y persistir"
 * is the manual one. The effect below is the automatic one: any artifact
 * change shifts the project's content signature, and a project that *already*
 * has a graph gets it rebuilt after a quiet period. Projects without one are
 * left alone — opting a legacy project into a graph is a decision, not a side
 * effect of opening it.
 *
 * The debounce is what makes that affordable: a rebuild per keystroke would be
 * both wasteful and a write storm. The re-check inside the timer is what makes
 * it correct — by the time it fires the project may have been deleted, changed
 * again, or already recalculated by hand.
 *
 * `savePublicationPackages` rides along because it is the same shape: a field
 * on the project, written through the standard update path so rollback and
 * concurrency control are unchanged.
 *
 * **Since F5-05 the automatic path is durable.** The timer used to *be* the
 * rebuild: close the tab inside the quiet period and the work was lost, with
 * nothing recording that it was due (H11). Now the database records it — every
 * artifact write enqueues the rebuild in `api.projection_outbox`, in the same
 * transaction — and this hook only decides *when* to process what is pending:
 * once at start-up, to recover anything a closed tab left behind, and after the
 * quiet period for the immediate case. Both go through
 * `recoverGraphProjections`, which rebuilds from a fresh read and saves and
 * marks the generation in one transaction. A database without the outbox yet
 * (migration not applied) falls back to the old in-tab rebuild.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import type { Project } from '../../services/architectureProjects';
// Diferida y por su propia puerta: este hook está en el arranque y la
// recuperación sólo corre cuando ya hay proyectos (ver `graphProjection.ts`).
import type { GraphProjectionReport } from '../../services/architectureProjects/graphProjection';
import { observabilityService } from '../../services/observability';
import type { PublicationPackage } from '../../services/publicationPipeline';
import {
  buildArchitectureKnowledgeGraphForProject,
  resolveProjectArchitectureGraphFreshness,
  type ArchitectureGraph,
  type ArchitectureGraphFreshness,
} from '../../services/architectureKnowledgeGraph';

/**
 * Quiet period before a stale Architecture Knowledge Graph is rebuilt
 * automatically. Debouncing collapses a burst of artifact edits into a single
 * deterministic, non-blocking rebuild.
 */
const ARCHITECTURE_GRAPH_REBUILD_DEBOUNCE_MS = 2500;

interface ArchitectureGraphSyncPorts {
  readonly projects: Project[];
  readonly projectsRef: React.MutableRefObject<Project[]>;
  readonly globalContext: string[];
  readonly globalContextRef: React.MutableRefObject<string[]>;
  readonly updateProject: (id: string, updates: Partial<Omit<Project, 'id' | 'artifacts'>>) => void;
  /** Applies a recovered graph to state without another write: it is already saved. */
  readonly setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
}

export const useArchitectureGraphSync = ({
  projects,
  projectsRef,
  globalContext,
  globalContextRef,
  updateProject,
  setProjects,
}: ArchitectureGraphSyncPorts) => {
  const rebuildArchitectureGraph = useCallback((projectId: string): ArchitectureGraph | null => {
      // Refs keep this callback stable so the debounced auto-refresh can call
      // it without re-subscribing on every project change.
      const project = projectsRef.current.find(p => p.id === projectId);
      if (!project) return null;
      // The build is deterministic and total — it never throws. The resulting
      // graph carries a `sourceSignature`, so freshness can be derived later.
      const graph = {
          ...buildArchitectureKnowledgeGraphForProject(project, {
              globalContext: globalContextRef.current,
              previousGraph: project.architectureKnowledgeGraph,
          }),
          // The revision travels with the graph (F5-05): the save compares it.
          revision: project.architectureKnowledgeGraph?.revision,
      };
      // Persisted through the standard project-update path, so optimistic
      // rollback and concurrency control are unchanged.
      updateProject(projectId, { architectureKnowledgeGraph: graph });
      return graph;
  }, [updateProject, projectsRef, globalContextRef]);

  const getArchitectureGraphFreshness = useCallback((projectId: string): ArchitectureGraphFreshness => {
      const project = projectsRef.current.find(p => p.id === projectId);
      if (!project) return 'missing';
      return resolveProjectArchitectureGraphFreshness(project, { globalContext: globalContextRef.current });
  }, [projectsRef, globalContextRef]);

  /**
   * Processes what the outbox holds — all of it, or only `projectIds` — and
   * puts each saved graph into state. Resolves with the report so a caller can
   * tell "nothing pending" from "no outbox in this database".
   */
  const processGraphProjections = useCallback(async (projectIds?: readonly string[]): Promise<GraphProjectionReport | null> => {
    try {
      const { recoverGraphProjections, createGraphProjectionPorts } =
        await import('../../services/architectureProjects/graphProjection');
      const report = await recoverGraphProjections(
        createGraphProjectionPorts(globalContextRef.current),
        { projectIds },
      );
      if (report.recovered.length > 0) {
        const byId = new Map(report.recovered.map((entry) => [entry.projectId, entry.graph]));
        setProjects((prev) => prev.map((project) => {
          const graph = byId.get(project.id);
          return graph ? { ...project, architectureKnowledgeGraph: graph } : project;
        }));
      }
      for (const failure of report.failed) {
        observabilityService.recordWarning({
          source: 'operation',
          title: 'Reconstrucción del grafo pendiente',
          message: `El grafo del proyecto ${failure.projectId} no se pudo reconstruir; queda pendiente y se reintentará: ${failure.message}`,
          operationName: 'recoverGraphProjections',
          metadata: { projectId: failure.projectId },
          recoverable: true,
        });
      }
      return report;
    } catch {
      // Sin sesión, sin red: el pendiente sigue en la base y el próximo intento
      // lo encuentra. No hay nada que perder aquí, que es el punto de F5-04.
      return null;
    }
  }, [globalContextRef, setProjects]);

  // Start-up recovery: whatever a closed tab, a crash or another device left
  // pending is rebuilt once the projects have loaded. This is the path that did
  // not exist — H11 lost the work precisely because nobody came back for it.
  const recoveredAtStartup = useRef(false);
  useEffect(() => {
    if (recoveredAtStartup.current || projects.length === 0) return;
    recoveredAtStartup.current = true;
    void processGraphProjections().then((report) => {
      if (report && report.recovered.length > 0) {
        observabilityService.trackEvent({
          severity: 'info',
          source: 'operation',
          status: 'observed',
          title: 'Grafo de conocimiento recuperado',
          message: `Se reconstruyeron ${report.recovered.length} grafo(s) que habían quedado pendientes.`,
          operationName: 'recoverGraphProjections',
          recoverable: true,
          userVisible: false,
          metadata: { projectIds: report.recovered.map((entry) => entry.projectId).join(', ') },
        });
      }
    });
  }, [projects.length, processGraphProjections]);

  // Architecture Knowledge Graph — automatic, debounced freshness keeping.
  // Any artifact change (content, IR, objective, key concepts, envelope,
  // generation trace, type, representation, deletion, version restore, new
  // version) shifts the project's content signature. A project that already
  // opted into the graph gets it rebuilt after a quiet period, so the
  // canonical model never silently drifts. Projects without a graph are left
  // untouched — no surprise writes for legacy projects (backwards-compatible).
  useEffect(() => {
    const timers: number[] = [];
    for (const project of projects) {
      if (!project.architectureKnowledgeGraph) continue;
      const freshness = resolveProjectArchitectureGraphFreshness(project, {
        globalContext,
      });
      if (freshness !== 'stale') continue;
      const projectId = project.id;
      const timer = window.setTimeout(() => {
        // Re-check against the latest state: the project may have changed
        // again, been deleted, or already been recalculated manually.
        const latest = projectsRef.current.find(p => p.id === projectId);
        if (!latest || !latest.architectureKnowledgeGraph) return;
        if (resolveProjectArchitectureGraphFreshness(latest, {
          globalContext: globalContextRef.current,
        }) !== 'stale') return;
        void processGraphProjections([projectId]).then((report) => {
          // The outbox had nothing for this project — a database without the
          // outbox yet, or a staleness no artifact write explains (a legacy
          // graph, a changed global context) — so the in-tab rebuild does it.
          const handled = report?.available === true && (
            report.recovered.some((entry) => entry.projectId === projectId)
            || report.skipped.includes(projectId)
            || report.failed.some((entry) => entry.projectId === projectId)
          );
          if (!handled) rebuildArchitectureGraph(projectId);
        });
      }, ARCHITECTURE_GRAPH_REBUILD_DEBOUNCE_MS);
      timers.push(timer);
    }
    // Each artifact change re-runs this effect; clearing pending timers here
    // is what makes the rebuild debounced rather than fire-per-keystroke.
    return () => { timers.forEach((id) => window.clearTimeout(id)); };
  }, [projects, globalContext, rebuildArchitectureGraph, processGraphProjections, projectsRef, globalContextRef]);

  const savePublicationPackages = useCallback((projectId: string, packages: PublicationPackage[]) => {
    // Persisted through the standard project-update path, so optimistic
    // rollback and concurrency control are unchanged.
    updateProject(projectId, { publicationPackages: packages });
  }, [updateProject]);

  return { rebuildArchitectureGraph, getArchitectureGraphFreshness, savePublicationPackages };
};
