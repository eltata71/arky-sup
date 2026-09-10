/**
 * Las fichas de los agentes, cargadas y resueltas para quien las mira.
 *
 * Un perfil son dos cosas que nunca se guardan juntas: lo que el agente **es**
 * —su rol, sus dominios, los artefactos que puede producir o revisar, los
 * estándares que sostiene— que viene con el producto y está congelado, y lo que
 * esta organización le **añade**, que es lo único que se persiste. Este hook
 * junta las dos mitades y entrega la vista resuelta, para que ninguna pantalla
 * tenga que acordarse de aplicar los ajustes por su cuenta.
 *
 * Lo que se guarda es una escritura por agente, no un array: dos pestañas
 * abiertas sobre la misma lista se pisan la una a la otra sin que nadie se
 * entere.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOptionalAuth } from '../context/AuthContext';
import {
  createAgentProfileOverride,
  officeAgentProfileRepository,
  resolveAgentProfiles,
  type OfficeAgentId,
  type OfficeAgentProfile,
  type OfficeAgentProfileCreation,
  type OfficeAgentProfileInput,
  type OfficeAgentProfileOverride,
} from '../services/architectureOffice';

export interface AgentProfilesApi {
  /** Las trece fichas, con lo configurado ya aplicado. */
  profiles: OfficeAgentProfile[];
  /** Lo guardado, por si una pantalla necesita saber qué se ha tocado. */
  overrides: OfficeAgentProfileOverride[];
  loading: boolean;
  /** Mensaje en español cuando la última escritura no llegó a la base. */
  notice: string | null;
  /**
   * Guarda la ficha. Devuelve el veredicto de la fábrica: un avatar inválido o
   * un alias vacío se rechazan con un mensaje que el editor pinta junto al
   * campo, en vez de lanzarse.
   */
  save: (input: Omit<OfficeAgentProfileInput, 'userId'>) => Promise<OfficeAgentProfileCreation>;
  /** Devuelve al agente a lo que trae el producto. */
  reset: (agentId: OfficeAgentId) => Promise<void>;
}

export const useAgentProfiles = (): AgentProfilesApi => {
  const user = useOptionalAuth()?.user ?? null;
  const userId = user?.uid ?? '';
  const [overrides, setOverrides] = useState<OfficeAgentProfileOverride[]>([]);
  const [loading, setLoading] = useState(Boolean(userId));
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!userId) {
      setOverrides([]);
      setLoading(false);
      return () => { alive = false; };
    }
    setLoading(true);
    void officeAgentProfileRepository.list(userId).then((stored) => {
      if (!alive) return;
      setOverrides(stored);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [userId]);

  const profiles = useMemo(() => resolveAgentProfiles(overrides), [overrides]);

  const save = useCallback(async (
    input: Omit<OfficeAgentProfileInput, 'userId'>,
  ): Promise<OfficeAgentProfileCreation> => {
    if (!userId) {
      return {
        outcome: 'rejected',
        code: 'unknown-agent',
        message: 'Hace falta una sesión iniciada para configurar un agente.',
      };
    }
    const created = createAgentProfileOverride({ ...input, userId });
    if (created.outcome === 'rejected') return created;

    // El estado local se actualiza con lo que la fábrica aceptó, no con lo que
    // el formulario envió: lo que se ve en pantalla es lo que se guardó.
    setOverrides((previous) => [
      created.override,
      ...previous.filter((entry) => entry.agentId !== created.override.agentId),
    ]);
    const result = await officeAgentProfileRepository.save(created.override);
    setNotice(result.success ? null : (result.message ?? "No se pudo guardar la ficha del agente."));
    return created;
  }, [userId]);

  const reset = useCallback(async (agentId: OfficeAgentId) => {
    if (!userId) return;
    setOverrides((previous) => previous.filter((entry) => entry.agentId !== agentId));
    const result = await officeAgentProfileRepository.reset(userId, agentId);
    setNotice(result.success ? null : (result.message ?? "No se pudo guardar la ficha del agente."));
  }, [userId]);

  return { profiles, overrides, loading, notice, save, reset };
};

/**
 * Lo guardado, sin resolver, para quien sólo necesita pasarlo hacia abajo.
 *
 * La guía de la plataforma compone el reparto por su cuenta —lo necesita como
 * texto, no como tarjetas— y `resolveAgentProfiles` ya se llama dentro de esa
 * composición. Resolverlo aquí también sería hacer el mismo trabajo dos veces
 * en cada pregunta.
 */
export const useAgentProfileOverrides = (): OfficeAgentProfileOverride[] => {
  const user = useOptionalAuth()?.user ?? null;
  const userId = user?.uid ?? '';
  const [overrides, setOverrides] = useState<OfficeAgentProfileOverride[]>([]);

  useEffect(() => {
    let alive = true;
    if (!userId) {
      setOverrides([]);
      return () => { alive = false; };
    }
    void officeAgentProfileRepository.list(userId).then((stored) => {
      if (alive) setOverrides(stored);
    });
    return () => { alive = false; };
  }, [userId]);

  return overrides;
};

/**
 * Una sola ficha guardada, para quien no necesita las trece.
 *
 * La usa la captura asistida: el arquitecto agente que ayuda a completar un
 * formulario tiene que ser **el configurado**, o la ficha sería decorativa.
 * Va contra la caché del repositorio, así que abrir seis formularios no son
 * seis lecturas.
 */
export const useAgentProfileOverride = (
  agentId: OfficeAgentId,
): OfficeAgentProfileOverride | undefined => {
  const user = useOptionalAuth()?.user ?? null;
  const userId = user?.uid ?? '';
  const [override, setOverride] = useState<OfficeAgentProfileOverride | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    if (!userId) {
      setOverride(undefined);
      return () => { alive = false; };
    }
    void officeAgentProfileRepository.list(userId).then((stored) => {
      if (!alive) return;
      setOverride(stored.find((entry) => entry.agentId === agentId));
    });
    return () => { alive = false; };
  }, [userId, agentId]);

  return override;
};
