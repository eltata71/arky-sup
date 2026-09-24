/**
 * What artifact generation needs from the artifacts context (F5-01, corte 14).
 *
 * The generation engine used to reach into `services/artifacts` for three
 * things: the controlled selection of source artifacts a structured request
 * names, and the deterministic fallbacks that keep the canvas from ever
 * staying blank. `services/artifacts` imports this layer to *run* a generation,
 * so the engine could not live in `services/ai` while it looked those up —
 * the move would have traded the cycle against the root of `services/` for one
 * between two real contexts, which is why Ola 5 reverted it.
 *
 * So the layer that cannot look them up declares what it needs, and whoever
 * asks for a generation hands it over: the same port corte 13 cut for the
 * Office persona (`ArtifactPersonaComposer`) and corte 8 for the agent's.
 * `services/artifacts` supplies the one implementation,
 * `artifactGenerationSupport`.
 *
 * It is **required** on every call, not optional. A persona can be omitted —
 * the base instruction is still a correct prompt — but a generation without
 * its fallbacks would return an empty canvas where it used to return a
 * skeleton, and nobody would notice until a provider outage.
 */
import type { ArtifactGenerationOptions } from '../../../../lib/artifacts';
import type { ArtifactGenerationContract, ArtifactTemplate } from '../../../../types';
import type { Project } from '../../../architectureProjects';

/**
 * The controlled-context block for a structured request, already validated.
 * `ok: false` means the selection leaked an excluded source: the engine drops
 * the block and says so rather than sending it.
 */
export interface ControlledGenerationContext {
  promptBlock: string;
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface ArtifactGenerationSupport {
  /** Selects and validates the sources a generation contract names. */
  controlledContext(
    project: Project,
    contract: ArtifactGenerationContract,
    sourceSummaryChars: number,
  ): ControlledGenerationContext;
  /** A complete, renderable artifact written without a model. */
  deterministicArtifact(project: Project, template: ArtifactTemplate): string;
  /** A minimal diagram for the project, marked as a skeleton. */
  deterministicDiagramSkeleton(project: Project, template: ArtifactTemplate): string;
  /** Marks Mermaid the engine already has as a skeleton fallback. */
  markSkeleton(mermaid: string): string;
}

/** Options of a content generation: the shared ones plus the port. */
export interface ArtifactContentGenerationOptions extends ArtifactGenerationOptions {
  support: ArtifactGenerationSupport;
}
