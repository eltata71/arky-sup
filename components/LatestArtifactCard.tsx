import React from 'react';
import type { Artifact } from '../lib/artifacts';
import type { ArtifactReviewStatus } from '../services/review';
import {
  ClockIcon,
  SparklesIcon,
  ArrowRightIcon,
  ChatBubbleLeftRightIcon,
  DocumentTextIcon,
  Squares2X2Icon,
} from './Icons';
import { formatDateTime, formatRelativeDateTime } from '../utils/datetime';
import { getArtifactActivityDate, getPhaseLabel } from '../utils/artifactExploration';

interface ReviewStatusStyle {
  label: string;
  className: string;
}

/** Visual styling for each review status, with a safe default for `draft`. */
const REVIEW_STATUS_STYLES: Record<ArtifactReviewStatus, ReviewStatusStyle> = {
  draft: {
    label: 'Borrador',
    className:
      'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-white/[0.06] dark:text-slate-300 dark:ring-white/10',
  },
  'pending-review': {
    label: 'En revisión',
    className:
      'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/20',
  },
  'changes-requested': {
    label: 'Cambios solicitados',
    className:
      'bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:ring-orange-500/20',
  },
  approved: {
    label: 'Aprobado',
    className:
      'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20',
  },
  rejected: {
    label: 'Rechazado',
    className:
      'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/20',
  },
};

interface LatestArtifactCardProps {
  /** Most recent artifact, or `null` when the project has none yet. */
  artifact: Artifact | null;
  onOpen: (artifactId: string) => void;
  onChat: (artifact: Artifact) => void;
  /** Invoked from the empty state to start creating the first artifact. */
  onExploreCatalog: () => void;
}

/**
 * Sidebar shortcut to the most recently generated or modified artifact. Shows
 * a professional empty state when the project has no artifacts yet.
 */
export const LatestArtifactCard: React.FC<LatestArtifactCardProps> = ({
  artifact,
  onOpen,
  onChat,
  onExploreCatalog,
}) => {
  if (!artifact) {
    return (
      <section
        className="rounded-3xl border border-dashed border-slate-300 bg-white p-5 text-center shadow-sm dark:border-white/15 dark:bg-white/[0.03]"
        aria-label="Último artefacto generado"
      >
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-500 dark:bg-primary-500/10 dark:text-primary-300">
          <SparklesIcon className="h-6 w-6" />
        </div>
        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
          Último artefacto
        </p>
        <h3 className="mt-1 text-sm font-bold text-slate-900 dark:text-white">
          Aún no hay artefactos
        </h3>
        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
          Genera tu primer activo de arquitectura desde el catálogo guiado.
        </p>
        <button
          type="button"
          onClick={onExploreCatalog}
          className="mt-4 inline-flex min-h-[42px] w-full items-center justify-center rounded-2xl bg-primary-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#101014]"
        >
          Generar primer artefacto
          <ArrowRightIcon className="ml-2 h-4 w-4" />
        </button>
      </section>
    );
  }

  const isDiagram = artifact.representation === 'diagram';
  const status = REVIEW_STATUS_STYLES[artifact.reviewStatus ?? 'draft'];
  const activityDate = getArtifactActivityDate(artifact);

  return (
    <section
      className="overflow-hidden rounded-3xl border border-primary-200 bg-gradient-to-br from-primary-50 via-white to-white shadow-sm dark:border-primary-500/30 dark:from-primary-500/10 dark:via-[#101014] dark:to-[#101014]"
      aria-label={`Último artefacto generado: ${artifact.name}`}
    >
      <div className="p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.2em] text-primary-600 dark:text-primary-300">
            <ClockIcon className="h-3.5 w-3.5" />
            Último artefacto
          </p>
          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-black text-slate-600 ring-1 ring-slate-200 dark:bg-black/30 dark:text-slate-300 dark:ring-white/10">
            v{artifact.version}
          </span>
        </div>

        <div className="mt-3 flex items-start gap-3">
          <span
            className={`flex h-10 w-10 flex-none items-center justify-center rounded-2xl ${
              isDiagram
                ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300'
                : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300'
            }`}
            aria-hidden="true"
          >
            {isDiagram ? (
              <Squares2X2Icon className="h-5 w-5" />
            ) : (
              <DocumentTextIcon className="h-5 w-5" />
            )}
          </span>
          <div className="min-w-0">
            <h3
              className="line-clamp-2 text-sm font-black leading-snug text-slate-950 dark:text-white"
            >
              {artifact.name}
            </h3>
            <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
              {artifact.type}
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600 ring-1 ring-slate-200 dark:bg-black/30 dark:text-slate-300 dark:ring-white/10">
            {getPhaseLabel(artifact.phase)}
          </span>
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${status.className}`}
          >
            {status.label}
          </span>
        </div>

        <p
          className="mt-3 inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"
        >
          <ClockIcon className="h-3.5 w-3.5" />
          <span>{formatDateTime(activityDate)}</span>
          <span className="text-slate-300 dark:text-slate-600">·</span>
          <span className="font-semibold text-slate-600 dark:text-slate-300">
            {formatRelativeDateTime(activityDate)}
          </span>
        </p>
      </div>

      <div className="flex border-t border-primary-100 dark:border-white/10">
        <button
          type="button"
          onClick={() => onOpen(artifact.id)}
          className="flex min-h-[46px] flex-1 items-center justify-center gap-1.5 text-sm font-bold text-primary-700 transition hover:bg-primary-100/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 dark:text-primary-200 dark:hover:bg-primary-500/10"
        >
          Abrir artefacto
          <ArrowRightIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onChat(artifact)}
          className="flex min-h-[46px] w-14 items-center justify-center border-l border-primary-100 text-primary-700 transition hover:bg-primary-100/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 dark:border-white/10 dark:text-primary-200 dark:hover:bg-primary-500/10"
          aria-label={`Conversar sobre ${artifact.name}`}
          title="Conversar sobre este artefacto"
        >
          <ChatBubbleLeftRightIcon className="h-5 w-5" />
        </button>
      </div>
    </section>
  );
};
