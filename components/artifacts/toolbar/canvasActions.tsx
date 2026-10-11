import React from 'react';
import {
  ArrowPathIcon,
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  CheckBadgeIcon,
  ChatBubbleLeftRightIcon,
  DocumentTextIcon,
  EyeIcon,
  MagnifyingGlassIcon,
  PencilIcon,
  PresentationChartBarIcon,
  ShareIcon,
  SparklesIcon,
  SpeakerWaveIcon,
  Square2StackIcon,
  StopCircleIcon,
  ViewfinderCircleIcon,
} from '../../Icons';
import type { Artifact } from '../../../lib/artifacts';
import type { DiagramAudience } from '../../../lib/diagram';
import type { ArtifactViewMode } from '../../../lib/artifacts/contracts';
import type { CanvasActionId } from './canvasIntents';

/** Everything the canvas hands the toolbar: state to show and handlers to call. */
export interface CanvasActionInputs {
  representation: Artifact['representation'];
  viewMode: ArtifactViewMode;
  availableViews: ArtifactViewMode[];
  isDiagramSurface: boolean;
  hasIR: boolean;

  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  onCenter: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  showMiniMap: boolean;
  onToggleMiniMap: () => void;

  onStartPresentation: () => void;
  onEditStory?: () => void; // «Editar historia», plan de diagramas 4.3
  /**
   * Recomendación 6: Visual Quality Gate tone for the presentation action.
   * When `warn` or `block` the entry surfaces the gate status inline so the
   * architect sees the cost before clicking.
   */
  presentationGateTone?: 'info' | 'warn' | 'block';
  onOpenOnePager: () => void;
  audience: DiagramAudience;
  onChangeAudience: (audience: DiagramAudience) => void;

  isEditMode: boolean;
  onToggleEdit: () => void;
  onSaveDiagram: () => void;
  onConvertToDoc: () => void;
  onGenerateTests: () => void;
  isSpeaking: boolean;
  onToggleSpeech: () => void;

  showQualityPanel: boolean;
  onToggleQualityPanel: () => void;
  qualityScore?: number;
  hasQualityReport: boolean;
  onAutoImprove: () => void;
  isAutoImproving: boolean;
  onGenerateWorldClass: () => void;
  onOpenSuggestions: () => void;

  showTracePanel: boolean;
  onToggleTracePanel: () => void;
  traceErrors: number;
  hasObservabilityAlert: boolean;
  diagnosticCopied: boolean;
  hasDiagnosticReport: boolean;
  onCopyDiagnosticReport: () => void;

  onSelectView: (view: ArtifactViewMode) => void;
}

export interface CanvasAction {
  id: CanvasActionId;
  label: string;
  description?: string;
  icon: React.ReactNode;
  disabled?: boolean;
  active?: boolean;
  run: () => void;
}

const icon = (Icon: React.FC<{ className?: string }>) => <Icon className="h-4 w-4" />;
const dot = (className: string) => <span className={`h-2 w-2 rounded-full ${className}`} />;

/**
 * Every action the canvas offers, with the label, state and handler it had in
 * the six-group bar — 12.5 moves them, it does not change them. Actions that
 * do not apply to this artifact are omitted exactly where they were before
 * (a document has no diagram to save or convert, and no alternative views).
 */
