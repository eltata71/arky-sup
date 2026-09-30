/**
 * The open deliverables of a project, as artifact generation reads them
 * (plan de calidad de artefactos, 7.3c).
 *
 * Which engagements are open and what each asks for is the Office's rule
 * (`openDeliverablesForArtifacts`); this hook only joins it with the
 * engagements the Office context already holds, so a screen that generates
 * hands the model the committee's request without importing the Office.
 */
import { useMemo } from 'react';
import type { ArtifactDeliverableContext } from '../lib/artifacts';
// The small door: the Office barrel carries its orchestration, which this never uses.
import { openDeliverablesForArtifacts } from '../services/architectureOffice/portfolio';
import { useOffice } from '../context/OfficeContext';

export const useProjectDeliverables = (projectId: string | undefined): ArtifactDeliverableContext[] => {
  const { engagements } = useOffice();
  return useMemo(
    () => (projectId ? openDeliverablesForArtifacts(projectId, engagements) : []),
    [projectId, engagements],
  );
};
