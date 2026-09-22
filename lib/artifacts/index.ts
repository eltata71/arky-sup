/**
 * Canonical artifact contracts entry point.
 *
 * Consumers should import from `@/lib/artifacts` rather than reaching into
 * `services/artifactGenerationPipeline.ts` directly. This keeps the public
 * shape stable while the underlying implementation evolves through phases
 * 2–4.
 */
export * from './artifactModel';
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
