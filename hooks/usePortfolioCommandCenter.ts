/**
 * Todo lo que el tablero sabe, resuelto una vez.
 *
 * El tablero abre el producto y tiene que responder «¿en qué estado está
 * todo?» cruzando los tres niveles gobernados. Eso son cinco derivaciones
 * —el grafo del portafolio, el resumen de la Oficina, el de las iniciativas, el
 * centro de mando y las tendencias— y ninguna de ellas es trabajo de React.
 *
 * Está en un hook y no en la pantalla por la misma razón que
 * `useInitiativeDelivery`: un fichero bajo `pages/` que importa tres módulos de
 * servicio *es* la capa de aplicación de esa pantalla, escrita en un sitio cuyo
 * trabajo es pintar. Aquí la composición vive fuera, la pantalla recibe un
 * modelo ya decidido, y el compilador comprueba que el puerto del centro de
 * mando y lo que cada contexto ofrece siguen encajando.
 *
 * Lo único que hace de React es lo único que le toca: cuándo recalcular.
 */

import { useEffect, useMemo } from 'react';
import type { Project } from '../services/architectureProjects';
import { type BusinessInitiative, rollupInitiatives } from '../services/businessInitiatives';
import { type OfficeEngagement, buildOfficePortfolio, buildPortfolioCommandCenter, windowedDelta, type OfficeActivityPoint, type OfficePortfolio, type PortfolioCommandCenter, type WindowedDelta } from '../services/architectureOffice';
import { resolvePortfolioGraph, type PortfolioGraph } from '../services/portfolioGraph';

/**
 * El ancho de la ventana de comparación, en días.
 *
 * Siete y no «desde siempre»: un tablero ejecutivo compara contra la semana
 * anterior porque es el ciclo en el que la Oficina realmente cambia de estado.
 * La serie de actividad que la Oficina publica cubre catorce días, que es
 * exactamente lo que hacen falta para tener dos ventanas completas — con menos,
 * `windowedDelta` devuelve `null` en vez de inventarse una tendencia.
 */
const COMPARISON_WINDOW_DAYS = 7;

export interface PortfolioCommandCenterModel {
  graph: PortfolioGraph;
  portfolio: OfficePortfolio;
  commandCenter: PortfolioCommandCenter;
  /** Tareas completadas por día, para las minigráficas de los KPI. */
  completionTrend: number[];
  /** Tareas completadas esta ventana frente a la anterior. */
  tasksDelta: WindowedDelta;
  /** Entregas cerradas esta ventana frente a la anterior. */
  deliveriesDelta: WindowedDelta;
  /** El texto que acompaña a cualquier delta, para no escribirlo en la pantalla. */
  comparisonLabel: string;
}

export const usePortfolioCommandCenter = (
  initiatives: readonly BusinessInitiative[],
  projects: readonly Project[],
  engagements: readonly OfficeEngagement[],
  loadEngagements: (projectId: string) => void | Promise<unknown>,
): PortfolioCommandCenterModel => {
  // Los entregables cuelgan de su proyecto, así que hay que pedírselos a cada
  // uno. `loadEngagements` es idempotente por id de proyecto.
  useEffect(() => {
    for (const project of projects) void loadEngagements(project.id);
  }, [projects, loadEngagements]);

  const graph = useMemo(
    () => resolvePortfolioGraph(initiatives, projects, engagements),
    [initiatives, projects, engagements],
  );

  const portfolio = useMemo(
    () => buildOfficePortfolio(projects, engagements, { initiatives }),
    [projects, engagements, initiatives],
  );

  const initiativeRollup = useMemo(() => rollupInitiatives(initiatives), [initiatives]);

  const commandCenter = useMemo(
    () => buildPortfolioCommandCenter(
      {
        total: initiativeRollup.total,
        atRisk: initiativeRollup.healthMix['at-risk'],
        awaitingDecision: initiativeRollup.awaitingDecision,
        overdue: initiativeRollup.overdue,
        milestonesMissed: initiativeRollup.milestonesMissed,
      },
      {
        total: graph.attentions.length,
        withoutInitiative: graph.unlinkedAttentions.length,
        brokenLinks: graph.issues.length,
      },
      {
        total: graph.deliverables.length,
        blocked: portfolio.rollup.statusMix.blocked,
        awaitingDecision: portfolio.rollup.awaitingDecision,
        overdueTasks: portfolio.rollup.overdueTasks,
        criticalFindings: portfolio.rollup.findings.critical,
      },
    ),
    [initiativeRollup, graph, portfolio],
  );

  const trends = useMemo(() => {
    const completed = portfolio.activity.map((point: OfficeActivityPoint) => point.tasksCompleted);
    const delivered = portfolio.activity.map((point: OfficeActivityPoint) => point.engagementsDelivered);
    return {
      completionTrend: completed,
      tasksDelta: windowedDelta(completed, COMPARISON_WINDOW_DAYS),
      deliveriesDelta: windowedDelta(delivered, COMPARISON_WINDOW_DAYS),
    };
  }, [portfolio.activity]);

  return {
    graph,
    portfolio,
    commandCenter,
    ...trends,
    comparisonLabel: `vs. ${COMPARISON_WINDOW_DAYS} días previos`,
  };
};

export default usePortfolioCommandCenter;
