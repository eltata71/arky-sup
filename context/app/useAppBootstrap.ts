/**
 * The first read: the user's projects and their settings.
 *
 * Runs once auth has resolved, and reports degradation before it tries —
 * an unconfigured Firebase is a supported state, not an error, and the banner
 * has to say so before the first write silently lands in `localStorage`.
 *
 * Loaded settings are *merged onto* the defaults rather than replacing them,
 * so a record written before a field existed does not come back missing it.
 */

import { useEffect, useState } from 'react';
import type { Settings } from '../../types';
import type { Project } from '../../services/architectureProjects';
import { assertBackendConfigured } from '../../services/persistence';
import { settingsRepository } from '../../services/settings';
import { resolveTextModel } from '../../lib/ai/modelCatalog';
import { can } from '../../lib/authz';
import { useAuth } from '../AuthContext';
import type { PersistenceReporter } from './usePersistenceReporter';

interface AppBootstrapPorts {
  readonly setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  readonly setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  /** From `useProjectsState`, which owns the array this fills. */
  readonly loadProjects: (userId: string | undefined, includeAll: boolean) => Promise<Project[]>;
  readonly reporter: PersistenceReporter;
}

/** Returns whether the first load is still in flight. */
export const useAppBootstrap = ({ setProjects, setSettings, loadProjects, reporter }: AppBootstrapPorts): boolean => {
  const [isLoading, setIsLoading] = useState(true);
  const { user, profile, isLoading: authLoading } = useAuth();
  const { setPersistenceStatus, setPersistenceMessage } = reporter;

  // Load Projects and Settings
  useEffect(() => {
    if (authLoading) return;

    const fetchData = async () => {
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
        console.error("AppContext: Error fetching initial data", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [authLoading, user, profile, loadProjects, setProjects, setSettings, setPersistenceStatus, setPersistenceMessage]);

  return isLoading;
};
