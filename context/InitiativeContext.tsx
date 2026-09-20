/**
 * InitiativeContext — state and operations for business initiatives.
 *
 * A separate provider rather than more surface on `AppContext`, for the same
 * reason `OfficeContext` is separate: `CLAUDE.md` names that file as at its
 * practical ceiling, and initiatives are their own bounded context.
 *
 * The provider owns the lifecycle only. Shapes, normalization and metrics all
 * live in `services/businessInitiatives/` as pure functions, so they can be
 * tested without React.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from './AuthContext';
import {
  createBusinessInitiative,
  deleteInitiative as deleteInitiativeRemote,
  listInitiatives,
  saveInitiative,
  type BusinessInitiative,
  type CreateInitiativeInput,
} from '../services/businessInitiatives';

export interface InitiativeOperationResult {
  ok: boolean;
  initiative?: BusinessInitiative;
  /** Spanish, user-facing. Always set when `ok` is false. */
  reason?: string;
}

interface InitiativeContextType {
  initiatives: BusinessInitiative[];
  isLoading: boolean;
  /** Codes already in use — the wizard needs them to allocate the next one. */
  usedCodes: string[];
  reload: () => Promise<void>;
  getInitiative: (initiativeId: string) => BusinessInitiative | undefined;
  /** Resolves the initiative an architecture project links to, by code. */
  getByCode: (code: string) => BusinessInitiative | undefined;
  createInitiative: (input: CreateInitiativeInput) => Promise<InitiativeOperationResult>;
  /**
   * Applies a partial change. Merges over the current record rather than
   * replacing it, so two panels editing different sections cannot clobber
   * each other's fields.
   */
  updateInitiative: (
    initiativeId: string,
    patch: Partial<Omit<BusinessInitiative, 'id' | 'userId' | 'createdAt' | 'schemaVersion'>>,
  ) => Promise<InitiativeOperationResult>;
  deleteInitiative: (initiativeId: string) => Promise<InitiativeOperationResult>;
}

const InitiativeContext = createContext<InitiativeContextType | undefined>(undefined);

export const InitiativeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [initiatives, setInitiatives] = useState<BusinessInitiative[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  /**
   * Operations read from here, never from the `initiatives` state closure.
   *
   * The detail screen edits several sections from the same handler chain (add
   * a KPI, then mark a milestone). A callback captured before the first write
   * would still hold the pre-write snapshot and silently drop it. The ref is
   * updated synchronously by `commit`, so any call order sees current state.
   */
  const initiativesRef = useRef<BusinessInitiative[]>([]);

  const commit = useCallback((next: BusinessInitiative[]) => {
    initiativesRef.current = next;
    setInitiatives(next);
  }, []);

  const upsert = useCallback((initiative: BusinessInitiative) => {
    const next = [
      initiative,
      ...initiativesRef.current.filter((item) => item.id !== initiative.id),
    ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    commit(next);
  }, [commit]);

  const userId = user?.uid ?? 'local-user';

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      commit(await listInitiatives(userId));
    } finally {
      setIsLoading(false);
    }
  }, [userId, commit]);

  useEffect(() => {
    // Signing out must not leave the previous user's initiatives on screen.
    if (!user) {
      commit([]);
      return;
    }
    void reload();
  }, [user, reload, commit]);

  const getInitiative = useCallback(
    (initiativeId: string) => initiatives.find((item) => item.id === initiativeId),
    [initiatives],
  );

  const getByCode = useCallback(
    (code: string) => initiatives.find((item) => item.code === code),
    [initiatives],
  );

  const usedCodes = useMemo(
    () => initiatives.map((item) => item.code).filter(Boolean),
    [initiatives],
  );

  const createInitiative = useCallback(async (
    input: CreateInitiativeInput,
  ): Promise<InitiativeOperationResult> => {
    // Las reglas —título, necesidad, dueño— son del agregado, no de esta
    // pantalla. Aquí sólo se aporta de quién es y qué códigos están cogidos.
    const created = createBusinessInitiative({
      input,
      userId,
      existingCodes: initiativesRef.current.map((item) => item.code),
    });
    if (created.outcome === 'rejected') return { ok: false, reason: created.rejection.message };
    const initiative = created.initiative;
    // Optimistic: the record is usable immediately and the write lands behind
    // it, matching how `addProject` already behaves.
    upsert(initiative);

    const result = await saveInitiative(initiative);
    if (!result.success) {
      if (result.status !== 'offline') commit(initiativesRef.current.filter((item) => item.id !== initiative.id));
      return { ok: false, reason: result.message ?? 'La iniciativa quedó sin confirmar.' };
    }
    // Lo confirmado, no lo enviado: lo enviado lleva el testigo de revisión
    // anterior y la siguiente escritura sería un conflicto garantizado.
    const confirmed = result.data ?? initiative;
    upsert(confirmed);
    return { ok: true, initiative: confirmed };
  }, [userId, upsert, commit]);

  const updateInitiative = useCallback(async (
    initiativeId: string,
    patch: Partial<Omit<BusinessInitiative, 'id' | 'userId' | 'createdAt' | 'schemaVersion'>>,
  ): Promise<InitiativeOperationResult> => {
    const current = initiativesRef.current.find((item) => item.id === initiativeId);
    if (!current) return { ok: false, reason: 'La iniciativa no existe.' };

    const next: BusinessInitiative = {
      ...current,
      ...patch,
      id: current.id,
      userId: current.userId,
      createdAt: current.createdAt,
      schemaVersion: current.schemaVersion,
      updatedAt: new Date().toISOString(),
    };
    upsert(next);

    const result = await saveInitiative(next);
    if (!result.success) {
      if (result.status !== 'offline') upsert(current); // El fallo remoto nunca pasa por éxito.
      return { ok: false, reason: result.message ?? 'Los cambios quedaron sin confirmar.' };
    }
    const confirmed = result.data ?? next;
    upsert(confirmed);
    return { ok: true, initiative: confirmed };
  }, [upsert]);

  const deleteInitiative = useCallback(async (
    initiativeId: string,
  ): Promise<InitiativeOperationResult> => {
    const current = initiativesRef.current.find((item) => item.id === initiativeId);
    if (!current) return { ok: false, reason: 'La iniciativa no existe.' };

    commit(initiativesRef.current.filter((item) => item.id !== initiativeId));
    // La revisión del snapshot que se está viendo, no la de la última lectura.
    const result = await deleteInitiativeRemote(userId, initiativeId, current.revision ?? 0);
    if (!result.success) {
      upsert(current);
      return { ok: false, reason: result.message ?? 'El borrado quedó sin confirmar.' };
    }
    return { ok: true };
  }, [userId, commit, upsert]);

  const value = useMemo<InitiativeContextType>(() => ({
    initiatives,
    isLoading,
    usedCodes,
    reload,
    getInitiative,
    getByCode,
    createInitiative,
    updateInitiative,
    deleteInitiative,
  }), [
    initiatives, isLoading, usedCodes, reload, getInitiative,
    getByCode, createInitiative, updateInitiative, deleteInitiative,
  ]);

  return (
    <InitiativeContext.Provider value={value}>
      {children}
    </InitiativeContext.Provider>
  );
};

export const useInitiatives = (): InitiativeContextType => {
  const context = useContext(InitiativeContext);
  if (!context) {
    throw new Error('useInitiatives debe usarse dentro de <InitiativeProvider>.');
  }
  return context;
};
