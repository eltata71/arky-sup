/**
 * What screens hand to artifact generation (F5-01, cortes 13 y 14).
 *
 * Generation declares two ports: who speaks (`ArtifactPersonaComposer`, which
 * the Office supplies) and what it cannot look up in the artifacts context
 * (`ArtifactGenerationSupport`, the controlled source selection and the
 * deterministic fallbacks). A screen meets both here, so it does not import a
 * third service module to generate an artifact.
 */
import { useMemo } from 'react';
import type { ArtifactBusinessMotivation, ArtifactPersonaComposer } from '../lib/artifacts';
import type { Project } from '../services/architectureProjects';
import type { ArtifactGenerationSupport } from '../services/ai';
import { composeArtifactPersonaInstruction } from '../services/architectureOffice';
import { artifactGenerationSupport } from '../services/artifacts';
import { useProjectBusinessMotivation } from './useProjectBusinessMotivation';

export const useArtifactPersona = (): ArtifactPersonaComposer => composeArtifactPersonaInstruction;

export interface ArtifactGenerationPorts {
  composePersonaInstruction: ArtifactPersonaComposer;
  support: ArtifactGenerationSupport;
  /** Why the project exists; absent when it answers no initiative. */
  businessMotivation?: readonly ArtifactBusinessMotivation[];
}

const GENERATION_PORTS: ArtifactGenerationPorts = {
  composePersonaInstruction: composeArtifactPersonaInstruction,
  support: artifactGenerationSupport,
};

/**
 * With the project, the ports also carry the business need it answers (plan de
 * diagramas, 6.5), so every screen that generates hands the model the same
 * "why". The result is stable while neither changes: callers put it in effect
 * dependencies.
 */
export const useArtifactGenerationPorts = (project?: Project): ArtifactGenerationPorts => {
  const businessMotivation = useProjectBusinessMotivation(project);
  return useMemo(
    () => (businessMotivation.length ? { ...GENERATION_PORTS, businessMotivation } : GENERATION_PORTS),
    [businessMotivation],
  );
};
