/**
 * La bitácora de cambios de una ficha (16.4/16.5), leída sólo mientras la hoja
 * del agente está abierta: la lista informa y no decide, así que un fallo se
 * lee como «sin cambios registrados» en vez de tumbar la ficha.
 */

import { useEffect, useState } from 'react';
import {
  officeAgentProfileRepository,
  type OfficeAgentProfileChange,
} from '../services/architectureOffice/agents'; // the cards' door, not the barrel (F6-05)

export const useAgentProfileChanges = (agentId: string, version = 0): {
  changes: OfficeAgentProfileChange[];
  loading: boolean;
} => {
  const [changes, setChanges] = useState<OfficeAgentProfileChange[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void officeAgentProfileRepository.changes(agentId, 20).then((rows) => {
      if (!alive) return;
      setChanges(rows);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [agentId, version]);

  return { changes, loading };
};
