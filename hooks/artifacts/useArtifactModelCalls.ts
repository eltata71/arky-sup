/**
 * The canvas's own model calls — test cases, a document from a diagram, and
 * improving with the suggestions — bound to the project, the settings and
 * the context ports (plan de calidad de artefactos, 7.3d).
 *
 * They reached the model with the project and nothing of what only other
 * contexts know: the initiative it serves, the deliverables it is produced
 * for, what the conversation settled. The ports are read when the call
 * starts, so a decision agreed in the chat a minute ago reaches it. The canvas
 * calls these; it does not compose them.
 */
import { useMemo } from 'react';
import type { Settings } from '../../types';
import type { Artifact } from '../../lib/artifacts';
import type { Project } from '../../services/architectureProjects';
import {
  draftDocumentFromDiagram,
  draftTestCases,
  improveWithSuggestions,
  type ArtifactSuggestionForImprovement,
} from '../../services/artifacts/application/artifactImprovement';
import { useArtifactContextPorts } from '../useArtifactContextPorts';

export function useArtifactModelCalls(project: Project, settings: Settings) {
  const loadContextPorts = useArtifactContextPorts(project);
  return useMemo(() => ({
    draftTestCases: async (artifact: Artifact) => draftTestCases(artifact, project, settings, await loadContextPorts()),
    draftDocumentFromDiagram: async (artifact: Artifact) =>
      draftDocumentFromDiagram(artifact, project, settings, await loadContextPorts()),
    improveWithSuggestions: async (artifact: Artifact, suggestions: readonly ArtifactSuggestionForImprovement[]) =>
      improveWithSuggestions(artifact, suggestions, project, settings, await loadContextPorts()),
  }), [project, settings, loadContextPorts]);
}
