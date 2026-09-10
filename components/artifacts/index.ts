/**
 * Public surface of the artifact UI module.
 *
 * Phase 1 extracted the canvas panels into focused components so the
 * workspace shell, command palette and Phase 4 surfaces could mount them
 * independently. Phase 2 completes the split: the document, diagram,
 * markdown, Excalidraw and Lucidchart views, the floating toolbar and the
 * AI actions menu are now standalone, domain-grouped modules.
 */
export { default as ViewerCrashFallback } from './ViewerCrashFallback';
export { default as DiagramErrorPanel } from './diagram/DiagramErrorPanel';
export { default as DiagramQualityPanel } from './quality/DiagramQualityPanel';
export { default as DiagramQualityBadge } from './quality/DiagramQualityBadge';
export { default as ArtifactQualityPanel } from './quality/ArtifactQualityPanel';
export { default as ArtifactQualityBadge } from './quality/ArtifactQualityBadge';
export { default as GenerationTracePanel } from './trace/GenerationTracePanel';
export { default as ObservabilityBanner } from './diagnostic/ObservabilityBanner';
export { default as ArtifactExportModal } from './export/ArtifactExportModal';
export { ArtifactStatusBadge, deriveArtifactStatus } from './ArtifactStatusBadge';
export { ArtifactPresentationView } from './ArtifactPresentationView';
export type { ArtifactPresentationViewProps } from './ArtifactPresentationView';
export type { ArtifactStatusKind } from './ArtifactStatusBadge';
export { ReviewStatusBadge, reviewStatusLabel } from './ReviewStatusBadge';
export { CommentThread } from './CommentThread';
export { ReviewPanel } from './ReviewPanel';
export { DocumentOutline } from './DocumentOutline';
export { ArtifactInspectorPanel } from './ArtifactInspectorPanel';

// ─── Phase 2 — view components ────────────────────────────────────────────

export { DocumentView } from './document/DocumentView';
export type { DocumentViewProps } from './document/DocumentView';
export { DocumentViewToolbar } from './document/DocumentViewToolbar';
export type { DocumentViewToolbarProps } from './document/DocumentViewToolbar';
export { DocumentPaper } from './document/DocumentPaper';
export type { DocumentPaperProps } from './document/DocumentPaper';

export { DiagramView } from './diagram/DiagramView';
export type { DiagramViewProps } from './diagram/DiagramView';
export { DiagramSkeleton, LoadingOverlay } from './diagram/DiagramSkeleton';
export { isDiagramFlowData } from './diagram/diagramFlow';
export type { DiagramFlowData } from './diagram/diagramFlow';
export { initMermaidTheme } from './diagram/mermaidTheme';

export { MarkdownView } from './markdown/MarkdownView';
export type { MarkdownViewProps } from './markdown/MarkdownView';

export { ExcalidrawArtifactView } from './excalidraw/ExcalidrawArtifactView';
export type { ExcalidrawArtifactViewProps } from './excalidraw/ExcalidrawArtifactView';

export { LucidchartArtifactView } from './lucidchart/LucidchartArtifactView';
export type { LucidchartArtifactViewProps } from './lucidchart/LucidchartArtifactView';

export { FableArtifactView } from './fable/FableArtifactView';
export type { FableArtifactViewProps } from './fable/FableArtifactView';

export { ArtifactTopToolbar } from './toolbar/ArtifactTopToolbar';
export type { ArtifactTopToolbarProps } from './toolbar/ArtifactTopToolbar';

export { ArtifactBottomToolbar } from './toolbar/ArtifactBottomToolbar';
export type { ArtifactBottomToolbarProps } from './toolbar/ArtifactBottomToolbar';

export { ArtifactSuggestionsPanel } from './suggestions/ArtifactSuggestionsPanel';
export type { ArtifactSuggestionsPanelProps } from './suggestions/ArtifactSuggestionsPanel';

export { SlideViewer } from './presentation/SlideViewer';
export type { SlideViewerProps } from './presentation/SlideViewer';
