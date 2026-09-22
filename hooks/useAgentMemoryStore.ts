/**
 * El adaptador entre los tres ámbitos de memoria del agente y `AppContext`.
 *
 * Estaba escrito **dos veces, línea por línea**: en `AssistantPanel` y en
 * `ProjectCopilotChatModal`. Un comentario en cada copia decía «la misma forma
 * que usa el otro, para que el flujo de memoria sea uniforme en las dos
 * superficies» — que es la descripción exacta de algo que debería existir una
 * sola vez. Dos copias idénticas se mantienen uniformes hasta que alguien toca
 * una.
 *
 * Es un hook y no un servicio porque lo que hace es cerrar sobre los
 * `updateProject`/`updateArtifact` del contexto de React: la *política* de
 * memoria —qué es una entrada, cómo se reconcilian textos y metadatos— vive en
 * `services/memory`; esto sólo la conecta con dónde se guarda.
 */

import { useMemo } from 'react';
import type { MemoryEntry, Settings } from '../types';
import type { Artifact } from '../lib/artifacts';
import type { Project } from '../services/architectureProjects';
import type { AgentMemoryStore } from '../services/agent';
import { reconcileMemoryEntries } from '../services/memory';

export interface AgentMemoryStorePorts {
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  getProject: (projectId: string) => Project | undefined;
  updateProject: (projectId: string, patch: Partial<Project>) => void;
  updateProjectContext: (projectId: string, next: string[]) => void;
  getArtifact: (projectId: string, artifactId: string) => Artifact | undefined;
  updateArtifact: (projectId: string, artifactId: string, patch: Partial<Artifact>) => void;
}

/** El almacén de memoria que consume la capa del agente. */
export function useAgentMemoryStore(ports: AgentMemoryStorePorts): AgentMemoryStore {
  const {
    settings, updateSettings, getProject, updateProject,
    updateProjectContext, getArtifact, updateArtifact,
  } = ports;

  return useMemo<AgentMemoryStore>(() => ({
    getGlobalContext: () => (Array.isArray(settings.globalContext) ? settings.globalContext : []),
    getGlobalContextEntries: () => reconcileMemoryEntries(settings.globalContext, settings.globalContextEntries),
    updateGlobalContext: (next: string[], nextEntries?: MemoryEntry[]) =>
      updateSettings(nextEntries
        ? { globalContext: next, globalContextEntries: nextEntries }
        : { globalContext: next }),

    getProjectContext: (projectId: string) => {
      const project = getProject(projectId);
      return Array.isArray(project?.projectContext) ? project.projectContext : [];
    },
    getProjectContextEntries: (projectId: string) => {
      const project = getProject(projectId);
      return reconcileMemoryEntries(project?.projectContext, project?.projectContextEntries);
    },
    updateProjectContext: (projectId: string, next: string[], nextEntries?: MemoryEntry[]) => {
      if (nextEntries) updateProject(projectId, { projectContext: next, projectContextEntries: nextEntries });
      else updateProjectContext(projectId, next);
    },

    getArtifactMemory: (projectId: string, artifactId: string) => {
      const artifact = getArtifact(projectId, artifactId);
      return Array.isArray(artifact?.artifactMemory) ? artifact.artifactMemory : [];
    },
    getArtifactMemoryEntries: (projectId: string, artifactId: string) => {
      const artifact = getArtifact(projectId, artifactId);
      return reconcileMemoryEntries(artifact?.artifactMemory, artifact?.artifactMemoryEntries);
    },
    updateArtifactMemory: (projectId: string, artifactId: string, next: string[], nextEntries?: MemoryEntry[]) => {
      updateArtifact(projectId, artifactId, nextEntries
        ? { artifactMemory: next, artifactMemoryEntries: nextEntries }
        : { artifactMemory: next });
    },
  }), [
    settings.globalContext, settings.globalContextEntries, updateSettings,
    getProject, updateProject, updateProjectContext, getArtifact, updateArtifact,
  ]);
}

/**
 * El almacén del bucle de aprendizaje: deja que el agente escriba lecciones
 * deterministas en la memoria del proyecto después de cada acción ejecutada.
 * También estaba duplicado.
 */
export function useAgentLessonStore(ports: Pick<AgentMemoryStorePorts, 'getProject' | 'updateProject'>) {
  const { getProject, updateProject } = ports;
  return useMemo(() => ({
    getProjectAgentMemory: (projectId: string) => {
      const project = getProject(projectId);
      return {
        texts: Array.isArray(project?.agentMemory) ? project.agentMemory : [],
        entries: reconcileMemoryEntries(project?.agentMemory, project?.agentMemoryEntries),
      };
    },
    updateProjectAgentMemory: (projectId: string, texts: string[], entries: MemoryEntry[]) => {
      updateProject(projectId, { agentMemory: texts, agentMemoryEntries: entries });
    },
  }), [getProject, updateProject]);
}
