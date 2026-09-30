/**
 * Everything a screen hands artifact generation that only other contexts know
 * (plan de calidad de artefactos, 7.3): why the project exists and what it
 * moves in its initiative, the deliverables it is produced for, and what the
 * conversation with the agent settled.
 *
 * It returns a loader, not a value: the conversation has to be read when a
 * generation starts, so a decision agreed in the chat a minute ago reaches it.
 * The other two are already in memory and cost nothing to hand over.
 */
import { useCallback } from 'react';
import type { ArtifactContextPorts } from '../lib/artifacts';
import type { Project } from '../services/architectureProjects';
import { useProjectBusinessMotivation } from './useProjectBusinessMotivation';
import { useProjectDeliverables } from './useProjectDeliverables';
import { useConversationDecisions } from './useConversationDecisions';

export const useArtifactContextPorts = (project: Project | undefined): (() => Promise<ArtifactContextPorts>) => {
  const businessMotivation = useProjectBusinessMotivation(project);
  const deliverables = useProjectDeliverables(project?.id);
  const loadConversation = useConversationDecisions();
  const projectId = project?.id;
  return useCallback(async () => ({
    ...(businessMotivation.length ? { businessMotivation } : {}),
    ...(deliverables.length ? { deliverables } : {}),
    ...(projectId ? { conversation: await loadConversation(projectId) } : {}),
  }), [businessMotivation, deliverables, loadConversation, projectId]);
};
