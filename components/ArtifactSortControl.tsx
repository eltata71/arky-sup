import React, { useId } from 'react';
import { ListOrderedIcon, ChevronDownIcon } from './Icons';
import type { ArtifactSortKey, ArtifactSortOption } from '../utils/artifactExploration';

interface ArtifactSortControlProps {
  value: ArtifactSortKey;
  options: ArtifactSortOption[];
  onChange: (key: ArtifactSortKey) => void;
  /** Context the order is applied to, used for the helper copy. */
  context: 'workspace' | 'catalog';
}

/**
 * Compact, accessible ordering control for the Project Hub sidebar. Renders a
 * native `<select>` so keyboard and assistive-tech support come for free; the
 * available criteria are driven by {@link ArtifactSortOption} entries, which
 * keeps the control extensible without code changes here.
 */
export const ArtifactSortControl: React.FC<ArtifactSortControlProps> = ({
  value,
  options,
  onChange,
  context,
}) => {
  const selectId = useId();
  const safeValue = options.some((option) => option.key === value)
    ? value
    : options[0]?.key ?? value;

  return (
    <section
      className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.03]"
      aria-label="Ordenar artefactos"
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-300">
          <ListOrderedIcon className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
            Ordenar
          </p>
          <p className="text-sm font-bold text-slate-900 dark:text-white">Criterio de orden</p>
        </div>
      </div>

      <label htmlFor={selectId} className="sr-only">
        Ordenar {context === 'workspace' ? 'mis artefactos' : 'el catálogo'} por
      </label>
      <div className="relative">
        <select
          id={selectId}
          value={safeValue}
          onChange={(event) => onChange(event.target.value as ArtifactSortKey)}
          className="w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50 py-2.5 pl-3 pr-9 text-sm font-bold text-slate-900 outline-none transition focus-visible:border-primary-400 focus-visible:bg-white focus-visible:ring-4 focus-visible:ring-primary-500/10 dark:border-white/10 dark:bg-black/20 dark:text-white dark:focus-visible:bg-black/30"
        >
          {options.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      </div>

      <p className="mt-2 text-[11px] leading-4 text-slate-400 dark:text-slate-500">
        {safeValue === 'ai-recommended' && context === 'catalog'
          ? 'La IA ordena cada fase por dependencias y prioridad arquitectónica para reducir inconsistencias.'
          : `Se aplica a ${context === 'workspace' ? 'tus artefactos activos' : 'las plantillas del catálogo'}.`}
      </p>
    </section>
  );
};
