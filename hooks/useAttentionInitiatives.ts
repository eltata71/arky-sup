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

import { useCallback, useMemo } from 'react';
import {
  initiativeLinksFor,
  resolveAttentionInitiativeLinks,
  resolvePortfolioGraph,
  withoutInitiativeCode,
  type InitiativeLinks,
} from '../services/portfolioGraph';
import type { BusinessInitiative } from '../services/businessInitiatives';
import type { Project } from '../services/architectureProjects';

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

export interface AttentionInitiativeLinkEditor {
  readonly linkedIds: string[];
  readonly unresolvedCodes: string[];
  /** Replaces the selection; ids and codes move together. */
  applyLinks(initiativeIds: string[]): void;
  /** Drops a code that resolves to no initiative. */
  dropUnresolvedCode(code: string): void;
}

/**
 * The picker's side of the same rule (F5-02): what is selected, what is broken,
 * and the two edits — resolved by `services/portfolioGraph`, never in a panel.
 */
export const useAttentionInitiativeLinks = (
  project: Project,
  initiatives: readonly BusinessInitiative[],
  onChange: (links: InitiativeLinks) => void,
): AttentionInitiativeLinkEditor => {
  const { linkedIds, unresolvedCodes } = useMemo(
    () => resolveAttentionInitiativeLinks(project, initiatives),
    [project, initiatives],
  );
  const applyLinks = useCallback(
    (initiativeIds: string[]) => onChange(initiativeLinksFor(initiativeIds, initiatives)),
    [initiatives, onChange],
  );
  const dropUnresolvedCode = useCallback(
    (code: string) => onChange(withoutInitiativeCode(project, linkedIds, code)),
    [project, linkedIds, onChange],
  );
  return { linkedIds, unresolvedCodes, applyLinks, dropUnresolvedCode };
};
