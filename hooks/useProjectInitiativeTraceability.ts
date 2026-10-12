/**
 * Lo que un proyecto declara mover en cada iniciativa a la que responde.
 *
 * Junta `portfolioGraph` (qué iniciativas sirve, ids primero), `architectureProjects`
 * (sus contribuciones) y `businessInitiatives` (los resultados y KPIs contra
 * los que se cruzan) sin que la pantalla importe un tercer módulo de servicio.
 */

import { useMemo } from 'react';
import { contributionsToInitiative, type Project } from '../services/architectureProjects';
import {
  traceInitiativeTargets,
  type BusinessInitiative,
  type InitiativeTraceability,
} from '../services/businessInitiatives';
import { initiativesServedBy } from '../services/portfolioGraph';

export const useProjectInitiativeTraceability = (
  project: Project | undefined,
  initiatives: readonly BusinessInitiative[],
): InitiativeTraceability[] => useMemo(() => {
  if (!project) return [];
  return initiativesServedBy(project, initiatives).map((initiative) =>
    traceInitiativeTargets(initiative, {
      projectId: project.id,
      contributions: contributionsToInitiative(project, initiative.id),
    }));
}, [project, initiatives]);
