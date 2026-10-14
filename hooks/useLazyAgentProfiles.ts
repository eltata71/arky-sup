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

/*
 * Una lectura por usuario, compartida. El avatar de un agente se pinta en
 * listas —tableros, paneles, el charter— y cada instancia pidiendo sus fichas
 * por su cuenta sería una lectura por avatar. Las suscripciones reciben la
 * lista nueva cuando alguien guarda una ficha (`invalidateLazyAgentProfiles`).
 */
const cache = new Map<string, Promise<readonly OfficeAgentProfile[]>>();
const listeners = new Set<() => void>();

const loadProfiles = (userId: string): Promise<readonly OfficeAgentProfile[]> => {
  let pending = cache.get(userId);
  if (!pending) {
    // Lazy on purpose: the cards' door must not join a route's chunk.
    pending = import('../services/architectureOffice/agents')
      .then(async ({ officeAgentProfileRepository, resolveAgentProfiles }) =>
        resolveAgentProfiles(await officeAgentProfileRepository.list(userId)))
      .catch(() => {
        // Sin fichas hablan las personas de fábrica; la próxima vez se reintenta.
        cache.delete(userId);
        return NONE;
      });
    cache.set(userId, pending);
  }
  return pending;
};

/**
 * Olvida las fichas leídas: quien guarda o restaura una ficha lo llama, y cada
 * pantalla montada vuelve a leerlas. Sin esto, renombrar a un agente no se
 * vería hasta recargar.
 */
export const invalidateLazyAgentProfiles = (): void => {
  cache.clear();
  for (const listener of listeners) listener();
};

export const useLazyAgentProfiles = (): readonly OfficeAgentProfile[] => {
  const userId = useOptionalAuth()?.user?.uid ?? '';
  const [profiles, setProfiles] = useState<readonly OfficeAgentProfile[]>(NONE);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const listener = () => setGeneration((value) => value + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  useEffect(() => {
    let alive = true;
    if (!userId) {
      setProfiles(NONE);
      return () => { alive = false; };
    }
    void loadProfiles(userId).then((loaded) => { if (alive) setProfiles(loaded); });
    return () => { alive = false; };
  }, [userId, generation]);

  return profiles;
};
