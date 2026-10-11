/**
 * How the Office reads its engagements: per project, plus the review board's
 * inbox, and whether an absence is still undecided. Moved out of
 * `OfficeContext` in 13.4, when the read learned to fail out loud.
 *
 * **A failed read is reported, never shown as an empty Office** (13.4). It
 * used to be a `try/finally`: the rejection escaped, the project stayed marked
 * as loaded, and the board said «no hay entregables» about work that exists.
 * Now the project is unmarked, the failure is `loadError` and recorded in
 * observability, and `retryLoad` asks again for what is missing.
 */
import { useCallback, useEffect, useState, type MutableRefObject } from 'react';
import type { OfficeEngagement } from '../../services/architectureOffice';
import { errorMessageOf } from '../../lib/errorMessage';
import { observabilityService } from '../../services/observability';

/** The two reads this needs; `OfficeContext` hands over the repository it already imports. */
export interface EngagementReads {
  list: (projectId: string) => Promise<OfficeEngagement[]>;
  listForArb: () => Promise<OfficeEngagement[]>;
}

interface EngagementLoadingPorts {
  readonly repository: EngagementReads;
  readonly projectIds: readonly string[];
  readonly canApprove: boolean;
  readonly authLoading: boolean;
  readonly engagementsRef: MutableRefObject<OfficeEngagement[]>;
  readonly commit: (next: OfficeEngagement[]) => void;
}

export interface EngagementLoadingState {
  isLoading: boolean;
  isResolving: boolean;
  loadError: string | null;
  loadEngagements: (projectId: string) => Promise<void>;
  retryLoad: () => void;
}

const byRecency = (a: OfficeEngagement, b: OfficeEngagement): number => b.updatedAt.localeCompare(a.updatedAt);

const reportLoadFailure = (error: unknown, operationName: string): string => {
  observabilityService.reportError(error, {
    title: 'No se pudieron cargar los entregables',
    source: 'operation',
    severity: 'error',
    recoverable: true,
    userVisible: true,
    operationName,
  });
  return errorMessageOf(error, 'No se pudieron leer los entregables.');
};

export function useEngagementLoading({ repository, projectIds, canApprove, authLoading, engagementsRef, commit }: EngagementLoadingPorts): EngagementLoadingState {
  const [pending, setPending] = useState(0);
  const [arbInboxSettled, setArbInboxSettled] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [arbAttempt, setArbAttempt] = useState(0);
  const [loadedProjectIds] = useState(() => new Set<string>());
  const [loadedArbEngagementIds] = useState(() => ({ current: new Set<string>() }));

  const loadEngagements = useCallback(async (projectId: string) => {
    if (loadedProjectIds.has(projectId)) return;
    loadedProjectIds.add(projectId);
    setPending((n) => n + 1);
    try {
      const loaded = await repository.list(projectId);
      commit([
        ...engagementsRef.current.filter((item) => item.projectId !== projectId),
        ...loaded,
      ].sort(byRecency));
    } catch (error) {
      loadedProjectIds.delete(projectId);
      setLoadError(reportLoadFailure(error, 'office.loadEngagements'));
    } finally {
      setPending((n) => n - 1);
    }
  }, [repository, commit, engagementsRef, loadedProjectIds]);

  // La opción C de ADR-101 necesita una bandeja independiente del portafolio:
  // los revisores descubren encargos ajenos sin convertir sus proyectos en
  // proyectos propios. Al perder el permiso se retiran esos snapshots.
  useEffect(() => {
    let cancelled = false;
    if (!canApprove) {
      const ids = loadedArbEngagementIds.current;
      if (ids.size > 0) {
        commit(engagementsRef.current.filter((item) => !ids.has(item.id)));
        ids.clear();
      }
      return undefined;
    }
    setPending((n) => n + 1);
    void repository.listForArb()
      .then((loaded) => {
        if (cancelled) return;
        const previousIds = loadedArbEngagementIds.current;
        loadedArbEngagementIds.current = new Set(loaded.map((item) => item.id));
        commit([
          ...engagementsRef.current.filter((item) => !previousIds.has(item.id)),
          ...loaded,
        ].sort(byRecency));
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(reportLoadFailure(error, 'office.listForArb'));
      })
      .finally(() => {
        setPending((n) => n - 1);
        if (!cancelled) setArbInboxSettled(true);
      });
    return () => { cancelled = true; };
  }, [repository, canApprove, commit, engagementsRef, loadedArbEngagementIds, arbAttempt]);

  const retryLoad = useCallback(() => {
    setLoadError(null);
    for (const projectId of projectIds) void loadEngagements(projectId);
    if (canApprove) setArbAttempt((n) => n + 1);
  }, [projectIds, loadEngagements, canApprove]);

  const isLoading = pending > 0;
  // A failed read is decided: it is an error, not something still on its way.
  const isResolving = loadError === null && (
    authLoading
    || isLoading
    || (canApprove && !arbInboxSettled)
    || projectIds.some((projectId) => !loadedProjectIds.has(projectId))
  );

  return { isLoading, isResolving, loadError, loadEngagements, retryLoad };
}
