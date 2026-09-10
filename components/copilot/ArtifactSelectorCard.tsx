/**
 * Selector card surfaced by the Arquitecto Agente when the user references an
 * artifact ambiguously ("mejora el diagrama"). Lets the user pick the target
 * from a short candidate list instead of forcing the AI to guess.
 *
 * Purely presentational — all state lives upstream in the modal so the card
 * can stay a thin, accessible UI surface (radio group + confirm button).
 */

import React from 'react';
import { motion } from 'motion/react';
import { ArrowRightIcon, XMarkIcon } from '../Icons';
import type { Artifact } from '../../types';

interface ArtifactSelectorCardProps {
  candidates: Artifact[];
  /** When non-null, this candidate is currently highlighted. */
  selectedId: string | null;
  onSelect: (artifact: Artifact) => void;
  onConfirm: () => void;
  onCancel: () => void;
  /** Headline copy ("Estoy entre estos artefactos…"). */
  prompt?: string;
}

export const ArtifactSelectorCard: React.FC<ArtifactSelectorCardProps> = ({
  candidates,
  selectedId,
  onSelect,
  onConfirm,
  onCancel,
  prompt,
}) => {
  if (candidates.length === 0) return null;

  return (
    <motion.div
      role="region"
      aria-label="Seleccionar artefacto objetivo"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      className="rounded-2xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/70 dark:bg-amber-900/20 p-4 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-2xs uppercase tracking-widest font-semibold text-amber-700 dark:text-amber-300 mb-1">
            Requiere selección
          </p>
          <p className="text-sm text-gray-800 dark:text-gray-200 leading-snug">
            {prompt ?? 'Encontré varios artefactos que podrían encajar. ¿Sobre cuál quieres trabajar?'}
          </p>
        </div>
      </div>

      <fieldset className="mt-3 space-y-2">
        <legend className="sr-only">Artefactos candidatos</legend>
        {candidates.map((artifact) => {
          const isSelected = selectedId === artifact.id;
          return (
            <label
              key={artifact.id}
              className={`flex items-start gap-2 rounded-lg border bg-white dark:bg-gray-900 p-2.5 cursor-pointer transition-colors ${
                isSelected
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/40'
                  : 'border-gray-200 dark:border-gray-700 hover:border-primary-300 dark:hover:border-primary-700'
              }`}
            >
              <input
                type="radio"
                name="artifact-candidate"
                value={artifact.id}
                checked={isSelected}
                onChange={() => onSelect(artifact)}
                className="mt-1 accent-primary-600"
                aria-label={`Seleccionar ${artifact.name}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-1.5">
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                    {artifact.name}
                  </span>
                  <span className="text-2xs uppercase tracking-widest text-gray-500">
                    {artifact.type} · v{artifact.version}
                  </span>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 line-clamp-2">
                  {artifact.objective || artifact.architecturalView}
                </p>
              </div>
            </label>
          );
        })}
      </fieldset>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={!selectedId}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-primary-600 text-white hover:bg-primary-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ArrowRightIcon className="h-3.5 w-3.5" />
          Continuar con este artefacto
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200/60 dark:hover:bg-gray-800 transition-colors"
        >
          <XMarkIcon className="h-3.5 w-3.5" />
          Cancelar
        </button>
      </div>
    </motion.div>
  );
};

export default ArtifactSelectorCard;
