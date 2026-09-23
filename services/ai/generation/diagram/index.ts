/** The diagram vertical (F5-01, corte 6): what `diagramGenerationService` delegates to. */
export { buildDiagramGenerationConfig, diagramTemperature, THINKING_BUDGET } from './diagramGenerationConfig';
export type { DiagramConfigOptions } from './diagramGenerationConfig';
export { generateDiagramIR, generateDiagramIRWithSelfHealing } from './diagramIRGeneration';
export { generateAndRefineDiagramIR } from './diagramIRRefinement';
export { convertToExcalidrawJSON } from './excalidrawConversion';
export { parseMermaidToReactFlow } from './mermaidToReactFlow';
export { fixDiagramError } from './diagramRepair';
// The diagram prompt pieces the engine's own artifact generation still reads.
// Re-exported here so the engine enters diagram generation through one door
// instead of two (F5-01, corte 6); they stay defined in `prompts/`.
export { buildDialectInstruction, buildMermaidQualityReinforcement, DIAGRAM_SYSTEM_INSTRUCTION } from '../../prompts/diagramPrompts';
