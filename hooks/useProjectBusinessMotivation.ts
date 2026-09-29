/**
 * Why a project exists, as artifact generation needs to read it
 * (plan de diagramas, 6.2).
 *
 * Which initiatives a project answers is the portfolio's rule
 * (`useAttentionInitiatives`: ids first, codes only as migration); how an
 * initiative reads in a prompt is the initiative's (`describeInitiativeMotivation`).
 * This hook only joins them, so a screen that generates artifacts hands the
 * business need to the model without importing either context.
 */
import { useMemo } from 'react';
import type { ArtifactBusinessMotivation } from '../lib/artifacts';
import type { Project } from '../services/architectureProjects';
// The domain door: the barrel carries the Supabase adapter, which this never uses.
import { describeInitiativeMotivation } from '../services/businessInitiatives/domain';
import { useInitiatives } from '../context/InitiativeContext';
import { useAttentionInitiatives } from './useAttentionInitiatives';

const NO_INITIATIVES: never[] = [];
/** Stands in while a screen's project is still loading; it serves no initiative. */
const NO_PROJECT = { id: '', name: '', description: '', projectContext: [], artifacts: [], initiativeIds: [] } as unknown as Project;

export const useProjectBusinessMotivation = (project: Project | undefined): ArtifactBusinessMotivation[] => {
  const { initiatives } = useInitiatives();
  const served = useAttentionInitiatives(project ?? NO_PROJECT, project ? initiatives : NO_INITIATIVES);
  return useMemo(() => served.map(describeInitiativeMotivation), [served]);
};
