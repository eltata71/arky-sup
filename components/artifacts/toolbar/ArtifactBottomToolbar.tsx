import React from 'react';
import { motion } from 'motion/react';
import { Dropdown, type DropdownItem, type DropdownSection } from '../../ui/Dropdown';
import {
  ArrowPathIcon,
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  CheckBadgeIcon,
  ChatBubbleLeftRightIcon,
  ChevronDownIcon,
  Cog6ToothIcon,
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

export interface ArtifactBottomToolbarProps {
  representation: Artifact['representation'];
  viewMode: ArtifactViewMode;
  availableViews: ArtifactViewMode[];
  isDiagramSurface: boolean;
  hasIR: boolean;

  // Navegación y visualización
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  onCenter: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  showMiniMap: boolean;
  onToggleMiniMap: () => void;

  // Presentación
  onStartPresentation: () => void;
  /**
   * Recomendación 6: Visual Quality Gate tone for the presentation action.
   * When `warn` or `block` the dropdown entry surfaces the gate status
   * inline so the architect sees the cost before clicking.
   */
  presentationGateTone?: 'info' | 'warn' | 'block';
  onOpenOnePager: () => void;
  audience: DiagramAudience;
  onChangeAudience: (audience: DiagramAudience) => void;

  // Edición y regeneración
  isEditMode: boolean;
  onToggleEdit: () => void;
  onSaveDiagram: () => void;
  onConvertToDoc: () => void;
  onGenerateTests: () => void;
  isSpeaking: boolean;
  onToggleSpeech: () => void;

  // Calidad e IA
  showQualityPanel: boolean;
  onToggleQualityPanel: () => void;
  qualityScore?: number;
  hasQualityReport: boolean;
  onAutoImprove: () => void;
  isAutoImproving: boolean;
  onGenerateWorldClass: () => void;
  onOpenSuggestions: () => void;

  // Observabilidad y trazabilidad
  showTracePanel: boolean;
  onToggleTracePanel: () => void;
  traceErrors: number;
  hasObservabilityAlert: boolean;
  diagnosticCopied: boolean;
  hasDiagnosticReport: boolean;
  onCopyDiagnosticReport: () => void;

  // Vistas y configuración
  onSelectView: (view: ArtifactViewMode) => void;
}

interface GroupTriggerProps {
  label: string;
  icon: React.ReactNode;
  open: boolean;
  toggle: () => void;
  /** Optional status dot on the trigger. */
  dotClassName?: string;
  badge?: number;
}

const GroupTrigger: React.FC<GroupTriggerProps> = ({ label, icon, open, toggle, dotClassName, badge }) => (
  <button
    type="button"
    onClick={toggle}
    aria-expanded={open}
    aria-label={label}
    className="relative inline-flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
  >
    <span className="relative flex items-center">
      {icon}
      {dotClassName && (
        <span className={`absolute -right-1 -top-1 h-2 w-2 rounded-full ${dotClassName}`} aria-hidden />
      )}
    </span>
    <span className="hidden md:inline">{label}</span>
    {typeof badge === 'number' && badge > 0 && (
      <span className="rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-rose-600 dark:text-rose-300">
        {badge}
      </span>
    )}
    <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
  </button>
);

/**
 * Floating bottom toolbar of the artifact canvas. Groups every secondary or
 * advanced action into six labelled dropdown menus (Navegación, Presentación,
 * Edición, Calidad e IA, Observabilidad, Configuración). The primary actions
 * stay in {@link ArtifactTopToolbar}; observability, traceability and the
 * minimap surface only when opened from here.
 */
export const ArtifactBottomToolbar: React.FC<ArtifactBottomToolbarProps> = (props) => {
  const {
    representation,
    viewMode,
    availableViews,
    isDiagramSurface,
    hasIR,
    onZoomIn,
    onZoomOut,
    onFitView,
    onCenter,
    isFullscreen,
    onToggleFullscreen,
    showMiniMap,
    onToggleMiniMap,
    onStartPresentation,
    presentationGateTone,
    onOpenOnePager,
    audience,
    onChangeAudience,
    isEditMode,
    onToggleEdit,
    onSaveDiagram,
    onConvertToDoc,
    onGenerateTests,
    isSpeaking,
    onToggleSpeech,
    showQualityPanel,
    onToggleQualityPanel,
    qualityScore,
    hasQualityReport,
    onAutoImprove,
    isAutoImproving,
    onGenerateWorldClass,
    onOpenSuggestions,
    showTracePanel,
    onToggleTracePanel,
    traceErrors,
    hasObservabilityAlert,
    diagnosticCopied,
    hasDiagnosticReport,
    onCopyDiagnosticReport,
    onSelectView,
  } = props;

  const hasDiagram = representation !== 'document';

  // ── Navegación y visualización ────────────────────────────────────────
  const navigationItems: DropdownItem[] = [
    {
      id: 'zoom-in',
      icon: <MagnifyingGlassIcon className="h-4 w-4" />,
      label: 'Acercar',
      disabled: !isDiagramSurface,
      onClick: onZoomIn,
    },
    {
      id: 'zoom-out',
      icon: <MagnifyingGlassIcon className="h-4 w-4" />,
      label: 'Alejar',
      disabled: !isDiagramSurface,
      onClick: onZoomOut,
    },
    {
      id: 'fit',
      icon: <ViewfinderCircleIcon className="h-4 w-4" />,
      label: 'Ajustar a pantalla',
      disabled: !isDiagramSurface,
      onClick: onFitView,
    },
    {
      id: 'center',
      icon: <ViewfinderCircleIcon className="h-4 w-4" />,
      label: 'Centrar artefacto',
      disabled: !isDiagramSurface,
      onClick: onCenter,
    },
    {
      id: 'fullscreen',
      icon: isFullscreen ? <ArrowsPointingInIcon className="h-4 w-4" /> : <ArrowsPointingOutIcon className="h-4 w-4" />,
      label: isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa',
      disabled: !isDiagramSurface,
      active: isFullscreen,
      onClick: onToggleFullscreen,
    },
    {
      id: 'minimap',
      icon: <EyeIcon className="h-4 w-4" />,
      label: showMiniMap ? 'Ocultar mini mapa' : 'Mostrar mini mapa',
      description: 'Oculto por defecto',
      disabled: !isDiagramSurface,
      active: showMiniMap,
      onClick: onToggleMiniMap,
    },
  ];

  // ── Presentación ──────────────────────────────────────────────────────
  const presentationSections: DropdownSection[] = [
    {
      items: [
        {
          id: 'present',
          icon: <PresentationChartBarIcon className="h-4 w-4" />,
          label: 'Modo presentación',
          // Recomendación 6: surface the gate status so the architect
          // sees the cost before clicking. We only annotate when the gate
          // is not `ready` (info tone) so healthy diagrams stay quiet.
          description: presentationGateTone === 'block'
            ? '⛔ Gate bloqueado · requiere confirmar'
            : presentationGateTone === 'warn'
              ? '⚠️ Gate con advertencias · revisa antes de presentar'
              : 'Recorrido escena por escena',
          disabled: !hasIR || !isDiagramSurface,
          onClick: onStartPresentation,
        },
        {
          id: 'brief',
          icon: <DocumentTextIcon className="h-4 w-4" />,
          label: 'Brief ejecutivo',
          description: 'Resumen narrativo en una página',
          disabled: !hasIR,
          onClick: onOpenOnePager,
        },
        {
          id: 'publication',
          icon: <PresentationChartBarIcon className="h-4 w-4" />,
          label: 'Vista publicación',
          description: 'Previsualización profesional y quality gate',
          disabled: !availableViews.includes('publication'),
          active: viewMode === 'publication',
          onClick: () => onSelectView('publication'),
        },
      ],
    },
  ];
  if (hasIR) {
    presentationSections.push({
      label: 'Audiencia (ajustes visuales)',
      items: [
        {
          id: 'aud-exec',
          icon: <span className="h-2 w-2 rounded-full bg-sky-400" />,
          label: 'Ejecutiva',
          description: 'Contexto, valor de negocio y KPIs',
          active: audience === 'executive',
          onClick: () => onChangeAudience('executive'),
        },
        {
          id: 'aud-tech',
          icon: <span className="h-2 w-2 rounded-full bg-indigo-400" />,
          label: 'Técnica',
          description: 'Componentes, contratos y tecnologías',
          active: audience === 'technical',
          onClick: () => onChangeAudience('technical'),
        },
        {
          id: 'aud-ops',
          icon: <span className="h-2 w-2 rounded-full bg-amber-400" />,
          label: 'Operaciones',
          description: 'Despliegue, observabilidad y runbooks',
          active: audience === 'operations',
          onClick: () => onChangeAudience('operations'),
        },
      ],
    });
  }

  // ── Edición y regeneración ────────────────────────────────────────────
  const editingItems: DropdownItem[] = [
    {
      id: 'edit',
      icon: <PencilIcon className="h-4 w-4" />,
      label: isEditMode ? 'Salir del modo edición' : 'Editar contenido',
      active: isEditMode,
      onClick: onToggleEdit,
    },
  ];
  if (isDiagramSurface) {
    editingItems.push({
      id: 'save-diagram',
      icon: <Square2StackIcon className="h-4 w-4" />,
      label: 'Guardar diagrama',
      description: 'Crea una nueva versión con los cambios',
      onClick: onSaveDiagram,
    });
  }
  if (hasDiagram) {
    editingItems.push({
      id: 'convert',
      icon: <DocumentTextIcon className="h-4 w-4" />,
      label: 'Convertir a documento',
      description: 'Genera un documento narrativo del diagrama',
      onClick: onConvertToDoc,
    });
  }
  editingItems.push(
    {
      id: 'tests',
      icon: <CheckBadgeIcon className="h-4 w-4" />,
      label: 'Generar casos de prueba',
      description: 'Plan de pruebas automatizadas',
      onClick: onGenerateTests,
    },
    {
      id: 'speech',
      icon: isSpeaking ? <StopCircleIcon className="h-4 w-4" /> : <SpeakerWaveIcon className="h-4 w-4" />,
      label: isSpeaking ? 'Detener lectura' : 'Leer en voz alta',
      active: isSpeaking,
      onClick: onToggleSpeech,
    },
  );

  // ── Calidad e IA ──────────────────────────────────────────────────────
  const qualityItems: DropdownItem[] = [
    {
      id: 'suggestions',
      icon: <SparklesIcon className="h-4 w-4" />,
      label: 'Mejorar con IA (Sugerencias)',
      description: 'Recomendaciones accionables de calidad',
      onClick: onOpenSuggestions,
    },
    {
      id: 'quality-panel',
      icon: <CheckBadgeIcon className="h-4 w-4" />,
      label: hasQualityReport && isDiagramSurface ? `Revalidar calidad · ${qualityScore ?? 0}/100` : 'Revalidar calidad',
      description: 'Reporte por dimensión y exportabilidad',
      active: showQualityPanel,
      onClick: onToggleQualityPanel,
    },
    {
      id: 'auto-improve',
      icon: <ArrowPathIcon className="h-4 w-4" />,
      label: isAutoImproving ? 'Mejorando…' : 'Mejorar automáticamente',
      description: 'Reparación determinística del diagrama',
      disabled: !isDiagramSurface || isAutoImproving,
      onClick: onAutoImprove,
    },
    {
      id: 'world-class',
      icon: <SparklesIcon className="h-4 w-4" />,
      label: 'Generar versión de clase mundial',
      description: 'Regenera con el quality gate completo',
      onClick: onGenerateWorldClass,
    },
  ];

  // ── Observabilidad y trazabilidad ─────────────────────────────────────
  const observabilityItems: DropdownItem[] = [
    {
      id: 'trace',
      icon: <ChatBubbleLeftRightIcon className="h-4 w-4" />,
      label: 'Traza de generación',
      description: traceErrors > 0
        ? `${traceErrors} error${traceErrors > 1 ? 'es' : ''} · decisiones, eventos y métricas`
        : 'Decisiones, eventos, métricas y compilación',
      active: showTracePanel,
      onClick: onToggleTracePanel,
    },
    {
      id: 'copy-report',
      icon: <Square2StackIcon className="h-4 w-4" />,
      label: diagnosticCopied ? 'Reporte técnico copiado' : 'Copiar reporte técnico',
      description: 'Diagnóstico para soporte',
      disabled: !hasDiagnosticReport,
      onClick: onCopyDiagnosticReport,
    },
  ];

  // ── Vistas y configuración ────────────────────────────────────────────
  const configItems: DropdownItem[] = [
    {
      id: 'view-markdown',
      icon: <DocumentTextIcon className="h-4 w-4" />,
      label: 'Vista Markdown',
      description: '.md para el equipo de desarrollo',
      disabled: !availableViews.includes('markdown'),
      active: viewMode === 'markdown',
      onClick: () => onSelectView('markdown'),
    },
  ];
  if (hasDiagram) {
    configItems.push(
      {
        id: 'view-fable',
        icon: <SparklesIcon className="h-4 w-4" />,
        label: 'Vista Fable',
        description: 'Diseño premium · IA de Anthropic',
        disabled: !availableViews.includes('fable'),
        active: viewMode === 'fable',
        onClick: () => onSelectView('fable'),
      },
      {
        id: 'view-excalidraw',
        icon: <PencilIcon className="h-4 w-4" />,
        label: 'Vista Excalidraw',
        description: 'Pizarra interactiva',
        disabled: !availableViews.includes('excalidraw'),
        active: viewMode === 'excalidraw',
        onClick: () => onSelectView('excalidraw'),
      },
      {
        id: 'view-lucidchart',
        icon: <ShareIcon className="h-4 w-4" />,
        label: 'Vista Lucidchart',
        description: 'Editor profesional',
        disabled: !availableViews.includes('lucidchart'),
        active: viewMode === 'lucidchart',
        onClick: () => onSelectView('lucidchart'),
      },
    );
  }

  return (
    <div className="pointer-events-none absolute bottom-5 left-1/2 z-40 -translate-x-1/2">
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        role="toolbar"
        aria-label="Acciones del artefacto"
        className="pointer-events-auto flex items-center gap-0.5 rounded-2xl border border-gray-200/60 bg-white/90 p-1.5 shadow-2xl backdrop-blur-xl dark:border-gray-700/60 dark:bg-gray-900/90"
      >
        <Dropdown
          align="center"
          width="md"
          aria-label="Navegación y visualización"
          items={navigationItems}
          trigger={({ open, toggle }) => (
            <GroupTrigger label="Navegación" icon={<ViewfinderCircleIcon className="h-4 w-4" />} open={open} toggle={toggle} />
          )}
        />
        <Dropdown
          align="center"
          width="md"
          aria-label="Presentación"
          sections={presentationSections}
          trigger={({ open, toggle }) => (
            <GroupTrigger label="Presentación" icon={<PresentationChartBarIcon className="h-4 w-4" />} open={open} toggle={toggle} />
          )}
        />
        <Dropdown
          align="center"
          width="md"
          aria-label="Edición y regeneración"
          items={editingItems}
          trigger={({ open, toggle }) => (
            <GroupTrigger label="Edición" icon={<PencilIcon className="h-4 w-4" />} open={open} toggle={toggle} />
          )}
        />
        <Dropdown
          align="center"
          width="md"
          aria-label="Calidad e IA"
          items={qualityItems}
          trigger={({ open, toggle }) => (
            <GroupTrigger label="Calidad e IA" icon={<CheckBadgeIcon className="h-4 w-4" />} open={open} toggle={toggle} />
          )}
        />
        <Dropdown
          align="center"
          width="md"
          aria-label="Observabilidad y trazabilidad"
          items={observabilityItems}
          trigger={({ open, toggle }) => (
            <GroupTrigger
              label="Observabilidad"
              icon={<ChatBubbleLeftRightIcon className="h-4 w-4" />}
              open={open}
              toggle={toggle}
              dotClassName={hasObservabilityAlert ? 'bg-amber-500' : undefined}
              badge={traceErrors}
            />
          )}
        />
        <Dropdown
          align="right"
          width="md"
          aria-label="Vistas y configuración"
          items={configItems}
          trigger={({ open, toggle }) => (
            <GroupTrigger label="Configuración" icon={<Cog6ToothIcon className="h-4 w-4" />} open={open} toggle={toggle} />
          )}
        />
      </motion.div>
    </div>
  );
};

export default ArtifactBottomToolbar;
