import React from 'react';
import type { Artifact } from '../../../types';
import { CollapsibleSection } from './CollapsibleSection';
import { cn } from '../../ui/cn';

export type SourceUse = 'required' | 'optional' | 'excluded' | 'none';

interface SourceSelectionCardProps {
  artifact: Artifact;
  use: SourceUse;
  onChange: (use: SourceUse) => void;
}

const USE_OPTIONS: Array<{ value: SourceUse; label: string }> = [
  { value: 'none', label: 'No usar' },
  { value: 'required', label: 'Fuente obligatoria' },
  { value: 'optional', label: 'Usar si aporta valor' },
  { value: 'excluded', label: 'Excluir' },
];

const useStyles: Record<SourceUse, { ring: string; chip: string; chipText: string }> = {
  required: {
    ring: 'ring-emerald-200 dark:ring-emerald-900/60',
    chip: 'bg-emerald-50 dark:bg-emerald-950/30',
    chipText: 'text-emerald-800 dark:text-emerald-200',
  },
  optional: {
    ring: 'ring-blue-200 dark:ring-blue-900/60',
    chip: 'bg-blue-50 dark:bg-blue-950/30',
    chipText: 'text-blue-800 dark:text-blue-200',
  },
  excluded: {
    ring: 'ring-rose-200 dark:ring-rose-900/60',
    chip: 'bg-rose-50 dark:bg-rose-950/30',
    chipText: 'text-rose-800 dark:text-rose-200',
  },
  none: {
    ring: 'ring-gray-200 dark:ring-gray-800',
    chip: 'bg-gray-100 dark:bg-gray-800',
    chipText: 'text-gray-600 dark:text-gray-300',
  },
};

const USE_LABEL: Record<SourceUse, string> = {
  required: 'Obligatoria',
  optional: 'Opcional',
  excluded: 'Excluida',
  none: 'Sin usar',
};

/**
 * Compact card for one source artifact in step 3. By default it shows only
 * the information needed to decide if the source belongs in the brief.
 * Technical metadata (versions, dates, quality scores, raw IDs) lives behind
 * a "Ver detalle técnico" disclosure.
 */
export const SourceSelectionCard: React.FC<SourceSelectionCardProps> = ({ artifact, use, onChange }) => {
  const styles = useStyles[use];
  const createdAt = artifact.createdAt ? new Date(artifact.createdAt).toLocaleDateString() : null;
  return (
    <div
      className={cn(
        'rounded-xl border bg-white p-3 ring-1 transition dark:bg-gray-900/70',
        'border-gray-200 dark:border-gray-800',
        styles.ring,
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-semibold text-gray-900 dark:text-white">{artifact.name}</p>
            <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', styles.chip, styles.chipText)}>
              {USE_LABEL[use]}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {artifact.type} · {artifact.architecturalView}
          </p>
          {artifact.objective && (
            <p className="mt-1.5 text-sm text-gray-700 dark:text-gray-300 line-clamp-2">{artifact.objective}</p>
          )}
        </div>
        <select
          aria-label={`Uso de fuente ${artifact.name}`}
          value={use}
          onChange={event => onChange(event.target.value as SourceUse)}
          className="min-h-[44px] w-full shrink-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 dark:border-gray-700 dark:bg-gray-900 dark:text-white sm:w-56"
        >
          {USE_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
      <CollapsibleSection
        label="Ver detalle técnico"
        openLabel="Ocultar detalle técnico"
        tone="subtle"
        className="mt-1"
      >
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-gray-600 dark:text-gray-400">
          <div><dt className="font-semibold text-gray-700 dark:text-gray-300">Fase</dt><dd>{artifact.phase}</dd></div>
          <div><dt className="font-semibold text-gray-700 dark:text-gray-300">Versión</dt><dd>v{artifact.version}</dd></div>
          {createdAt && <div><dt className="font-semibold text-gray-700 dark:text-gray-300">Creado</dt><dd>{createdAt}</dd></div>}
          <div><dt className="font-semibold text-gray-700 dark:text-gray-300">Representación</dt><dd>{artifact.representation ?? 'auto'}</dd></div>
          {artifact.compilation?.compilerScore !== undefined && (
            <div><dt className="font-semibold text-gray-700 dark:text-gray-300">Calidad</dt><dd>{artifact.compilation.compilerScore}/100</dd></div>
          )}
          <div className="col-span-2"><dt className="font-semibold text-gray-700 dark:text-gray-300">ID</dt><dd className="font-mono">{artifact.id}</dd></div>
        </dl>
      </CollapsibleSection>
    </div>
  );
};

export default SourceSelectionCard;
