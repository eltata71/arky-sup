/**
 * El nombre con el que se muestra a un agente: el alias que el usuario le dio
 * en su ficha, o el de fábrica (plan de agentes, 16.1 corte 3 · A5).
 *
 * Avatares, chips, tableros y la bitácora de coordinación leían el alias de
 * `OFFICE_AGENT_PERSONAS`, así que un agente renombrado seguía llamándose como
 * en fábrica en todas partes salvo en su ficha. Las menciones (`@Elena`)
 * siguen resolviéndose con el alias de fábrica: es el nombre estable con el
 * que se le escribe.
 */
import { useCallback } from 'react';
import { OFFICE_AGENT_PERSONAS } from '../services/architectureOffice/domain/officeAgentPersonas';
import { useLazyAgentProfiles, type ProfileAgentId } from './useLazyAgentProfiles';

export type AgentDisplayName = (agentId: ProfileAgentId) => string;

export const useAgentDisplayName = (): AgentDisplayName => {
  const profiles = useLazyAgentProfiles();
  return useCallback(
    (agentId) => profiles.find((profile) => profile.agentId === agentId)?.alias
      ?? OFFICE_AGENT_PERSONAS[agentId]?.alias
      ?? agentId,
    [profiles],
  );
};
