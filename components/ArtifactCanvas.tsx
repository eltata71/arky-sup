import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { Artifact } from '../lib/artifacts';
import { type Project, useAppContext } from '../context/AppContext';
import type { ArtifactReviewSuggestion } from '../services/review';
import type { DiagramAudience, DiagramIR } from '../lib/diagram';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { artifactGenerationService, documentGenerationService } from '../services/ai';
import type { ReactFlowCanvasHandle } from './ReactFlowCanvas';
import ExecutiveOnePager from './ExecutiveOnePager';
import { printDocumentHtml } from '../lib/printDocument';
import { MarkdownToolbar } from './MarkdownToolbar';
import { Drawer } from './ui/Drawer';
import { ArtifactInspectorPanel } from './artifacts/ArtifactInspectorPanel';
import { motion, AnimatePresence } from 'motion/react';
import { ExportErrorBoundary, PresentationErrorBoundary } from './diagram/CanvasErrorBoundaries';
import { ConfirmDialog } from './ConfirmDialog';
import { observabilityService } from '../services/observability';
import type { NodeRect, GroupRect, ViewportRect, FloatingObstacleRect, EdgeSegment } from '../services/diagram/layoutQualityService';
import { useRegisterCommands } from '../context/CommandPaletteContext';
import { irToMermaid } from '../services/diagram/irToMermaid';
import { runDiagramQualityGate } from '../services/diagram/qualityGate';
import { buildGenerationObservabilityAlert } from './artifactCanvasObservability';
import {
  ArtifactExportModal,
  DiagramQualityPanel,
  ArtifactQualityPanel,
  GenerationTracePanel,
  DocumentView,
  DiagramView,
  MarkdownView,
  ExcalidrawArtifactView,
  LucidchartArtifactView,
  FableArtifactView,
  ArtifactTopToolbar,
  ArtifactBottomToolbar,
  ArtifactSuggestionsPanel,
  ArtifactPresentationView,
  SlideViewer,
  LoadingOverlay,
  initMermaidTheme,
} from './artifacts';
import { isPresentationArtifactType } from '../lib/artifacts/artifactKind';
import { useArtifactSuggestions } from '../hooks/artifacts/useArtifactSuggestions';
import type { ArtifactSuggestionGapType } from '../services/ai/artifactSuggestionService';
import {
  assessHardBlockContext,
  assessVisualGate,
  enrichSuggestions,
} from '../services/artifacts/application/artifactAssessment';
import { useArtifactViewMode } from '../hooks/artifacts/useArtifactViewMode';
import { useGenerationDiagnostic } from '../hooks/artifacts/useGenerationDiagnostic';
import { useDocumentRendering } from '../hooks/artifacts/useDocumentRendering';
import { useDocumentPresentation } from '../hooks/artifacts/useDocumentPresentation';
import { useDiagramRendering } from '../hooks/artifacts/useDiagramRendering';
import { useExcalidrawRendering } from '../hooks/artifacts/useExcalidrawRendering';
import { useArtifactExportActions } from '../hooks/artifacts/useArtifactExportActions';
import { useArtifactEditing } from '../hooks/artifacts/useArtifactEditing';
import { useArtifactFullscreen } from '../hooks/artifacts/useArtifactFullscreen';
import { useArtifactSpeech } from '../hooks/artifacts/useArtifactSpeech';
import { useCanvasStorytellingCommands } from '../hooks/artifacts/useCanvasStorytellingCommands';
import { useSuggestionActionRunner } from '../hooks/artifacts/useSuggestionActionRunner';
import type { ArtifactViewMode } from '../lib/artifacts/contracts';
import { useArtifactAssessment } from '../hooks/artifacts/useArtifactAssessment';

/** Replaces (or appends) the fenced ```mermaid``` block inside `content`. */
const replaceMermaidBlock = (content: string, mermaid: string): string => {
  const fenced = /```mermaid\s*[\s\S]*?```/m;
  if (fenced.test(content)) return content.replace(fenced, `\`\`\`mermaid\n${mermaid}\n\`\`\``);
  return mermaid;
};

/** Maps a suggestion gap type onto the review-suggestion category vocabulary. */
const GAP_TO_REVIEW_CATEGORY: Record<ArtifactSuggestionGapType, ArtifactReviewSuggestion['category']> = {
  security: 'Security',
  data: 'Scalability',
  integration: 'Best Practices',
  technical: 'Best Practices',
  architecture: 'Best Practices',
  business: 'Clarity',
  'ux-ui': 'Clarity',
  documentation: 'Clarity',
  diagram: 'Clarity',
  traceability: 'Clarity',
};

const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isMobile;
};

export interface ArtifactCanvasProps {
  project: Project;
  artifact: Artifact;
  onGenerateWorldClass: (artifact: Artifact) => void;
  setActiveArtifactId: (id: string | null) => void;
  onBack: () => void;
}

/**
 * ArtifactCanvas — lightweight orchestrator.
 *
 * Selects the active artifact, coordinates the active view, and mounts the
 * decoupled view components (`DocumentView`, `DiagramView`, `MarkdownView`,
 * `ExcalidrawArtifactView`, `LucidchartArtifactView`) plus the floating
 * `ArtifactToolbar`. All heavy rendering, parsing and AI-action logic lives
 * in the `hooks/artifacts/*` hooks and the `components/artifacts/*` modules.
 */
