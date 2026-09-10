import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { PlusCircleIcon, TrashIcon, ArrowPathIcon, SparklesIcon } from '../Icons';
import type { MemoryDraft, MemoryScope } from '../../services/agent';

interface MemoryDraftEditorProps {
  draft: MemoryDraft;
  /** Whether the action is currently executing. Disables interactions when true. */
  isExecuting: boolean;
  /** Has an active artifact — controls whether the `artifact` scope option is enabled. */
  hasActiveArtifact: boolean;
  onChangeScope: (scope: MemoryScope) => void;
  onChangeBullets: (bullets: string[]) => void;
  onRetryExtraction: () => void;
}

const SCOPE_LABELS: Record<MemoryScope, string> = {
  global: 'Memoria global',
  project: 'Memoria del proyecto',
  artifact: 'Memoria del artefacto',
};

const SCOPE_DESCRIPTIONS: Record<MemoryScope, string> = {
  global: 'Aplica a todos los proyectos del workspace.',
  project: 'Aplica sólo al proyecto activo.',
  artifact: 'Aplica sólo al artefacto activo.',
};

const MAX_BULLET_LENGTH = 220;

/**
 * Inline editor used by the AgentActionCard when the pending plan is a
 * `memory.save.*` action. Lets the user:
 *  - flip the target scope (global / project / artifact),
 *  - edit each AI-extracted bullet,
 *  - add or remove bullets,
 *  - retry extraction if it failed.
 *
 * The component is purely presentational — all state mutation goes through
 * the props so the hook keeps the single source of truth.
 */
export const MemoryDraftEditor: React.FC<MemoryDraftEditorProps> = ({
  draft,
  isExecuting,
  hasActiveArtifact,
  onChangeScope,
  onChangeBullets,
  onRetryExtraction,
}) => {
  // Local mirror so each <textarea> stays responsive without rerendering
  // the entire tree on every keystroke. We commit upward on blur.
  const [bullets, setBullets] = useState<string[]>(draft.bullets);
  useEffect(() => {
    setBullets(draft.bullets);
  }, [draft.bullets]);

  const commitBullets = (next: string[]) => {
    const sanitised = next.map((b) => b.slice(0, MAX_BULLET_LENGTH));
    setBullets(sanitised);
    onChangeBullets(sanitised);
  };

  const updateAt = (index: number, value: string) => {
    setBullets((curr) => curr.map((b, i) => (i === index ? value : b)));
  };

  const removeAt = (index: number) => {
    commitBullets(bullets.filter((_, i) => i !== index));
  };

  const addEmpty = () => {
    commitBullets([...bullets, '']);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-3 space-y-3"
      aria-label="Editor de memoria"
    >
      {/* Scope picker */}
      <fieldset disabled={isExecuting}>
        <legend className="text-2xs uppercase tracking-widest font-semibold text-gray-500 mb-1">
          Alcance
        </legend>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
          {(['global', 'project', 'artifact'] as MemoryScope[]).map((scope) => {
            const isDisabled = scope === 'artifact' && !hasActiveArtifact;
            const selected = draft.scope === scope;
            return (
              <label
                key={scope}
                className={`flex flex-col gap-0.5 px-2.5 py-2 rounded-lg border bg-white dark:bg-gray-900 cursor-pointer text-xs transition-colors ${
                  isDisabled
                    ? 'opacity-50 cursor-not-allowed border-gray-200 dark:border-gray-800'
                    : selected
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/40'
                      : 'border-gray-200 dark:border-gray-700 hover:border-primary-300'
                }`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`memory-scope-${draft.scope}`}
                    value={scope}
                    checked={selected}
                    disabled={isDisabled}
                    onChange={() => onChangeScope(scope)}
                    className="accent-primary-600"
                  />
                  <span className="font-medium text-gray-800 dark:text-gray-200">
                    {SCOPE_LABELS[scope]}
                  </span>
                </span>
                <span className="text-2xs text-gray-500 ml-5 leading-snug">
                  {SCOPE_DESCRIPTIONS[scope]}
                  {isDisabled && ' · Requiere un artefacto activo.'}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Status + bullets */}
      {draft.status === 'extracting' && (
        <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300" role="status">
          <ArrowPathIcon className="h-3.5 w-3.5 animate-spin text-primary-600" />
          <span>Extrayendo conceptos clave de la conversación…</span>
        </div>
      )}

      {draft.status === 'failed' && (
        <div className="flex items-start justify-between gap-2 p-2 rounded-md bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200">
          <span>{draft.errorMessage ?? 'No pude extraer conceptos automáticamente.'}</span>
          <button
            type="button"
            onClick={onRetryExtraction}
            disabled={isExecuting}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-2xs font-semibold bg-amber-600 text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
          >
            <ArrowPathIcon className="h-3 w-3" />
            Reintentar
          </button>
        </div>
      )}

      {draft.status !== 'extracting' && (
        <fieldset disabled={isExecuting}>
          <legend className="text-2xs uppercase tracking-widest font-semibold text-gray-500 mb-1">
            Conceptos a guardar
          </legend>
          <div className="space-y-1.5">
            {bullets.length === 0 && draft.status === 'ready' && (
              <p className="text-xs text-gray-500 italic">
                No hay conceptos. Añade al menos uno o reintenta la extracción.
              </p>
            )}
            {bullets.map((bullet, index) => (
              <div key={index} className="flex items-start gap-1.5 group">
                <span className="mt-1 text-primary-600 dark:text-primary-400 select-none">•</span>
                <textarea
                  value={bullet}
                  rows={Math.min(3, Math.max(1, Math.ceil(bullet.length / 60)))}
                  onChange={(e) => updateAt(index, e.target.value)}
                  onBlur={() => commitBullets(bullets)}
                  maxLength={MAX_BULLET_LENGTH}
                  className="flex-1 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 focus:border-primary-500 focus:outline-none resize-y text-gray-800 dark:text-gray-200"
                  aria-label={`Concepto ${index + 1}`}
                />
                <button
                  type="button"
                  onClick={() => removeAt(index)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-opacity"
                  aria-label="Eliminar concepto"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={addEmpty}
              className="inline-flex items-center gap-1 text-xs text-primary-700 dark:text-primary-300 hover:underline"
            >
              <PlusCircleIcon className="h-3.5 w-3.5" />
              Añadir concepto
            </button>
            {draft.status === 'ready' && (
              <button
                type="button"
                onClick={onRetryExtraction}
                className="ml-auto inline-flex items-center gap-1 text-2xs text-gray-500 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
              >
                <SparklesIcon className="h-3 w-3" />
                Reextraer con IA
              </button>
            )}
          </div>
        </fieldset>
      )}
    </motion.div>
  );
};