export function buildCanvasActions(p: CanvasActionInputs): CanvasAction[] {
  const hasDiagram = p.representation !== 'document';
  const actions: CanvasAction[] = [
    {
      id: 'quality-panel',
      icon: icon(CheckBadgeIcon),
      label: p.hasQualityReport && p.isDiagramSurface ? `Revalidar calidad · ${p.qualityScore ?? 0}/100` : 'Revalidar calidad',
      description: 'Reporte por dimensión y exportabilidad',
      active: p.showQualityPanel,
      run: p.onToggleQualityPanel,
    },
    {
      id: 'speech',
      icon: p.isSpeaking ? icon(StopCircleIcon) : icon(SpeakerWaveIcon),
      label: p.isSpeaking ? 'Detener lectura' : 'Leer en voz alta',
      active: p.isSpeaking,
      run: p.onToggleSpeech,
    },
    { id: 'zoom-in', icon: icon(MagnifyingGlassIcon), label: 'Acercar', disabled: !p.isDiagramSurface, run: p.onZoomIn },
    { id: 'zoom-out', icon: icon(MagnifyingGlassIcon), label: 'Alejar', disabled: !p.isDiagramSurface, run: p.onZoomOut },
    { id: 'fit', icon: icon(ViewfinderCircleIcon), label: 'Ajustar a pantalla', disabled: !p.isDiagramSurface, run: p.onFitView },
    { id: 'center', icon: icon(ViewfinderCircleIcon), label: 'Centrar artefacto', disabled: !p.isDiagramSurface, run: p.onCenter },
    {
      id: 'fullscreen',
      icon: p.isFullscreen ? icon(ArrowsPointingInIcon) : icon(ArrowsPointingOutIcon),
      label: p.isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa',
      disabled: !p.isDiagramSurface,
      active: p.isFullscreen,
      run: p.onToggleFullscreen,
    },
    {
      id: 'minimap',
      icon: icon(EyeIcon),
      label: p.showMiniMap ? 'Ocultar mini mapa' : 'Mostrar mini mapa',
      description: 'Oculto por defecto',
      disabled: !p.isDiagramSurface,
      active: p.showMiniMap,
      run: p.onToggleMiniMap,
    },
  ];

  if (p.hasIR) {
    actions.push(
      { id: 'aud-exec', icon: dot('bg-sky-400'), label: 'Ejecutiva', description: 'Contexto, valor de negocio y KPIs', active: p.audience === 'executive', run: () => p.onChangeAudience('executive') },
      { id: 'aud-tech', icon: dot('bg-indigo-400'), label: 'Técnica', description: 'Componentes, contratos y tecnologías', active: p.audience === 'technical', run: () => p.onChangeAudience('technical') },
      { id: 'aud-ops', icon: dot('bg-amber-400'), label: 'Operaciones', description: 'Despliegue, observabilidad y runbooks', active: p.audience === 'operations', run: () => p.onChangeAudience('operations') },
    );
  }

  const view = (id: CanvasActionId, mode: ArtifactViewMode, label: string, description: string, Icon: React.FC<{ className?: string }>): CanvasAction => ({
    id, icon: icon(Icon), label, description,
    disabled: !p.availableViews.includes(mode),
    active: p.viewMode === mode,
    run: () => p.onSelectView(mode),
  });
  actions.push(view('view-markdown', 'markdown', 'Vista Markdown', '.md para el equipo de desarrollo', DocumentTextIcon));
  if (hasDiagram) {
    actions.push(
      view('view-fable', 'fable', 'Vista Fable', 'Diseño premium · IA de Anthropic', SparklesIcon),
      view('view-excalidraw', 'excalidraw', 'Vista Excalidraw', 'Pizarra interactiva', PencilIcon),
      view('view-lucidchart', 'lucidchart', 'Vista Lucidchart', 'Editor profesional', ShareIcon),
    );
  }

  actions.push(
    { id: 'suggestions', icon: icon(SparklesIcon), label: 'Mejorar con IA (Sugerencias)', description: 'Recomendaciones accionables de calidad', run: p.onOpenSuggestions },
    {
      id: 'auto-improve',
      icon: icon(ArrowPathIcon),
      label: p.isAutoImproving ? 'Mejorando…' : 'Mejorar automáticamente',
      description: 'Reparación determinística del diagrama',
      disabled: !p.isDiagramSurface || p.isAutoImproving,
      run: p.onAutoImprove,
    },
    { id: 'world-class', icon: icon(SparklesIcon), label: 'Generar versión de clase mundial', description: 'Regenera con el quality gate completo', run: p.onGenerateWorldClass },
    { id: 'edit', icon: icon(PencilIcon), label: p.isEditMode ? 'Salir del modo edición' : 'Editar contenido', active: p.isEditMode, run: p.onToggleEdit },
  );
  if (p.isDiagramSurface) {
    actions.push({ id: 'save-diagram', icon: icon(Square2StackIcon), label: 'Guardar diagrama', description: 'Crea una nueva versión con los cambios', run: p.onSaveDiagram });
  }
  if (p.onEditStory) {
    actions.push({ id: 'edit-story', icon: icon(DocumentTextIcon), label: 'Editar historia', description: 'Escenas, orden y anotaciones del recorrido', disabled: !p.hasIR || !p.isDiagramSurface, run: p.onEditStory });
  }
  if (hasDiagram) {
    actions.push({ id: 'convert', icon: icon(DocumentTextIcon), label: 'Convertir a documento', description: 'Genera un documento narrativo del diagrama', run: p.onConvertToDoc });
  }
  actions.push(
    { id: 'tests', icon: icon(CheckBadgeIcon), label: 'Generar casos de prueba', description: 'Plan de pruebas automatizadas', run: p.onGenerateTests },
    {
      id: 'present',
      icon: icon(PresentationChartBarIcon),
      label: 'Modo presentación',
      // Recomendación 6: annotate only when the gate is not `ready`, so healthy diagrams stay quiet.
      description: p.presentationGateTone === 'block'
        ? '⛔ Gate bloqueado · requiere confirmar'
        : p.presentationGateTone === 'warn'
          ? '⚠️ Gate con advertencias · revisa antes de presentar'
          : 'Recorrido escena por escena',
      disabled: !p.hasIR || !p.isDiagramSurface,
      run: p.onStartPresentation,
    },
    { id: 'brief', icon: icon(DocumentTextIcon), label: 'Brief ejecutivo', description: 'Resumen narrativo en una página', disabled: !p.hasIR, run: p.onOpenOnePager },
    {
      id: 'publication',
      icon: icon(PresentationChartBarIcon),
      label: 'Vista publicación',
      description: 'Previsualización profesional y quality gate',
      disabled: !p.availableViews.includes('publication'),
      active: p.viewMode === 'publication',
      run: () => p.onSelectView('publication'),
    },
    {
      id: 'trace',
      icon: icon(ChatBubbleLeftRightIcon),
      label: 'Traza de generación',
      description: p.traceErrors > 0
        ? `${p.traceErrors} error${p.traceErrors > 1 ? 'es' : ''} · decisiones, eventos y métricas`
        : 'Decisiones, eventos, métricas y compilación',
      active: p.showTracePanel,
      run: p.onToggleTracePanel,
    },
    {
      id: 'copy-report',
      icon: icon(Square2StackIcon),
      label: p.diagnosticCopied ? 'Reporte técnico copiado' : 'Copiar reporte técnico',
      description: 'Diagnóstico para soporte',
      disabled: !p.hasDiagnosticReport,
      run: p.onCopyDiagnosticReport,
    },
  );
  return actions;
}
