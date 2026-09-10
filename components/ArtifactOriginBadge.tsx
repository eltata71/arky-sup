/**
 * Compact chip that shows how an artifact was generated (catalog,
 * on-demand, regeneration, or unknown). Used in the Project Hub artifact
 * list and grid so the architect can identify provenance at a glance.
 *
 * Keeping this in a single component avoids duplicating the badge styling
 * between the table and card surfaces.
 */

import React from 'react';
import type { Artifact } from '../types';
import { getArtifactOrigin, type ArtifactOriginKind } from '../utils/artifactExploration';
import { SparklesIcon, ClipboardDocumentListIcon, ArrowPathIcon, ClockIcon } from './Icons';

const TONE_BY_KIND: Record<ArtifactOriginKind, { container: string; icon: React.ReactNode }> = {
  catalog: {
    container:
      'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-500/20',
    icon: <ClipboardDocumentListIcon className="h-3 w-3" />,
  },
  'on-demand': {
    container:
      'bg-primary-50 text-primary-700 ring-primary-200 dark:bg-primary-500/10 dark:text-primary-200 dark:ring-primary-500/20',
    icon: <SparklesIcon className="h-3 w-3" />,
  },
  regeneration: {
    container:
      'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-200 dark:ring-violet-500/20',
    icon: <ArrowPathIcon className="h-3 w-3" />,
  },
  unknown: {
    container:
      'bg-slate-50 text-slate-500 ring-slate-200 dark:bg-white/[0.04] dark:text-slate-400 dark:ring-white/10',
    icon: <ClockIcon className="h-3 w-3" />,
  },
};

interface ArtifactOriginBadgeProps {
  artifact: Artifact;
  /** Compact omits the icon for tight rows; default shows both. */
  variant?: 'default' | 'compact';
  className?: string;
}

export const ArtifactOriginBadge: React.FC<ArtifactOriginBadgeProps> = ({
  artifact,
  variant = 'default',
  className,
}) => {
  const origin = getArtifactOrigin(artifact);
  const tone = TONE_BY_KIND[origin.kind];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${tone.container} ${className ?? ''}`.trim()}
      title={origin.description}
      aria-label={`Modo de generación: ${origin.label}`}
    >
      {variant === 'default' && tone.icon}
      {origin.label}
    </span>
  );
};
