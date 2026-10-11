/**
 * The first read: the user's projects and their settings.
 *
 * Runs once auth has resolved, and reports degradation before it tries —
 * an unconfigured Firebase is a supported state, not an error, and the banner
 * has to say so before the first write silently lands in `localStorage`.
 *
 * Loaded settings are *merged onto* the defaults rather than replacing them,
 * so a record written before a field existed does not come back missing it.
 *
 * **A failed read is reported, never shown as an empty portfolio** (13.4). It
 * used to be a `console.error`, and the screens then rendered «no projects
 * yet» over a read that never arrived — telling someone their work was gone.
 * The failure is now `loadError`, recorded in observability, and `reload`
 * retries it.
 */

import { useCallback, useEffect, useState } from 'react';
import type { Settings } from '../../types';
import type { Project } from '../../services/architectureProjects';
import { assertBackendConfigured } from '../../services/persistence';
import { settingsRepository } from '../../services/settings';
import { resolveTextModel } from '../../lib/ai/modelCatalog';
import { can } from '../../lib/authz';
import { errorMessageOf } from '../../lib/errorMessage';
import { observabilityService } from '../../services/observability';
import { useAuth } from '../AuthContext';
import type { PersistenceReporter } from './usePersistenceReporter';

interface AppBootstrapPorts {
  readonly setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  readonly setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  /** From `useProjectsState`, which owns the array this fills. */
  readonly loadProjects: (userId: string | undefined, includeAll: boolean) => Promise<Project[]>;
  readonly reporter: PersistenceReporter;
}

export interface AppBootstrapState {
  /** Whether the first load (or a retry) is still in flight. */
  isLoading: boolean;
  /** Why the projects could not be read, or `null`. */
  loadError: string | null;
  /** Read again, after a failure. */
  reload: () => void;
}

export const useAppBootstrap = ({ setProjects, setSettings, loadProjects, reporter }: AppBootstrapPorts): AppBootstrapState => {
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { user, profile, isLoading: authLoading } = useAuth();
  const { setPersistenceStatus, setPersistenceMessage } = reporter;

  // Load Projects and Settings
  useEffect(() => {
    if (authLoading) return;

    const fetchData = async () => {
      setIsLoading(true);
      setLoadError(null);
      const availability = assertBackendConfigured();
      if (!availability.success) {
        setPersistenceStatus('degraded');
        setPersistenceMessage(availability.message ?? 'Supabase no está configurado; la persistencia remota está deshabilitada.');
      }
      try {
        const [loadedProjects, loadedSettings] = await Promise.all([
          loadProjects(user?.uid, can(profile, 'users:read')),
          settingsRepository.load(user?.uid)
        ]);
        
        setProjects(loadedProjects);
        if (loadedSettings) {
          // Merge loaded settings with default structure to ensure new fields exist
          setSettings(prev => {
            const mergedAiConfig = { ...prev.aiConfig, ...(loadedSettings.aiConfig || {}) };
            return {
              ...prev,
              ...loadedSettings,
              aiConfig: {
                ...mergedAiConfig,
                model: resolveTextModel(mergedAiConfig.model)
              }
            };
          });
        }
      } catch (error) {
        const message = errorMessageOf(error, 'No se pudieron leer los proyectos.');
        setLoadError(message);
        observabilityService.reportError(error, {
          title: 'No se pudieron cargar los proyectos',
          source: 'operation',
          severity: 'error',
          recoverable: true,
          userVisible: true,
          operationName: 'app.bootstrap',
        });
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [authLoading, user, profile, loadProjects, setProjects, setSettings, setPersistenceStatus, setPersistenceMessage, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { isLoading, loadError, reload };
};
