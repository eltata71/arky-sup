/**
 * Las iniciativas a las que responde un proyecto, resueltas por la regla del
 * producto y no por la que le venga bien a una pantalla.
 *
 * La regla es una sola y vive en `services/portfolioGraph`: mandan los ids, y
 * los códigos `NEG-YYYY-NNN` sólo se consultan cuando ningún id resolvió, como
 * migración perezosa de los registros antiguos. Escribirla otra vez dentro de
 * un componente —un `filter` por código, que es lo que había— produce una
 * segunda fuente de verdad que empieza a discrepar el día que alguien reenlaza
 * un proyecto desde el selector.
 *
 * Vive en un hook y no en el panel porque así la pantalla no tiene que importar
 * un tercer módulo de servicio para saber a quién sirve lo que muestra.
 */

import { useMemo } from 'react';
import { resolvePortfolioGraph } from '../services/portfolioGraph';
import type { BusinessInitiative } from '../services/businessInitiatives';
import type { Project } from '../types';

export const useAttentionInitiatives = (
  project: Project,
  initiatives: readonly BusinessInitiative[],
): BusinessInitiative[] => useMemo(() => {
  const graph = resolvePortfolioGraph(initiatives, [project], [], {
    reportOrphanAttentions: false,
  });
  const node = graph.attentions.find((entry) => entry.id === project.id);
  if (!node) return [];
  const byId = new Map(initiatives.map((entry) => [entry.id, entry]));
  return node.initiativeIds
    .map((id) => byId.get(id))
    .filter((entry): entry is BusinessInitiative => entry !== undefined);
}, [project, initiatives]);
