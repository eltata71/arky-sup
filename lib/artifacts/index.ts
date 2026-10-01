/**
 * Canonical artifact contracts entry point.
 *
 * Consumers should import from `@/lib/artifacts` rather than reaching into
 * `services/artifactGenerationPipeline.ts` directly. This keeps the public
 * shape stable while the underlying implementation evolves through phases
 * 2–4.
 */
export * from './artifactModel';
export type { ContextManifest, ContextManifestCitation, ContextManifestRecord, ContextManifestSource } from './contextManifest';
export type { CitationExport, ContextCitationReference, ContextCitationReview, ContextCitationStatus } from './contextCitations';
export { decorateContextCitationsHtml, describeCitationReview, renderCitationsForExport, reviewContextCitations, stripContextCitations } from './contextCitations';
export { createContextManifestRecorder } from './contextManifest';
export { emitGenerationPhase } from './generationPhase';
export type { ArtifactBusinessMotivation, ArtifactContextPorts, ArtifactConversationDigest, ArtifactDeliverableContext, ArtifactGenerationOptions, ArtifactPersonaComposer } from './artifactPersona';
export * from './artifactCompilationSummary';
export * from './contracts';
export * from './exportContracts';
// Artifact classification and the presentation contract. Both were pure
// declaration files under `services/artifacts/`, which meant `services/export`
// had to import the artifacts module to know what a deck looks like while
// `services/artifacts` imported the export engine back. A contract with no
// behaviour belongs where everyone can reach it without depending on anyone.
export * from './artifactKind';
export * from './artifactPresentationModel';
export * from './artifactSuggestions';
export { buildDocumentIR } from './documentIR';
export * from './contentPreservation';
export { DOCUMENT_DISCIPLINES, disciplineForTemplate, type DocumentDiscipline, type DisciplineRule, type DisciplineSection } from './documentDisciplines';
export * from './documentPatch';
