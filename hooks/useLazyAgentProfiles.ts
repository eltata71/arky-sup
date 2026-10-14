/**
 * Las fichas resueltas del usuario, cargadas en diferido (plan de agentes, 16.1).
 *
 * Los caminos que generan o conversan —Workspace, Proyectos, SDD, el chat, el
 * copiloto— necesitan las fichas para que cada agente hable con su voz
 * configurada, pero no la pantalla de gestión de fichas. Importar
 * `useAgentProfiles` (y con él el repositorio y su adaptador) los sumaba al
 * chunk de cada ruta: +4,7 KB gz, por encima del techo de Proyectos y de SDD.
 * Aquí la puerta de las fichas entra con `import()` al montar.
 *
 * Mientras no han llegado —o si no hay sesión, o la lectura falla— la lista
 * está vacía, y vacía significa «las personas de fábrica»: una ficha que tarda
 * no puede impedir que alguien responda.
 */
import { useEffect, useState } from 'react';
import { useOptionalAuth } from '../context/AuthContext';
import type { OfficeAgentProfile } from '../services/architectureOffice/agents';

const NONE: readonly OfficeAgentProfile[] = Object.freeze([]);

/** El id de un agente, para quien sólo maneja fichas y no quiere importar la Oficina. */
export type ProfileAgentId = OfficeAgentProfile['agentId'];

/** Los agentes que el usuario desactivó en su ficha. */
export const disabledProfileIds = (profiles: readonly OfficeAgentProfile[]): ProfileAgentId[] =>
  profiles.filter((profile) => !profile.enabled).map((profile) => profile.agentId);

export const useLazyAgentProfiles = (): readonly OfficeAgentProfile[] => {
  const userId = useOptionalAuth()?.user?.uid ?? '';
  const [profiles, setProfiles] = useState<readonly OfficeAgentProfile[]>(NONE);

  useEffect(() => {
    let alive = true;
    if (!userId) {
      setProfiles(NONE);
      return () => { alive = false; };
    }
    // Lazy on purpose: the cards' door must not join a route's chunk.
    void import('../services/architectureOffice/agents')
      .then(async ({ officeAgentProfileRepository, resolveAgentProfiles }) => {
        const stored = await officeAgentProfileRepository.list(userId);
        if (alive) setProfiles(resolveAgentProfiles(stored));
      })
      .catch(() => { /* sin fichas: hablan las personas de fábrica */ });
    return () => { alive = false; };
  }, [userId]);

  return profiles;
};
