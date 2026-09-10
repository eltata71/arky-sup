/**
 * The diagram vocabulary — `DiagramIR` and the words around it.
 *
 * It lives in `lib` rather than in `services/diagram` because it is consumed
 * from both sides of the layer boundary: `lib/diagramTokens.ts`,
 * `lib/layoutEngine.ts`, `lib/semanticRoleResolver.ts` and
 * `lib/diagramThemes.ts` all operate on the IR, and `foundation` may not
 * import `domain`. A contract with no behaviour belongs where everyone can
 * reach it — the same reasoning that moved `ExportFormat` and `ArtifactKind`
 * into `lib/artifacts/`.
 */
export * from './DiagramIRTypes';
export * from './storyPlan';
export * from './semanticPatch';
