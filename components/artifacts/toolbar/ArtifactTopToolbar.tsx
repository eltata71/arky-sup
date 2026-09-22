import React from 'react';
import { Breadcrumbs } from '../../Breadcrumbs';
import { Tooltip } from '../../ui/Tooltip';
import { ArtifactStatusBadge } from '../ArtifactStatusBadge';
import {
  ArrowLeftIcon,
  ArrowUpTrayIcon,
  DocumentTextIcon,
  LightBulbIcon,
  MagnifyingGlassIcon,
  Squares2X2Icon,
  ViewColumnsIcon,
} from '../../Icons';
import type { Artifact } from '../../../lib/artifacts';
import type { ArtifactViewMode } from '../../../lib/artifacts/contracts';

export interface ArtifactTopToolbarProps {
  projectName: string;
  artifact: Artifact;
  viewMode: ArtifactViewMode;
  /** View modes the active artifact can actually render. */
  availableViews: ArtifactViewMode[];
  onBack: () => void;
  onSelectView: (view: ArtifactViewMode) => void;
  onOpenSuggestions: () => void;
  onOpenInspector: () => void;
  onOpenExport: () => void;
}

const PRIMARY_VIEWS: Array<{ value: ArtifactViewMode; label: string; icon: React.ReactNode }> = [
  { value: 'diagram', label: 'Diagrama', icon: <Squares2X2Icon className="h-3.5 w-3.5" /> },
  { value: 'document', label: 'Documento', icon: <DocumentTextIcon className="h-3.5 w-3.5" /> },
  { value: 'split', label: 'Híbrido', icon: <ViewColumnsIcon className="h-3.5 w-3.5" /> },
];

/**
 * Always-visible top toolbar of the artifact canvas. Holds only the primary
 * actions: the view switcher (Diagrama / Documento / Híbrido) and the
 * Sugerencias, Inspeccionar and Exportar buttons. Every secondary or
 * technical control lives in {@link ArtifactBottomToolbar}.
 */
export const ArtifactTopToolbar: React.FC<ArtifactTopToolbarProps> = ({
  projectName,
  artifact,
  viewMode,
  availableViews,
  onBack,
  onSelectView,
  onOpenSuggestions,
  onOpenInspector,
  onOpenExport,
}) => {
  const views = PRIMARY_VIEWS.filter((view) => availableViews.includes(view.value));

  return (
    <div className="pointer-events-none absolute left-0 right-0 top-0 z-30 flex items-start justify-between gap-2 px-3 pt-3 sm:px-4">
      {/* Left — navigation + identity */}
      <div className="pointer-events-auto flex min-w-0 items-center gap-2 rounded-full border border-gray-200/60 bg-white/85 px-2.5 py-1.5 shadow-sm backdrop-blur-md dark:border-gray-700/60 dark:bg-gray-900/85">
        <button
          type="button"
          onClick={onBack}
          className="flex-shrink-0 rounded-full p-1.5 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:bg-gray-800 dark:hover:text-white"
            aria-label="Volver al hub del proyecto"
        >
          <ArrowLeftIcon className="h-4 w-4" />
        </button>
        <span className="h-4 w-px flex-shrink-0 bg-gray-300 dark:bg-gray-700" aria-hidden />
        <Breadcrumbs
          crumbs={[
            { label: projectName, onClick: onBack },
            { label: artifact.name, meta: `v${artifact.version}` },
          ]}
        />
        <span className="hidden flex-shrink-0 sm:block">
          <ArtifactStatusBadge artifact={artifact} compact />
        </span>
      </div>

      {/* Center — view switcher */}
      {views.length > 0 && (
        <div
          role="tablist"
          aria-label="Vista del artefacto"
          className="pointer-events-auto flex flex-shrink-0 items-center gap-0.5 rounded-full border border-gray-200/60 bg-white/85 p-1 shadow-sm backdrop-blur-md dark:border-gray-700/60 dark:bg-gray-900/85"
        >
          {views.map((view) => {
            const active = viewMode === view.value;
            return (
              <button
                key={view.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSelectView(view.value)}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                  active
                    ? 'bg-primary-600 text-white shadow-sm'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white'
                }`}
              >
                {view.icon}
                <span className="hidden sm:inline">{view.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Right — primary actions */}
      <div className="pointer-events-auto flex flex-shrink-0 items-center gap-1 rounded-full border border-gray-200/60 bg-white/85 p-1 shadow-sm backdrop-blur-md dark:border-gray-700/60 dark:bg-gray-900/85">
        <Tooltip label="Sugerencias de IA para mejorar la calidad del artefacto" side="bottom">
          <button
            type="button"
            onClick={onOpenSuggestions}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            aria-haspopup="dialog"
          >
            <LightBulbIcon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Sugerencias</span>
          </button>
        </Tooltip>
        <Tooltip label="Inspeccionar: estado, calidad, comentarios y revisión" side="bottom">
          <button
            type="button"
            onClick={onOpenInspector}
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
            aria-haspopup="dialog"
          >
            <MagnifyingGlassIcon className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Inspeccionar</span>
          </button>
        </Tooltip>
        <Tooltip label="Exportar el artefacto (PNG, SVG, PDF, Markdown…)" side="bottom">
          <button
            type="button"
            onClick={onOpenExport}
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
            aria-haspopup="dialog"
          >
            <ArrowUpTrayIcon className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Exportar</span>
          </button>
        </Tooltip>
      </div>
    </div>
  );
};

export default ArtifactTopToolbar;
