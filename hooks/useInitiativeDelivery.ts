/**
 * Los proyectos que sirven a una iniciativa, y lo que mueven en ella.
 *
 * Aquí se juntan tres módulos que a propósito no se conocen entre sí:
 * `portfolioGraph` decide **qué** proyectos responden a la iniciativa —ids
 * primero, códigos sólo como migración, que es la única regla de resolución del
 * producto—, `architectureProjects` describe el parte de cada uno, y
 * `businessInitiatives` lo consolida contra sus resultados e indicadores.
 *
 * Que la composición viva en un hook y no en la pantalla es lo que mantiene a
 * `InitiativeRoom` en dos módulos de servicio, y lo que hace que el encaje
 * entre el puerto y quien lo suministra se compruebe en un solo sitio: si
 * `AttentionDeliveryReport` y `DeliveryContributor` dejan de encajar, esta
 * línea deja de compilar.
 */

import { useMemo } from 'react';
import {
  describeAttentionDelivery,
  type AttentionDeliveryReport,
} from '../services/architectureProjects';
import {
  rollUpInitiativeDelivery,
  type BusinessInitiative,
  type InitiativeDeliveryRollup,
} from '../services/businessInitiatives';
import { resolvePortfolioGraph } from '../services/portfolioGraph';
import type { Project } from '../types';

export interface InitiativeDelivery {
  /** Los proyectos de arquitectura que responden a esta iniciativa. */
  attentions: Project[];
  /** El parte de cada uno, en el mismo orden. */
  reports: AttentionDeliveryReport[];
  rollup: InitiativeDeliveryRollup;
}

export const useInitiativeDelivery = (
  initiative: BusinessInitiative | undefined,
  initiatives: readonly BusinessInitiative[],
  projects: readonly Project[],
): InitiativeDelivery => useMemo(() => {
  if (!initiative) {
    return {
      attentions: [],
      reports: [],
      rollup: rollUpInitiativeDelivery({ expectedOutcomes: [], kpis: [] }, []),
    };
  }

  // El grafo se resuelve sobre el portafolio entero porque la resolución de un
  // enlace necesita conocer todas las iniciativas: un código que no resuelve
  // sólo se puede afirmar mirando la lista completa.
  const graph = resolvePortfolioGraph(initiatives, projects, [], {
    reportOrphanAttentions: false,
  });
  const node = graph.initiatives.find((entry) => entry.id === initiative.id);
  const attentions = node?.attentions.map((entry) => entry.project) ?? [];
  const reports = attentions.map((project) => describeAttentionDelivery(project, initiative.id));

  return { attentions, reports, rollup: rollUpInitiativeDelivery(initiative, reports) };
}, [initiative, initiatives, projects]);
