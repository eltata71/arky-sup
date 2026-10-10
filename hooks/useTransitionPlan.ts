/**
 * El plan de transición de un proyecto: línea base, objetivo, brechas y hoja de
 * ruta. Une dos contextos que no se importan —el proyecto, que guarda el plan, y
 * el inventario, contra el que se calculan las brechas—, y por eso vive en un
 * hook: la pantalla no importa ningún servicio. No decide nada; las brechas y la
 * hoja de ruta se derivan en el dominio cada vez, nunca se guardan.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAppContext } from '../context/AppContext';
import { deriveRoadmap, type Roadmap, type TransitionCommand, type TransitionPlan } from '../services/architectureProjects';
import { analyzeGaps, listInventory, type GapAnalysis, type InventoryItem } from '../services/enterpriseRepository';

export interface UseTransitionPlanResult {
  readonly projects: readonly { readonly id: string; readonly name: string }[];
  readonly plan: TransitionPlan | undefined;
  readonly milestones: readonly { readonly id: string; readonly name: string; readonly dueAt: string }[];
  readonly inventory: readonly InventoryItem[];
  readonly gaps: GapAnalysis;
  readonly roadmap: Roadmap;
  readonly hasTracking: boolean;
  readonly isLoading: boolean;
  readonly failed: boolean;
  /** `true` si el dominio aceptó la orden (aunque no cambiase nada). */
  readonly run: (command: TransitionCommand) => boolean;
}

export const useTransitionPlan = (projectId: string | null): UseTransitionPlanResult => {
  const { user } = useAuth();
  const { projects, runProjectCommand } = useAppContext();
  const [inventory, setInventory] = useState<readonly InventoryItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const userId = user?.uid;

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    setFailed(false);
    listInventory(userId)
      .then((items) => {
        if (!cancelled) setInventory(items);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const project = useMemo(() => projects.find((p) => p.id === projectId), [projects, projectId]);
  const plan = project?.attention?.transition;
  const items = useMemo(() => inventory ?? [], [inventory]);
  const gaps = useMemo(() => analyzeGaps(plan, items), [plan, items]);
  const roadmap = useMemo(() => deriveRoadmap(plan, project?.attention), [plan, project?.attention]);
  const milestones = useMemo(
    () => (project?.attention?.milestones ?? []).map((m) => ({ id: m.id, name: m.name, dueAt: m.dueAt })),
    [project?.attention?.milestones],
  );
  const projectList = useMemo(() => projects.map((p) => ({ id: p.id, name: p.name })), [projects]);

  const run = useCallback(
    (command: TransitionCommand): boolean =>
      projectId ? runProjectCommand(projectId, { kind: 'update-transition', command }).ok : false,
    [projectId, runProjectCommand],
  );

  return {
    projects: projectList,
    plan,
    milestones,
    inventory: items,
    gaps,
    roadmap,
    hasTracking: Boolean(project?.attention),
    isLoading: !inventory && !failed,
    failed,
    run,
  };
};
