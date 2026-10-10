/**
 * El portafolio de aplicaciones (TIME) y el radar tecnológico de quien tiene la
 * sesión abierta. Une dos contextos que no se importan —el inventario y los
 * estándares de la Oficina— y por eso vive en un hook: la pantalla importa un
 * solo módulo de servicio. No decide nada: el cuadrante y el anillo los resuelve
 * el dominio, y las órdenes pasan por `applyInventoryCommand` antes de guardarse.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getOfficeArchitectureContext } from '../services/architectureOffice/standards';
import {
  applyInventoryCommand,
  buildApplicationPortfolio,
  buildTechnologyRadar,
  listInventory,
  saveInventoryItem,
  type ApplicationPortfolio,
  type InventoryCommand,
  type InventoryItem,
  type TechnologyRadar,
} from '../services/enterpriseRepository';

export type PortfolioRunOutcome = 'saved' | 'unchanged' | 'rejected' | 'failed';

export interface UseApplicationPortfolioResult {
  readonly portfolio: ApplicationPortfolio | null;
  readonly radar: TechnologyRadar | null;
  readonly isLoading: boolean;
  readonly failed: boolean;
  readonly run: (itemId: string, command: InventoryCommand) => Promise<PortfolioRunOutcome>;
}

export const useApplicationPortfolio = (): UseApplicationPortfolioResult => {
  const { user } = useAuth();
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

  const portfolio = useMemo(() => (inventory ? buildApplicationPortfolio(inventory) : null), [inventory]);
  const radar = useMemo(
    () => (inventory ? buildTechnologyRadar(inventory, getOfficeArchitectureContext().standards) : null),
    [inventory],
  );

  const run = useCallback(
    async (itemId: string, command: InventoryCommand): Promise<PortfolioRunOutcome> => {
      const current = inventory ?? [];
      const item = current.find((i) => i.id === itemId);
      if (!item) return 'rejected';
      const result = applyInventoryCommand(item, command, {
        now: new Date().toISOString(),
        others: current.filter((i) => i.id !== itemId),
      });
      if (!result.ok) return 'rejected';
      if (!result.changed) return 'unchanged';
      const saved = await saveInventoryItem(result.item);
      if (!saved.success) return 'failed';
      const stored = saved.data && typeof saved.data === 'object' ? (saved.data as InventoryItem) : result.item;
      setInventory((prev) => (prev ?? []).map((i) => (i.id === itemId ? stored : i)));
      return 'saved';
    },
    [inventory],
  );

  return { portfolio, radar, isLoading: !inventory && !failed, failed, run };
};
