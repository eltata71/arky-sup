/**
 * What screens hand to artifact generation (F5-01, cortes 13 y 14).
 *
 * Generation declares two ports: who speaks (`ArtifactPersonaComposer`, which
 * the Office supplies) and what it cannot look up in the artifacts context
 * (`ArtifactGenerationSupport`, the controlled source selection and the
 * deterministic fallbacks). A screen meets both here, so it does not import a
 * third service module to generate an artifact.
 */
import type { ArtifactPersonaComposer } from '../lib/artifacts';
import type { ArtifactGenerationSupport } from '../services/ai';
import { composeArtifactPersonaInstruction } from '../services/architectureOffice';
import { artifactGenerationSupport } from '../services/artifacts';

export const useArtifactPersona = (): ArtifactPersonaComposer => composeArtifactPersonaInstruction;

export interface ArtifactGenerationPorts {
  composePersonaInstruction: ArtifactPersonaComposer;
  support: ArtifactGenerationSupport;
}

const GENERATION_PORTS: ArtifactGenerationPorts = {
  composePersonaInstruction: composeArtifactPersonaInstruction,
  support: artifactGenerationSupport,
};

export const useArtifactGenerationPorts = (): ArtifactGenerationPorts => GENERATION_PORTS;
