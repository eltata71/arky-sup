/**
 * El dominio de Artefactos: reglas y transformaciones puras, sin E/S (F6-03,
 * corte 4).
 *
 * La fábrica (identidad y versionado), el contrato de generación, el brief, los
 * compiladores de presentación, los fallbacks deterministas y la detección de
 * lo que es un fallback. `application/` orquesta —la generación, el
 * refinamiento con IA, el pipeline, la exportación— e `infrastructure/` escribe
 * en la base.
 *
 * La fábrica era la única regla que no era pura, por un solo import: recompilaba
 * con la función del compilador que registra en observabilidad. Ahora recibe el
 * compilador como puerto (`ArtifactCompilePort`), puro por defecto, y
 * `artifactWorkflow` —que persiste— le pasa el que registra.
 */
export * from './architectureGraphAlignment';
export * from './artifactBriefService';
export * from './artifactContextSelectionService';
export * from './artifactExportProfileService';
export * from './artifactFactory';
export * from './artifactFallbackDetection';
export * from './artifactGenerationContract';
export * from './artifactGenerationFlags';
export * from './artifactGenerationSupport';
export * from './artifactGenerationTrace';
export * from './artifactPresentationCompiler';
export * from './artifactPresentationFlags';
export * from './artifactPresentationQualityService';
export * from './artifactRecommendationService';
export * from './deterministicArtifactFallbacks';
export * from './deterministicHybridFallbacks';
export * from './deterministicMermaidLabels';
export * from './diagnostics';
export * from './diagramPresentationCompiler';
export * from './hybridPresentationCompiler';
export * from './markdownPresentationCompiler';
