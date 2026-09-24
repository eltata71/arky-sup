/**
 * `AppContext` — the portfolio a signed-in user is working on.
 *
 * Projects, their artifacts, the settings that shape generation, the chat and
 * agent logs, and the Architecture Knowledge Graph. Forty modules read it, so
 * the surface is deliberately one context rather than four: splitting the
 * *provider* into hooks costs a consumer nothing, while splitting the
 * *context* would make every screen decide which of four to subscribe to.
 *
 * What is left in this file is composition and nothing else. Each concern owns
 * its own module under `context/app/`:
 *
 * | Module | Owns |
 * |---|---|
 * | `usePersistenceReporter`   | whether the last write reached the database |
 * | `useAppBootstrap`          | the first read of projects and settings |
 * | `useSettingsState`         | settings, theme, `t()` |
 * | `useProjectsState`         | the `projects` array and every project write |
 * | `useArtifactsState`        | artifacts, versions, and the rollback rule |
 * | `useProjectHistory`        | chat history and the agent action log |
 * | `useArchitectureGraphSync` | the debounced graph rebuild |
 *
 * `projects` has a single owner — `useProjectsState` — and the hooks that
 * write artifacts or graph fields do it through the `setProjects` and
 * `updateProject` handed to them. Two copies of the same artifacts is how a
 * canvas and a sidebar start disagreeing.
 */

import React, { createContext, useContext, useMemo, ReactNode } from 'react';
import type { AppContextType } from './app/appContextTypes';
import { usePersistenceReporter } from './app/usePersistenceReporter';
import { useAppBootstrap } from './app/useAppBootstrap';
import { useSettingsState } from './app/useSettingsState';
import { useProjectsState } from './app/useProjectsState';
import { useArtifactsState } from './app/useArtifactsState';
import { useProjectHistory } from './app/useProjectHistory';
import { useArchitectureGraphSync } from './app/useArchitectureGraphSync';

export type { AppContextType, ChatMessage, Project, ProjectAttentionTracking } from './app/appContextTypes';

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppContextProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const reporter = usePersistenceReporter();
  const { persistenceStatus, persistenceMessage } = reporter;

  const { settings, setSettings, globalContextRef, t, updateSettings } = useSettingsState(reporter);

  const {
    projects,
    setProjects,
    projectsRef,
    addProject,
    getProject,
    ensureProjectArtifacts,
    updateProject,
    deleteProject,
    updateProjectContext,
    loadProjects,
  } = useProjectsState(reporter);

  const isLoading = useAppBootstrap({ setProjects, setSettings, loadProjects, reporter });

  const {
    createArtifact,
    createArtifactVersion,
    getArtifact,
    updateArtifact,
    deleteArtifact,
    getGroupedArtifactsByView,
    applyConsistencySuggestion,
    toggleArtifactFavorite,
    findLatestArtifactByName,
    getArtifactVersions,
    restoreArtifactVersion,
    removeCorruptArtifacts,
  } = useArtifactsState({ setProjects, getProject, reporter });

  const {
    saveChatHistory,
    loadChatHistory,
    replaceChatHistory,
    logAgentAction,
    listAgentActions,
  } = useProjectHistory(reporter);

  const {
    rebuildArchitectureGraph,
    getArchitectureGraphFreshness,
    savePublicationPackages,
  } = useArchitectureGraphSync({
    projects,
    projectsRef,
    globalContext: settings.globalContext,
    globalContextRef,
    updateProject,
  });

  /**
   * Memoised so the identity changes only when the data does.
   *
   * This provider sits above every route and forty modules consume it, so an
   * inline object literal made all of them re-render whenever anything here
   * rendered — for any reason, including a change none of them read.
   *
   * The dependency list is every member, which is exactly what makes this
   * effective rather than decorative: all twenty-six functions are already
   * `useCallback`s with their own correct dependencies, and the six values are
   * state. Nothing in this object is created inline, so the memo actually holds
   * between renders instead of being recomputed every time.
   */
  const value = useMemo<AppContextType>(() => ({
    projects, settings, isLoading, addProject, getProject, ensureProjectArtifacts, updateProject, deleteProject, createArtifact,
    createArtifactVersion, updateArtifact, deleteArtifact, getArtifact, updateSettings, t, getGroupedArtifactsByView, updateProjectContext,
    applyConsistencySuggestion, toggleArtifactFavorite, findLatestArtifactByName, getArtifactVersions,
    restoreArtifactVersion, removeCorruptArtifacts, saveChatHistory, loadChatHistory, replaceChatHistory, rebuildArchitectureGraph,
    getArchitectureGraphFreshness, savePublicationPackages, persistenceStatus, persistenceMessage,
    logAgentAction, listAgentActions,
  }), [
    projects, settings, isLoading, addProject, getProject, ensureProjectArtifacts, updateProject, deleteProject, createArtifact,
    createArtifactVersion, updateArtifact, deleteArtifact, getArtifact, updateSettings, t, getGroupedArtifactsByView, updateProjectContext,
    applyConsistencySuggestion, toggleArtifactFavorite, findLatestArtifactByName, getArtifactVersions,
    restoreArtifactVersion, removeCorruptArtifacts, saveChatHistory, loadChatHistory, replaceChatHistory, rebuildArchitectureGraph,
    getArchitectureGraphFreshness, savePublicationPackages, persistenceStatus, persistenceMessage,
    logAgentAction, listAgentActions,
  ]);


  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useAppContext = (): AppContextType => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppContextProvider');
  }
  return context;
};

/**
 * Like {@link useAppContext} but returns `undefined` outside a provider
 * instead of throwing. For peripheral/optional consumers (e.g. an inspector
 * sub-panel) that must still render in isolation — keeps components testable
 * standalone and degrades gracefully.
 */
export const useOptionalAppContext = (): AppContextType | undefined =>
  useContext(AppContext);
