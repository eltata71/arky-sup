/**
 * Canonical artifact service surface.
 *
 * Components and hooks should import from `services/artifacts` rather than
 * the underlying single-purpose modules (`artifactGenerationPipeline.ts`,
 * `artifactValidationService.ts`, `export/*`). The barrel lets Phase 2+
 * swap implementations behind the scenes.
 */
export {
  buildArtifactViewModel,
  buildArtifactRenderState,
  deriveDiagramRenderStatus,
  deriveDocumentRenderStatus,
  getArtifactViewCapabilities,
  resolveSafeArtifactView,
} from './viewController';

export type {
  BuildArtifactRenderStateInput,
  DeriveDiagramRenderStateInput,
  DeriveDocumentRenderStateInput,
  ArtifactViewCapabilities,
} from './viewController';

export {
  buildArtifactDiagnosticReport,
  buildRenderDiagnosticsSummary,
} from './diagnostics';

export {
  performArtifactExport,
} from './exportFacade';

export type {
  PerformExportInput,
  PerformExportOutput,
} from './exportFacade';

export { artifactRepository, type ArtifactRepository } from './ArtifactRepository';

/**
 * The deterministic fallbacks: what the product renders when generation fails.
 * They used to live inside the AI engine and be published by the `services/ai`
 * barrel — a provider-agnostic API re-exporting the monolith. Nothing here
 * calls a model.
 */
export {
  buildDeterministicArtifactFallback,
  buildDeterministicDiagramSkeleton,
  isSkeletonFallbackContent,
  markMermaidAsSkeletonFallback,
} from './deterministicArtifactFallbacks';

/**
 * La puerta del agregado Artefacto: identidad, versionado y compilación.
 *
 * Estaba dentro de `context/app/useArtifactsState.ts`, mezclado con el estado
 * optimista y la escritura, así que la regla de versionado sólo se podía
 * comprobar renderizando React.
 */
export {
  createArtifact,
  createArtifactVersion,
  reviseArtifact,
  type ArtifactFactoryOptions,
  type NewArtifactDraft,
} from './artifactFactory';
