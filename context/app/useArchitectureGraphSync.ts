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
 */

import React, { useCallback, useEffect } from 'react';
import type { Project } from '../../types';
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
}

export const useArchitectureGraphSync = ({
  projects,
  projectsRef,
  globalContext,
  globalContextRef,
  updateProject,
}: ArchitectureGraphSyncPorts) => {
  const rebuildArchitectureGraph = useCallback((projectId: string): ArchitectureGraph | null => {
      // Refs keep this callback stable so the debounced auto-refresh can call
      // it without re-subscribing on every project change.
      const project = projectsRef.current.find(p => p.id === projectId);
      if (!project) return null;
      // The build is deterministic and total — it never throws. The resulting
      // graph carries a `sourceSignature`, so freshness can be derived later.
      const graph = buildArchitectureKnowledgeGraphForProject(project, {
          globalContext: globalContextRef.current,
          previousGraph: project.architectureKnowledgeGraph,
      });
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
        }) === 'stale') {
          rebuildArchitectureGraph(projectId);
        }
      }, ARCHITECTURE_GRAPH_REBUILD_DEBOUNCE_MS);
      timers.push(timer);
    }
    // Each artifact change re-runs this effect; clearing pending timers here
    // is what makes the rebuild debounced rather than fire-per-keystroke.
    return () => { timers.forEach((id) => window.clearTimeout(id)); };
  }, [projects, globalContext, rebuildArchitectureGraph, projectsRef, globalContextRef]);

  const savePublicationPackages = useCallback((projectId: string, packages: PublicationPackage[]) => {
    // Persisted through the standard project-update path, so optimistic
    // rollback and concurrency control are unchanged.
    updateProject(projectId, { publicationPackages: packages });
  }, [updateProject]);

  return { rebuildArchitectureGraph, getArchitectureGraphFreshness, savePublicationPackages };
};
