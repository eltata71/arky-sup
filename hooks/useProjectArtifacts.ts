import { useEffect } from 'react';
import { useAppContext } from '../context/AppContext';

/**
 * Ensure a project's artifact documents are loaded before a screen shows them.
 *
 * The portfolio loads a compact index rather than every artifact body, so a
 * project reached from a list arrives with `artifactsLoaded: false` and an
 * empty `artifacts` array. Any screen that renders or edits artifact
 * *content* has to ask for the real thing first.
 *
 * Deliberately a hook rather than a call in the route wrapper: a page can be
 * mounted from more than one place, and a hydration that lives in one of those
 * places is a hydration that is missing from the others.
 *
 * Returns nothing. The project re-renders through `AppContext` when its
 * artifacts arrive; a caller that needs to know whether it is still waiting
 * reads `project.artifactsLoaded`.
 */
export function useProjectArtifacts(projectId: string | undefined): void {
  const { ensureProjectArtifacts } = useAppContext();

  useEffect(() => {
    if (!projectId) return;
    void ensureProjectArtifacts(projectId);
  }, [projectId, ensureProjectArtifacts]);
}
