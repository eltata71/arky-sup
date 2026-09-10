/**
 * Cómo la ejecución de los proyectos mueve la iniciativa que los justifica.
 *
 * El enlace entre los dos niveles ya era un id, así que el portafolio siempre
 * supo *qué* proyectos responden a una iniciativa. Lo que no sabía responder es
 * la pregunta que hace quien la patrocina: *¿qué cambia esto para mí y cuánto
 * de mi iniciativa depende de ello?* Una jerarquía que no puede contestarla
 * deja la iniciativa reducida a una carpeta con proyectos dentro.
 *
 * Este módulo consolida esa respuesta, y lo hace **sin conocer el módulo de
 * proyectos**. Declara el puerto —lo que necesita de un contribuyente— y
 * `services/architectureProjects` lo suministra con
 * `describeAttentionDelivery`. Es el mismo patrón con el que `services/agent`
 * dejó de saber que existe la Oficina: la dependencia que debe apuntar en un
 * solo sentido se convierte en un puerto, y quien compone las dos mitades —el
 * hook que las junta— es donde el compilador comprueba que encajan.
 *
 * Cuatro decisiones que este fichero existe para sostener:
 *
 * 1. **Lo no declarado no es cero.** Un proyecto sin avance declarado no entra
 *    en la media ponderada; sale aparte, contado, para que un portafolio a
 *    medio instrumentar no se lea como un portafolio parado.
 * 2. **Los pesos se respetan o se reparten por igual, y se dice cuál.** Un peso
 *    inventado tiene el aspecto de una medición.
 * 3. **Las referencias rotas se reportan, nunca se descartan.** Una
 *    contribución que cita un resultado que ya no existe es un enlace que hay
 *    que arreglar, no una fila que deba desaparecer del informe.
 * 4. **La cobertura se mide en las dos direcciones.** Un resultado esperado que
 *    ningún proyecto declara servir es el hallazgo más útil de todo el panel:
 *    es trabajo que el negocio espera y que nadie ha empezado.
 */

import type { BusinessInitiative } from './BusinessInitiativeTypes';

/** Una contribución declarada, tal y como la necesita la consolidación. */
export interface DeliveryContribution {
  id: string;
  statement: string;
  outcomeId?: string;
  kpiId?: string;
  weight?: number;
  state: 'planned' | 'in-progress' | 'delivered' | 'blocked';
}

/**
 * El puerto: lo que la iniciativa necesita saber de un proyecto que la sirve.
 *
 * Deliberadamente mínimo. Cada campo de más aquí es una decisión del modelo de
 * proyectos que la iniciativa pasaría a conocer.
 */
export interface DeliveryContributor {
  projectId: string;
  name: string;
  /** 0..1, o `null` si nadie lo ha declarado ni se puede deducir. */
  progress: number | null;
  health: 'on-track' | 'at-risk' | 'off-track' | 'closed' | 'unknown';
  contributions: readonly DeliveryContribution[];
  risks: { total: number; severe: number };
}

export interface DanglingContributionRef {
  projectId: string;
  contributionId: string;
  reason: 'unknown-outcome' | 'unknown-kpi';
  /** El id que no resolvió, para poder decirlo en pantalla. */
  reference: string;
}

export interface InitiativeDeliveryRollup {
  /** Proyectos de arquitectura que responden a esta iniciativa. */
  total: number;
  /** Cuántos de ellos declaran avance (o permiten deducirlo). */
  measured: number;
  /** Cuántos están cerrados: entregados o cancelados. */
  closed: number;
  /** Cuántos están fuera de rumbo hoy. */
  offTrack: number;
  /** Avance ponderado 0..1 sobre los medidos, o `null` si no hay ninguno. */
  progress: number | null;
  /** `declared` si los pesos vienen del usuario; `even` si se repartió por igual. */
  weighting: 'declared' | 'even' | 'none';
  /** Suma de los pesos declarados. Distinto de 100 es un aviso, no un error. */
  declaredWeight: number;
  /** Riesgos severos que la iniciativa hereda de sus proyectos. */
  inheritedSevereRisks: number;
  /** Resultados esperados que ningún proyecto declara servir. */
  uncoveredOutcomeIds: string[];
  /** Indicadores que ningún proyecto declara mover. */
  uncoveredKpiIds: string[];
  /** Contribuciones que citan algo que ya no existe en la iniciativa. */
  danglingReferences: DanglingContributionRef[];
  /** Contribuciones bloqueadas, con el proyecto que las declara. */
  blocked: { projectId: string; contribution: DeliveryContribution }[];
}