export const ArtifactCanvas: React.FC<ArtifactCanvasProps> = ({
  project,
  artifact,
  setActiveArtifactId,
  onBack,
  onGenerateWorldClass,
}) => {
  const { restoreArtifactVersion, settings, createArtifact, updateArtifact, getArtifact } = useAppContext();
  const { addToast } = useToast();
  const { profile } = useAuth();
  const isMobile = useIsMobile();

  // ─── Local UI state ──────────────────────────────────────────────────────
  const [showInspector, setShowInspector] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showMarkdownSource, setShowMarkdownSource] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [showQualityPanel, setShowQualityPanel] = useState(false);
  // Brecha 3: confirmation pending before the cinematic presentation starts
  // when the Visual Quality Gate is blocked or carries warnings.
  const [presentationConfirm, setPresentationConfirm] = useState<{ open: boolean; message: string }>({ open: false, message: '' });
  const [showGenerationTracePanel, setShowGenerationTracePanel] = useState(false);
  const [showOnePager, setShowOnePager] = useState(false);
  // Technical surfaces stay hidden until the user opens them.
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [isGeneratingTests, setIsGeneratingTests] = useState(false);
  const [isConvertingToDoc, setIsConvertingToDoc] = useState(false);
  const [isAutoImprovingDiagram, setIsAutoImprovingDiagram] = useState(false);
  const [isApplyingSuggestions, setIsApplyingSuggestions] = useState(false);
  const [audience, setAudience] = useState<DiagramAudience>(artifact.audience ?? 'technical');

  const reactFlowRef = useRef<ReactFlowCanvasHandle>(null);
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const inspectorAuthor = useMemo(
    () => ({
      id: profile?.uid ?? 'local-user',
      name: profile?.displayName ?? 'Arquitecto',
    }),
    [profile?.uid, profile?.displayName],
  );

  // ─── Extracted hooks ─────────────────────────────────────────────────────
  const editing = useArtifactEditing(artifact);
  const { isFullscreen, toggleFullscreen } = useArtifactFullscreen();
  const speech = useArtifactSpeech();
  const presentation = useDocumentPresentation();
  const { markdownHtml, mermaidCode, toc: documentToc } = useDocumentRendering(artifact);

  const { viewMode, setViewMode, setSafeViewMode, capabilities } = useArtifactViewMode(artifact, {
    isNarrowViewport: isMobile,
  });

  useEffect(() => {
    setAudience(artifact.audience ?? 'technical');
  }, [artifact.id, artifact.audience]);

  const handleAudienceChange = useCallback((next: DiagramAudience) => {
    setAudience(next);
    updateArtifact(project.id, artifact.id, { audience: next });
  }, [project.id, artifact.id, updateArtifact]);

  const diagram = useDiagramRendering({
    artifact,
    project,
    settings,
    viewMode,
    audience,
    mermaidCode,
    updateArtifact,
    // Recomendación 5: pass the AppContext reader so applyLayoutOverride
    // can rebase the patch on the latest IR, guarding against concurrent
    // mutations between user click and dispatch.
    getArtifact,
    setViewMode,
    onContentFixed: editing.setEditedContent,
  });
  const { renderable } = diagram;

  /**
   * Recomendación 4: single source of truth for the displayed content node
   * count. Every Visual Gate guard (presentation start, export modal,
   * hard-block context) used to compute this independently. Centralising
   * here keeps the threshold logic consistent and makes adding new
   * guarded actions trivial.
   */
  const currentContentNodeCount = React.useMemo(
    () => diagram.displayFlowNodes.filter((n) => n.type !== 'groupZone').length,
    [diagram.displayFlowNodes],
  );

  const excalidraw = useExcalidrawRendering({
    artifact,
    settings,
    viewMode,
    mermaidCode,
    setViewMode,
  });

  // Gap 4: capture the layout snapshot emitted by the canvas so quality
  // and preflight can lint against real positions. `null` until the canvas
  // commits a layout; quality falls back to IR-only lints in the meantime.
  //
  // Gap-extension: also capture viewport, floating obstacles and edge
  // segments so off-screen-node, panel-occlusion and edge-through-node
  // checks fire on real positions instead of approximations.
  const [layoutSnapshot, setLayoutSnapshot] = React.useState<{
    nodeRects: NodeRect[];
    groupRects: GroupRect[];
    boundingBox: { x: number; y: number; width: number; height: number };
    viewport?: ViewportRect;
    floatingObstacles?: FloatingObstacleRect[];
    edgeSegments?: EdgeSegment[];
    smartViewport?: {
      readable: boolean;
      showExploreHint: boolean;
      showViewAllSecondary: boolean;
      reason?: 'ok' | 'zoom-too-low' | 'node-too-small' | 'label-too-small';
    };
    canvasState?: {
      visibleViewport: { minX: number; minY: number; maxX: number; maxY: number };
      contentBounds: { minX: number; minY: number; maxX: number; maxY: number };
      logicalCanvasBounds: { minX: number; minY: number; maxX: number; maxY: number };
      safeInteractionBounds: { minX: number; minY: number; maxX: number; maxY: number };
      exportBounds: { minX: number; minY: number; maxX: number; maxY: number };
    };
    layoutPlan?: {
      backend: 'dagre' | 'elk';
      algorithm?: string;
      direction?: 'TB' | 'LR' | 'BT' | 'RL';
      density?: 'compact' | 'normal' | 'spacious';
      orthogonal?: boolean;
      rationale?: string;
      computedAt?: string;
    } | null;
  } | null>(null);
  const assessment = useArtifactAssessment({
    artifact,
    project,
    settings,
    audience,
    viewMode,
    renderable,
    layoutSnapshot,
  });
  const {
    qualityReport,
    preflightReport,
    presentationModel,
    activeExportView,
    exportFormatOptions,
    artifactQualitySnapshot,
    presentationCompileResult,
  } = assessment;

  /**
   * Recomendación 4 + 6: contexto de bloqueo duro y tono de la puerta,
   * compartidos por toda acción con guarda (presentación, modal de
   * exportación, indicador de la barra). Centralizarlo evita que los sitios de
   * llamada se separen cuando cambian los umbrales.
   */
  const visualGateState = qualityReport?.visualGate?.state;
  const visualGateHardBlockContext = React.useMemo(
    () => assessHardBlockContext(qualityReport?.visualGate, { contentNodeCount: currentContentNodeCount }),
    [qualityReport?.visualGate, currentContentNodeCount],
  );
  const presentationGateTone = assessVisualGate(
    visualGateState, 'presentation', visualGateHardBlockContext,
  ).tone;

  const hasDisplayFlowNodes = diagram.displayFlowNodes.length > 0;

  const diagnostic = useGenerationDiagnostic({
    projectId: project.id,
    projectName: project.name,
    artifact,
    audience,
    renderable,
  });

  const generationObservabilityAlert = useMemo(() => buildGenerationObservabilityAlert({
    traceStatus: artifact.generationTrace?.status,
    traceErrorCount: artifact.generationTrace?.errors.length ?? 0,
    renderStatus: renderable.status,
    hasDisplayFlowNodes,
    hasVisibleFallbackContent: artifact.content.trim().length > 0 || markdownHtml.trim().length > 0,
    activeViewMode: viewMode,
    renderDiagnosticsSummary: diagnostic.renderDiagnosticsSummary,
    lastDiagramErrorReason: artifact.lastDiagramError?.reason,
  }), [artifact.generationTrace?.status, artifact.generationTrace?.errors.length, artifact.lastDiagramError?.reason, renderable.status, hasDisplayFlowNodes, artifact.content, markdownHtml, viewMode, diagnostic.renderDiagnosticsSummary]);

  // Observability/traceability surfaces stay closed by default — the
  // generation alert only tints the Observabilidad menu so the user can
  // open the trace panel on demand instead of having it pop over the canvas.

  // Los artefactos de tipo presentación usan el visor de diapositivas en vez
  // del renderizador de documento. Se detecta por `artifact.type` para que un
  // artefacto anterior a la migración también elija el visor correcto.
  const isPresentationArtifact = isPresentationArtifactType(artifact.type);

  const exportActions = useArtifactExportActions({
    artifact,
    activeView: activeExportView,
    settings,
    preflightReport,
    reactFlowRef,
    addToast,
    presentationModel,
  });

  // ─── Suggestions ("Sugerencias") ─────────────────────────────────────────
  // El contexto que se le manda al modelo lo compone la capa de aplicación:
  // qué parte del informe de calidad viaja con la pregunta es una decisión de
  // producto, no de renderizado.
  const { buildSuggestionContext } = assessment;

  const suggestions = useArtifactSuggestions({
    artifactId: artifact.id,
    settings,
    buildContext: buildSuggestionContext,
  });
  const suggestionCount = suggestions.report?.suggestions.length ?? 0;

  // Gap 13: enrich the AI-emitted suggestions with deterministic executable
  // actions so the panel always offers concrete buttons (apply ELK, change
  // density, regenerate IR-direct, …). The handler that dispatches each
  // action is defined further down — after `handleAutoImproveDiagram` and
  // `handleApplyWithAI` exist — and is referenced from the panel below.
  const enrichedSuggestionReport = useMemo(() => {
    if (!suggestions.report) return null;
    if (!renderable.ir) return suggestions.report;
    return enrichSuggestions({
      report: suggestions.report,
      ir: renderable.ir,
      quality: qualityReport,
      density: diagram.layoutPlan?.density ?? 'normal',
    });
  }, [suggestions.report, renderable.ir, qualityReport, diagram.layoutPlan]);

  // ─── Storytelling commands (Cmd+K palette) ───────────────────────────────
  const openExecutiveBrief = useCallback(() => { setShowOnePager(true); }, []);
  const canvasCommands = useCanvasStorytellingCommands({
    representation: artifact.representation,
    hasIR: Boolean(renderable.ir),
    reactFlowRef,
    onOpenBrief: openExecutiveBrief,
    onAudienceChange: handleAudienceChange,
  });
  useRegisterCommands(canvasCommands);

  // Initialize Mermaid theme based on the current theme.
  useEffect(() => {
    const isDark = document.documentElement.classList.contains('dark');
    initMermaidTheme(isDark);
  }, [settings.theme]);

  // ─── Orchestration handlers ──────────────────────────────────────────────
  const handleSave = useCallback(() => {
    const newVersion = restoreArtifactVersion(project.id, { ...artifact, content: editing.editedContent });
    setActiveArtifactId(newVersion.id);
    editing.exitEditMode();
  }, [restoreArtifactVersion, project.id, artifact, editing, setActiveArtifactId]);

  const handleSaveDiagram = useCallback(() => {
    if (!reactFlowRef.current) return;
    const flowData = reactFlowRef.current.getFlowData();
    const jsonContent = JSON.stringify(flowData, null, 2);

    let newContent = jsonContent;
    let newType = artifact.type;
    let newRepresentation = artifact.representation;

    if (artifact.representation === 'hybrid') {
      const matchMermaid = artifact.content.match(/```mermaid\s*([\s\S]*?)\s*```/);
      const matchJson = artifact.content.match(/```json\s*([\s\S]*?)\s*```/);
      if (matchMermaid) {
        newContent = artifact.content.replace(matchMermaid[0], `\`\`\`json\n${jsonContent}\n\`\`\``);
      } else if (matchJson) {
        newContent = artifact.content.replace(matchJson[0], `\`\`\`json\n${jsonContent}\n\`\`\``);
      } else {
        newContent = `${artifact.content}\n\n\`\`\`json\n${jsonContent}\n\`\`\``;
      }
    } else {
      newType = 'react-flow-graph';
      newRepresentation = 'diagram';
    }

    const newVersion = restoreArtifactVersion(project.id, {
      ...artifact,
      content: newContent,
      type: newType,
      representation: newRepresentation,
    });
    setActiveArtifactId(newVersion.id);
    addToast('Diagrama guardado como nueva versión.', 'success');
  }, [artifact, project.id, restoreArtifactVersion, setActiveArtifactId, addToast]);

  /**
   * Run the deterministic quality gate over the current IR and persist the
   * result — the "Auto-mejorar diagrama" entry point (pure TS, no LLM call).
   */
  const handleAutoImproveDiagram = useCallback(() => {
    if (!renderable.ir || isAutoImprovingDiagram) return;
    setIsAutoImprovingDiagram(true);
    try {
      const beforeScore = qualityReport?.score ?? 0;
      const gate = runDiagramQualityGate(renderable.ir, {
        artifact: {
          name: artifact.name,
          type: artifact.type,
          objective: artifact.objective,
          audience: artifact.audience,
          theme: artifact.theme,
        },
        audience,
        targetScore: 90,
        maxPasses: 4,
        aggressive: true,
      });

      const improvedIR = {
        ...gate.ir,
        metadata: {
          ...(gate.ir.metadata ?? {}),
          qualityReview: {
            score: gate.quality.score,
            issues: gate.quality.issues.map((issue) => ({
              severity: issue.severity,
              message: issue.message,
              recommendation: issue.recommendation,
            })),
          },
        },
      };

      const patch: Partial<Artifact> = { ir: improvedIR };
      const isC4 = artifact.type.startsWith('mermaid-c4-');
      if (!isC4) {
        try {
          const code = irToMermaid(improvedIR);
          if (artifact.type === 'hybrid-text-diagram') {
            patch.content = replaceMermaidBlock(artifact.content, code);
          } else if (artifact.type.startsWith('mermaid') && artifact.representation === 'diagram') {
            patch.content = code;
          }
        } catch (err) {
          console.warn('[ArtifactCanvas] auto-improve failed to serialize Mermaid', err);
        }
      }

      if (gate.changes.length === 0 && gate.quality.score <= beforeScore) {
        addToast('Auto-mejora ejecutada: no se detectaron reparaciones determinísticas adicionales. Usa Generación de clase mundial para una nueva versión con IA.', 'warning');
        return;
      }

      updateArtifact(project.id, artifact.id, patch);
      setShowQualityPanel(true);
      const tone = gate.reachedTarget ? 'success' : 'warning';
      addToast(`Auto-mejora aplicada: score ${beforeScore}/100 → ${gate.quality.score}/100 · ${gate.changes.length} cambio(s).`, tone);
    } finally {
      setIsAutoImprovingDiagram(false);
    }
  }, [renderable.ir, isAutoImprovingDiagram, qualityReport?.score, artifact, audience, project.id, updateArtifact, addToast]);

  const handleGenerateTests = useCallback(async () => {
    if (isGeneratingTests) return;
    setIsGeneratingTests(true);
    try {
      const testContent = await artifactGenerationService.generateTestCases(artifact, project, settings);
      const newArtifact = createArtifact(project.id, {
        name: `Casos de Prueba: ${artifact.name}`,
        type: 'markdown',
        phase: 'Validación y Pruebas',
        architecturalView: 'Vista de Calidad y Validación',
        content: testContent,
        objective: `Casos de prueba automatizados para validar el artefacto ${artifact.name}.`,
        keyConcepts: artifact.keyConcepts,
        representation: 'document',
        isFavorite: false,
      });
      if (isMounted.current) setActiveArtifactId(newArtifact.id);
    } catch (error) {
      console.error('Error generating test cases:', error);
      addToast('No se pudieron generar los casos de prueba. Reintenta o revisa la traza de generación.', 'error');
    } finally {
      if (isMounted.current) setIsGeneratingTests(false);
    }
  }, [isGeneratingTests, artifact, project, settings, createArtifact, setActiveArtifactId, addToast]);

  const handleConvertToDoc = useCallback(async () => {
    if (isConvertingToDoc) return;
    setIsConvertingToDoc(true);
    try {
      const docContent = await documentGenerationService.convertDiagramToDocument(artifact, project, settings);
      const newArtifact = createArtifact(project.id, {
        name: `Documento: ${artifact.name}`,
        type: 'markdown',
        phase: artifact.phase,
        architecturalView: artifact.architecturalView,
        content: docContent,
        objective: `Descripción en documento del diagrama ${artifact.name}.`,
        keyConcepts: artifact.keyConcepts,
        representation: 'document',
        isFavorite: false,
      });
      if (isMounted.current) setActiveArtifactId(newArtifact.id);
    } catch (error) {
      console.error('Error converting to document:', error);
      addToast('No se pudo convertir el diagrama a documento. Revisa la traza de generación o reintenta.', 'error');
    } finally {
      if (isMounted.current) setIsConvertingToDoc(false);
    }
  }, [isConvertingToDoc, artifact, project, settings, createArtifact, setActiveArtifactId, addToast]);

  /** Opens the Sugerencias panel and triggers the analysis on first open. */
  const handleOpenSuggestions = useCallback(() => {
    setShowSuggestions(true);
    if (suggestions.status === 'idle') suggestions.request();
  }, [suggestions]);

  /**
   * "Mejorar con IA" — rewrites the artifact applying the loaded suggestions
   * and persists the result as a new version (the current version is kept).
   */
  const handleApplyWithAI = useCallback(async () => {
    const list = suggestions.report?.suggestions ?? [];
    if (list.length === 0 || isApplyingSuggestions) return;
    setIsApplyingSuggestions(true);
    try {
      const reviewSuggestions: ArtifactReviewSuggestion[] = list.map((item) => ({
        id: item.id,
        title: item.title,
        description: `${item.description} Acción recomendada: ${item.recommendedAction}`,
        category: GAP_TO_REVIEW_CATEGORY[item.gapType],
      }));
      const newContent = await artifactGenerationService.applyArtifactImprovements(
        artifact,
        reviewSuggestions,
        project,
        settings,
      );
      if (!isMounted.current) return;
      const trimmed = (newContent ?? '').trim();
      if (!trimmed || trimmed === artifact.content.trim()) {
        addToast('La IA no propuso cambios aplicables. Revisa las sugerencias manualmente.', 'warning');
        return;
      }
      const newVersion = restoreArtifactVersion(project.id, { ...artifact, content: newContent });
      setActiveArtifactId(newVersion.id);
      setShowSuggestions(false);
      addToast('Mejoras aplicadas con IA como nueva versión.', 'success');
    } catch (error) {
      console.error('Error applying AI improvements:', error);
      addToast('No se pudieron aplicar las mejoras con IA. Reintenta más tarde.', 'error');
    } finally {
      if (isMounted.current) setIsApplyingSuggestions(false);
    }
  }, [suggestions.report, isApplyingSuggestions, artifact, project, settings, restoreArtifactVersion, setActiveArtifactId, addToast]);

  // Gap 13 / Gap 3: the Sugerencias panel's action dispatcher lives in
  // `useSuggestionActionRunner`, which mutates the IR deterministically and
  // persists it, falling through to an existing user flow when it cannot.
  const persistDiagramIR = useCallback(
    (ir: DiagramIR) => { updateArtifact(project.id, artifact.id, { ir }); },
    [updateArtifact, project.id, artifact.id],
  );
  const handleRunSuggestionAction = useSuggestionActionRunner({
    ir: renderable.ir ?? null,
    addToast,
    persistIR: persistDiagramIR,
    retryDiagram: diagram.retryDiagram,
    autoImproveDiagram: handleAutoImproveDiagram,
    applyWithAI: handleApplyWithAI,
    changeAudience: handleAudienceChange,
  });

  const isDiagramSurface = viewMode === 'diagram' || viewMode === 'split';
  const traceErrors = artifact.generationTrace?.errors.length ?? 0;

  return (
    <div className="flex flex-col h-full w-full relative bg-white dark:bg-gray-950 min-h-0">
      <ArtifactTopToolbar
        projectName={project.name}
        artifact={artifact}
        viewMode={viewMode}
        availableViews={capabilities.availableViews as ArtifactViewMode[]}
        onBack={onBack}
        onSelectView={setSafeViewMode}
        onOpenSuggestions={handleOpenSuggestions}
        onOpenInspector={() => setShowInspector(true)}
        onOpenExport={() => setIsExportModalOpen(true)}
      />

      <Drawer
        isOpen={showInspector}
        onClose={() => setShowInspector(false)}
        title="Inspector del artefacto"
        description={artifact.name}
        side="right"
        size="md"
      >
        <ArtifactInspectorPanel
          artifact={artifact}
          projectId={project.id}
          author={inspectorAuthor}
          onReviewStatusChange={(status) => {
            updateArtifact(project.id, artifact.id, { reviewStatus: status });
          }}
        />
      </Drawer>

      <ArtifactSuggestionsPanel
        isOpen={showSuggestions}
        onClose={() => setShowSuggestions(false)}
        artifactName={artifact.name}
        status={suggestions.status}
        report={enrichedSuggestionReport}
        error={suggestions.error}
        onAnalyze={suggestions.request}
        onApplyWithAI={() => { void handleApplyWithAI(); }}
        canApplyWithAI={suggestions.status === 'success' && suggestionCount > 0}
        isApplyingWithAI={isApplyingSuggestions}
        onAutoImprove={handleAutoImproveDiagram}
        canAutoImprove={isDiagramSurface && !!renderable.ir}
        isAutoImproving={isAutoImprovingDiagram}
        onGenerateWorldClass={() => onGenerateWorldClass(artifact)}
        onRunAction={handleRunSuggestionAction}
      />

      <ArtifactBottomToolbar
        representation={artifact.representation}
        viewMode={viewMode}
        availableViews={capabilities.availableViews as ArtifactViewMode[]}
        isDiagramSurface={isDiagramSurface}
        hasIR={artifact.representation !== 'document' && !!renderable.ir}
        onZoomIn={() => reactFlowRef.current?.zoomIn()}
        onZoomOut={() => reactFlowRef.current?.zoomOut()}
        onFitView={() => reactFlowRef.current?.fitToScreen()}
        onCenter={() => reactFlowRef.current?.centerGraph()}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        showMiniMap={showMiniMap}
        onToggleMiniMap={() => setShowMiniMap((v) => !v)}
        onStartPresentation={() => {
          // Brecha 4 + Recomendaciones 4/6/7: use the memoised hard-block
          // context so this path stays in sync with the export modal, and
          // report hard-blocks to observability so we can audit how often
          // the gate is saving us from a bad deliverable.
          const { guard } = assessVisualGate(visualGateState, 'presentation', visualGateHardBlockContext);
          if (guard.hardBlock) {
            observabilityService.trackEvent({
              severity: 'warning',
              source: 'user-action',
              status: 'observed',
              title: 'Visual Gate hard-block: presentación',
              message: guard.message,
              recoverable: true,
              userVisible: true,
              operationName: 'presentation.start',
              metadata: {
                hardBlockCode: guard.hardBlockCode,
                visualGateState: visualGateState ?? 'undefined',
                artifactType: artifact.type,
                contentNodeCount: currentContentNodeCount,
              },
            });
            addToast(guard.message, 'error');
            return;
          }
          if (guard.requireConfirmation) {
            setPresentationConfirm({ open: true, message: guard.message });
            return;
          }
          reactFlowRef.current?.startPresentation();
        }}
        presentationGateTone={presentationGateTone}
        onOpenOnePager={() => setShowOnePager(true)}
        audience={audience}
        onChangeAudience={handleAudienceChange}
        isEditMode={editing.isEditMode}
        onToggleEdit={editing.toggleEditMode}
        onSaveDiagram={handleSaveDiagram}
        onConvertToDoc={handleConvertToDoc}
        onGenerateTests={handleGenerateTests}
        isSpeaking={speech.isSpeaking}
        onToggleSpeech={speech.toggleSpeech}
        showQualityPanel={showQualityPanel}
        onToggleQualityPanel={() => setShowQualityPanel((v) => !v)}
        qualityScore={qualityReport?.score}
        hasQualityReport={!!qualityReport}
        onAutoImprove={handleAutoImproveDiagram}
        isAutoImproving={isAutoImprovingDiagram}
        onGenerateWorldClass={() => onGenerateWorldClass(artifact)}
        onOpenSuggestions={handleOpenSuggestions}
        showTracePanel={showGenerationTracePanel}
        onToggleTracePanel={() => setShowGenerationTracePanel((v) => !v)}
        traceErrors={traceErrors}
        hasObservabilityAlert={!!generationObservabilityAlert}
        diagnosticCopied={diagnostic.diagnosticCopied}
        hasDiagnosticReport={!!diagnostic.diagnosticReport}
        onCopyDiagnosticReport={diagnostic.copyDiagnosticReport}
        onSelectView={setSafeViewMode}
      />

      <DiagramQualityPanel
        open={showQualityPanel && isDiagramSurface}
        qualityReport={qualityReport}
        isAutoImproving={isAutoImprovingDiagram}
        onClose={() => setShowQualityPanel(false)}
        onAutoImprove={handleAutoImproveDiagram}
        onGenerateWorldClass={() => onGenerateWorldClass(artifact)}
        onApplyIssueFix={diagram.applyIssueFix}
        onApplyAutoAction={(actionCode) => {
          // Brecha 4 + Recomendación 3: bind the gate's automatic actions to
          // concrete handlers. Focus-primary toggles the canvas mode; the
          // RETRY_LAYOUT_* family writes a user override on the IR's
          // layoutPlan and re-resolves; canvas/pan actions run the smart
          // fit; everything else falls back to an informational toast.
          if (actionCode === 'APPLY_FOCUS_PRIMARY_FIT' || actionCode === 'AUTO_PAN_FROM_OBSTACLE') {
            reactFlowRef.current?.toggleFocusPrimary();
            addToast('Modo foco principal aplicado', 'success');
            return;
          }
          if (actionCode === 'EXPAND_LOGICAL_CANVAS_BOUNDS') {
            reactFlowRef.current?.fitToScreen();
            addToast('Encuadre re-ejecutado sobre el lienzo expandido', 'success');
            return;
          }
          // Parse retry codes: RETRY_LAYOUT_SPACIOUS, RETRY_LAYOUT_COMPACT,
          // RETRY_LAYOUT_DENSITY_NORMAL, RETRY_LAYOUT_*_TB, RETRY_LAYOUT_*_LR.
          if (actionCode.startsWith('RETRY_LAYOUT_')) {
            const upper = actionCode.toUpperCase();
            const override: { density?: 'compact' | 'normal' | 'spacious'; direction?: 'TB' | 'LR' } = {};
            if (upper.includes('SPACIOUS')) override.density = 'spacious';
            else if (upper.includes('COMPACT')) override.density = 'compact';
            else if (upper.includes('NORMAL')) override.density = 'normal';
            if (upper.endsWith('_TB')) override.direction = 'TB';
            else if (upper.endsWith('_LR')) override.direction = 'LR';
            const applied = diagram.applyLayoutOverride(override);
            if (applied) {
              const parts = [
                applied.density ? `densidad ${applied.density}` : null,
                applied.direction ? `dirección ${applied.direction}` : null,
              ].filter(Boolean).join(', ');
              addToast(`Layout re-aplicado (${parts || actionCode})`, 'success');
            } else {
              addToast(`No se pudo aplicar ${actionCode} (sin IR)`, 'warning');
            }
            return;
          }
          addToast(`Acción del gate registrada: ${actionCode}. Aplica manualmente desde la toolbar.`, 'info');
        }}
      />

      <ArtifactQualityPanel
        open={showQualityPanel && !isDiagramSurface}
        report={artifactQualitySnapshot.report}
        exportability={artifactQualitySnapshot.state}
        onClose={() => setShowQualityPanel(false)}
      />

      <GenerationTracePanel
        open={showGenerationTracePanel}
        trace={artifact.generationTrace}
        compilation={artifact.compilation}
        compilationFreshness={assessment.compilationFreshness}
        qualityScoreFallback={qualityReport?.score}
        renderDiagnosticsSummary={diagnostic.renderDiagnosticsSummary}
        diagnosticReport={diagnostic.diagnosticReport}
        diagnosticCopied={diagnostic.diagnosticCopied}
        onCopyDiagnosticReport={diagnostic.copyDiagnosticReport}
        onClose={() => setShowGenerationTracePanel(false)}
      />

      {/* MAIN CONTENT AREA */}
      <div className={`flex-1 w-full h-full overflow-hidden relative flex ${viewMode === 'split' && !isFullscreen ? 'flex-col lg:flex-row' : 'flex-col'} min-h-0 pt-16 pb-20`}>
        {isGeneratingTests && <LoadingOverlay message="Generando casos de prueba automatizados..." />}
        {isConvertingToDoc && <LoadingOverlay message="Convirtiendo diagrama a documento..." />}

        {editing.isEditMode ? (
          <div className="flex-1 flex flex-col bg-white dark:bg-gray-900 min-h-0 h-full">
            <MarkdownToolbar onInsert={(text) => editing.setEditedContent((prev) => prev + text)} />
            <textarea
              className="flex-1 w-full p-6 font-mono text-sm bg-transparent resize-none focus:outline-none dark:text-gray-200 h-full"
              value={editing.editedContent}
              onChange={(e) => editing.setEditedContent(e.target.value)}
            />
            <div className="p-4 border-t border-gray-200 dark:border-gray-800 flex justify-end bg-gray-50 dark:bg-gray-950 flex-shrink-0">
              <button onClick={handleSave} className="px-6 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 min-w-[120px] min-h-[44px]">Guardar Cambios</button>
            </div>
          </div>
        ) : (
          <>
            {(viewMode === 'document' || viewMode === 'split') && !isFullscreen && (
              isPresentationArtifact ? (
                <SlideViewer
                  content={artifact.content}
                  artifactName={artifact.name}
                  artifactType={artifact.type}
                  onEdit={editing.enterEditMode}
                  onExport={() => setIsExportModalOpen(true)}
                  isSplit={viewMode === 'split'}
                />
              ) : (
                <DocumentView
                  markdownHtml={markdownHtml}
                  rawContent={artifact.content}
                  pageSize={presentation.pageSize}
                  zoom={presentation.zoom}
                  theme={presentation.theme}
                  pageWidthPx={presentation.pageWidthPx}
                  onChangePageSize={presentation.setPageSize}
                  onChangeZoom={presentation.setZoom}
                  onChangeTheme={presentation.setTheme}
                  onEdit={editing.enterEditMode}
                  onExport={() => setIsExportModalOpen(true)}
                  onPrint={() => {
                    // Prefer the LIVE paper HTML so hydrated content (rendered
                    // Mermaid diagrams, charts) reaches the print window.
                    const live = document.querySelector('[data-document-prose]')?.innerHTML;
                    printDocumentHtml({
                      title: artifact.name,
                      subtitle: [project.name, artifact.objective].filter(Boolean).join(' · '),
                      html: live && live.trim().length > 0 ? live : markdownHtml,
                      mermaidTheme: presentation.theme,
                    });
                  }}
                  toc={documentToc}
                  cover={{
                    title: artifact.name,
                    objective: artifact.objective,
                    projectName: project.name,
                    version: artifact.version,
                    phase: artifact.phase,
                    updatedAt: artifact.createdAt,
                  }}
                  isSplit={viewMode === 'split'}
                />
              )
            )}
            {(viewMode === 'diagram' || viewMode === 'split') && (
              <DiagramView
                artifact={artifact}
                renderable={renderable}
                audience={audience}
                isFullscreen={isFullscreen}
                showMiniMap={showMiniMap}
                isLoading={diagram.isLoading}
                loadingMessage={diagram.loadingMessage}
                diagramError={diagram.error}
                displayFlowNodes={diagram.displayFlowNodes}
                displayFlowEdges={diagram.displayFlowEdges}
                displayedFlowSource={diagram.displayedFlowSource}
                renderableSignature={diagram.renderableSignature}
                mermaidCode={mermaidCode}
                renderDiagnosticsSummary={diagnostic.renderDiagnosticsSummary}
                diagnosticCopied={diagnostic.diagnosticCopied}
                onCopyDiagnosticReport={diagnostic.copyDiagnosticReport}
                reactFlowRef={reactFlowRef}
                onCanvasChange={diagram.canvasChange}
                onCancelLoading={diagram.cancelLoading}
                onAutoFix={diagram.autoFix}
                onRetryDiagram={diagram.retryDiagram}
                onViewText={() => setViewMode('document')}
                onResetCanvas={diagram.resetCanvas}
                layoutPlan={diagram.layoutPlan}
                hasExternalPositions={diagram.hasExternalPositions}
                onLayoutQualityComputed={(snap) => {
                  setLayoutSnapshot({
                    nodeRects: snap.nodeRects,
                    groupRects: snap.groupRects,
                    boundingBox: snap.boundingBox,
                    viewport: snap.viewport,
                    floatingObstacles: snap.floatingObstacles,
                    edgeSegments: snap.edgeSegments,
                    smartViewport: snap.smartViewport,
                    canvasState: snap.canvasState,
                    layoutPlan: snap.layoutPlan ?? undefined,
                  });
                }}
              />
            )}
            {viewMode === 'publication' && !isFullscreen && (
              <PresentationErrorBoundary panelName="Presentación">
              <ArtifactPresentationView
                model={presentationModel}
                errors={presentationCompileResult.errors}
                onOpenExport={() => setIsExportModalOpen(true)}
                onOpenTrace={() => setShowGenerationTracePanel(true)}
              />
              </PresentationErrorBoundary>
            )}
            {viewMode === 'markdown' && !isFullscreen && (
              <MarkdownView
                markdownHtml={markdownHtml}
                rawContent={artifact.content}
                representation={artifact.representation}
                showSource={showMarkdownSource}
                onToggleSource={setShowMarkdownSource}
                markdownCopied={exportActions.markdownCopied}
                onCopyMarkdown={() => { void exportActions.copyMarkdown(); }}
                onDownloadMarkdown={() => { void exportActions.exportMarkdown(); }}
                pageSize={presentation.pageSize}
                zoom={presentation.zoom}
                theme={presentation.theme}
                pageWidthPx={presentation.pageWidthPx}
                onChangePageSize={presentation.setPageSize}
                onChangeZoom={presentation.setZoom}
                onChangeTheme={presentation.setTheme}
              />
            )}
          </>
        )}

        {viewMode === 'excalidraw' && (
          <ExcalidrawArtifactView
            elements={excalidraw.excalidrawData?.elements ?? []}
            isLoading={excalidraw.isLoading}
            error={excalidraw.error}
            onRetry={excalidraw.retry}
            onOpenExternal={excalidraw.openExternal}
            onSwitchToDocument={() => setViewMode('document')}
          />
        )}

        {viewMode === 'fable' && (
          <FableArtifactView
            ir={renderable.ir}
            artifactName={artifact.name}
            audience={audience}
            isLoading={diagram.isLoading}
            onRetry={diagram.retryDiagram}
            onSwitchToDocument={() => setViewMode('document')}
          />
        )}

        {viewMode === 'lucidchart' && (
          <LucidchartArtifactView
            artifactContent={artifact.content}
            artifactRepresentation={artifact.representation}
            artifactTitle={artifact.name}
            flowData={diagram.flowData}
            isFlowLoading={diagram.isLoading}
            flowError={diagram.error}
            existingLucidDocumentId={artifact.lucidDocumentId}
            onLucidDocumentReady={(summary) => {
              if (artifact.lucidDocumentId !== summary.documentId) {
                updateArtifact(project.id, artifact.id, { lucidDocumentId: summary.documentId });
              }
            }}
            onRetry={diagram.retryDiagram}
            onOpenExternal={() => window.open('https://lucid.app/lucidchart/new', '_blank')}
            onSwitchToDocument={() => setViewMode('document')}
          />
        )}
      </div>

      <ExportErrorBoundary panelName="Exportación">
      <ArtifactExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        artifact={artifact}
        activeView={activeExportView}
        formatOptions={exportFormatOptions}
        onExportFormat={(format, options) => { void exportActions.exportFormat(format, options); }}
        preflightReport={preflightReport}
        presentationModel={presentationModel}
        visualGateState={visualGateState}
        visualGateHardBlockContext={visualGateHardBlockContext}
        onVisualGateHardBlock={(context, format) => {
          // Recomendación 7: emit an observability event when the export
          // modal refuses a click due to a hard-block rule. Mirrors the
          // presentation guard so both surfaces are auditable.
          observabilityService.trackEvent({
            severity: 'warning',
            source: 'user-action',
            status: 'observed',
            title: 'Visual Gate hard-block: exportación',
            message: context.message,
            recoverable: true,
            userVisible: true,
            operationName: 'export.attempt',
            metadata: {
              hardBlockCode: context.code,
              visualGateState: visualGateState ?? 'undefined',
              artifactType: artifact.type,
              contentNodeCount: currentContentNodeCount,
              format,
            },
          });
        }}
      />
      </ExportErrorBoundary>

      <ConfirmDialog
        isOpen={presentationConfirm.open}
        title="Visual Quality Gate"
        message={presentationConfirm.message}
        confirmLabel="Presentar de todos modos"
        cancelLabel="Revisar diagrama"
        variant={qualityReport?.visualGate?.state === 'blocked' ? 'danger' : 'warning'}
        onConfirm={() => {
          setPresentationConfirm({ open: false, message: '' });
          reactFlowRef.current?.startPresentation();
        }}
        onCancel={() => setPresentationConfirm({ open: false, message: '' })}
      />

      <AnimatePresence>
        {showOnePager && renderable.ir && (
          <motion.div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 overflow-y-auto"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowOnePager(false)}
          >
            <div onClick={(e) => e.stopPropagation()} className="w-full">
              <ExecutiveOnePager
                title={renderable.ir.metadata?.title ?? artifact.name}
                narrative={renderable.ir.metadata?.narrative}
                ir={renderable.ir}
                onClose={() => setShowOnePager(false)}
                onSaveNarrative={({ title, summary }) => {
                  if (!renderable.ir) return;
                  const prev = renderable.ir.metadata?.narrative;
                  const prevStruct = typeof prev === 'object' ? prev : (prev ? { summary: prev } : {});
                  const nextNarrative = { ...prevStruct, title, summary };
                  const nextIR = {
                    ...renderable.ir,
                    metadata: {
                      ...(renderable.ir.metadata ?? {}),
                      title,
                      narrative: nextNarrative,
                    },
                  };
                  updateArtifact(project.id, artifact.id, {
                    ir: nextIR,
                    ...(title && title !== artifact.name ? { name: title } : {}),
                  });
                }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
