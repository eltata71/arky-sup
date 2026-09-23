/**
 * The persona composer screens hand to artifact generation (F5-01, corte 13).
 *
 * Generation declares the port (`ArtifactPersonaComposer`) and the Office
 * supplies it; a screen that generates an artifact meets the two here, so it
 * does not import a third service module to find out who speaks.
 */
import type { ArtifactPersonaComposer } from '../lib/artifacts';
import { composeArtifactPersonaInstruction } from '../services/architectureOffice';

export const useArtifactPersona = (): ArtifactPersonaComposer => composeArtifactPersonaInstruction;