const EVEN_WEIGHT = 1;

/** El peso de un proyecto: lo declarado en sus contribuciones, si hay algo. */
const declaredWeightOf = (contributor: DeliveryContributor): number =>
  contributor.contributions.reduce(
    (total, contribution) => total + (typeof contribution.weight === 'number' && contribution.weight > 0
      ? contribution.weight
      : 0),
    0,
  );

/**
 * Consolida lo que los proyectos declaran mover en esta iniciativa.
 *
 * Pura y sin fechas propias: el estado de salud de cada contribuyente ya viene
 * resuelto, así que dos llamadas con la misma entrada dan el mismo resultado.
 */
export const rollUpInitiativeDelivery = (
  initiative: Pick<BusinessInitiative, 'expectedOutcomes' | 'kpis'>,
  contributors: readonly DeliveryContributor[],
): InitiativeDeliveryRollup => {
  const outcomeIds = new Set(initiative.expectedOutcomes.map((outcome) => outcome.id));
  const kpiIds = new Set(initiative.kpis.map((kpi) => kpi.id));

  const servedOutcomes = new Set<string>();
  const servedKpis = new Set<string>();
  const danglingReferences: DanglingContributionRef[] = [];
  const blocked: { projectId: string; contribution: DeliveryContribution }[] = [];

  let declaredWeight = 0;
  let inheritedSevereRisks = 0;
  let closed = 0;
  let offTrack = 0;
  let weightedProgress = 0;
  let weightUsed = 0;
  let measured = 0;

  const anyWeightDeclared = contributors.some((contributor) => declaredWeightOf(contributor) > 0);

  for (const contributor of contributors) {
    inheritedSevereRisks += contributor.risks.severe;
    if (contributor.health === 'closed') closed += 1;
    if (contributor.health === 'off-track') offTrack += 1;

    for (const contribution of contributor.contributions) {
      if (contribution.outcomeId) {
        if (outcomeIds.has(contribution.outcomeId)) servedOutcomes.add(contribution.outcomeId);
        else {
          danglingReferences.push({
            projectId: contributor.projectId,
            contributionId: contribution.id,
            reason: 'unknown-outcome',
            reference: contribution.outcomeId,
          });
        }
      }
      if (contribution.kpiId) {
        if (kpiIds.has(contribution.kpiId)) servedKpis.add(contribution.kpiId);
        else {
          danglingReferences.push({
            projectId: contributor.projectId,
            contributionId: contribution.id,
            reason: 'unknown-kpi',
            reference: contribution.kpiId,
          });
        }
      }
      if (contribution.state === 'blocked') {
        blocked.push({ projectId: contributor.projectId, contribution });
      }
    }

    const weight = declaredWeightOf(contributor);
    declaredWeight += weight;

    if (contributor.progress === null) continue;
    measured += 1;
    // Un proyecto sin peso declarado en un portafolio que sí los usa cuenta
    // como uno: descartarlo del cálculo sería peor —desaparecería del avance
    // sin que nadie lo hubiera decidido.
    const effectiveWeight = anyWeightDeclared ? (weight || EVEN_WEIGHT) : EVEN_WEIGHT;
    weightedProgress += contributor.progress * effectiveWeight;
    weightUsed += effectiveWeight;
  }

  return {
    total: contributors.length,
    measured,
    closed,
    offTrack,
    progress: weightUsed > 0 ? weightedProgress / weightUsed : null,
    weighting: contributors.length === 0 ? 'none' : (anyWeightDeclared ? 'declared' : 'even'),
    declaredWeight,
    inheritedSevereRisks,
    uncoveredOutcomeIds: initiative.expectedOutcomes
      .filter((outcome) => !servedOutcomes.has(outcome.id))
      .map((outcome) => outcome.id),
    uncoveredKpiIds: initiative.kpis
      .filter((kpi) => !servedKpis.has(kpi.id))
      .map((kpi) => kpi.id),
    danglingReferences,
    blocked,
  };
};
