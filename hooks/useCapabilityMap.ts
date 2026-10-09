/**
 * El mapa de capacidades de quien tiene la sesión abierta. Une dos contextos que
 * no se importan —el inventario y el portafolio— y por eso vive en un hook: la
 * pantalla importa un solo módulo de servicio. Las iniciativas de cada proyecto
 * salen de `initiativesServedBy` (ids primero), la única regla del producto.
 */

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAppContext } from '../context/AppContext';
import { useInitiatives } from '../context/InitiativeContext';
import { buildCapabilityMap, listInventory, type CapabilityMap, type InitiativesByProject } from '../services/enterpriseRepository';
import { initiativesServedBy } from '../services/portfolioGraph';
import type { InventoryItem } from '../services/enterpriseRepository';

export interface UseCapabilityMapResult {
  readonly map: CapabilityMap | null;
  readonly isLoading: boolean;
  readonly failed: boolean;
}

export const useCapabilityMap = (): UseCapabilityMapResult => {
  const { user } = useAuth();
  const { projects } = useAppContext();
  const { initiatives } = useInitiatives();
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

  const initiativesByProject = useMemo<InitiativesByProject>(
    () => new Map(projects.map((p) => [p.id, initiativesServedBy(p, initiatives).map((i) => i.id)])),
    [projects, initiatives],
  );

  const map = useMemo(
    () => (inventory ? buildCapabilityMap(inventory, initiativesByProject) : null),
    [inventory, initiativesByProject],
  );

  return { map, isLoading: !map && !failed, failed };
};
