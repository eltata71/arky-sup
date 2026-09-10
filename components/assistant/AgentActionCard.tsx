import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  SparklesIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
} from '../Icons';
import type {
  AgentActionPlan,
  AgentActionResult,
  AgentExecutionPhase,
  AgentExecutionTarget,
  MemoryDraft,
  MemoryScope,
} from '../../services/agent';
import { MemoryDraftEditor } from './MemoryDraftEditor';

interface AgentActionCardProps {
  plan: AgentActionPlan;
  phase: AgentExecutionPhase;
  isExecuting: boolean;
  onConfirm: (target: AgentExecutionTarget) => void;
  onCancel: () => void;
  /** Editable memory draft — required when the plan is a `memory.save.*` action. */
  memoryDraft?: MemoryDraft | null;
  hasActiveArtifact?: boolean;
  onChangeMemoryScope?: (scope: MemoryScope) => void;
  onChangeMemoryBullets?: (bullets: string[]) => void;
  onRetryMemoryExtraction?: () => void;
}

const PHASE_LABEL: Record<AgentExecutionPhase, string> = {
  idle: 'Listo',
  analyzing: 'Analizando contexto…',
  preparing: 'Preparando cambios…',
  generating: 'Generando nueva versión…',
  validating: 'Validando calidad…',
  persisting: 'Actualizando artefacto…',
  done: 'Finalizado',
  failed: 'Falló la ejecución',
};

const PHASE_ORDER: AgentExecutionPhase[] = [
  'analyzing',
  'preparing',
  'generating',
  'validating',
  'persisting',
  'done',
];

/**
 * Single card that walks the user through the three agentic moments:
 *  1. Plan preview  (pending → user picks target → confirma)
 *  2. Execution     (live phase ticker)
 *  3. Result        (success/failure banner, surfaced by the parent via `lastResult`).
 *
 * Visually aligned with the rest of the AssistantPanel — cards, rounded
 * corners, dark-mode aware, no inline styles.
 */
export const AgentActionCard: React.FC<AgentActionCardProps> = ({
  plan,
  phase,
  isExecuting,
  onConfirm,
  onCancel,
  memoryDraft,
  hasActiveArtifact = false,
  onChangeMemoryScope,
  onChangeMemoryBullets,
  onRetryMemoryExtraction,
}) => {
  const [target, setTarget] = useState<AgentExecutionTarget>(plan.target);
  const [showDetails, setShowDetails] = useState(false);

  const phaseIdx = PHASE_ORDER.indexOf(phase);
  const isMemoryAction = plan.actionType.startsWith('memory.save.');
  const memoryDraftReady = !!memoryDraft && memoryDraft.status === 'ready' && memoryDraft.bullets.length > 0;
  const canConfirm = isMemoryAction ? memoryDraftReady : true;

  return (
    <motion.div
      role="region"
      aria-label="Plan de acción del Arquitecto Agente"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      className="rounded-2xl border border-primary-200 dark:border-primary-800/60 bg-primary-50/70 dark:bg-primary-900/20 p-4 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg bg-primary-600/10 dark:bg-primary-400/10 p-1.5">
          <SparklesIcon className="h-4 w-4 text-primary-700 dark:text-primary-300" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{plan.title}</h4>
            <span
              className="text-2xs uppercase tracking-widest font-semibold px-1.5 py-0.5 rounded bg-primary-600/15 text-primary-700 dark:text-primary-300"
              aria-label="Tipo de acción agencial"
            >
              {plan.actionType.replace('artifact.', '')}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-700 dark:text-gray-300 leading-snug">
            {plan.summary}
          </p>
        </div>
      </div>

      {/* Affected & risks (collapsible details) */}
      {(plan.affectedAreas.length > 0 || plan.risks.length > 0) && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="text-2xs uppercase tracking-widest font-semibold text-primary-700 dark:text-primary-300 hover:underline"
            aria-expanded={showDetails}
          >
            {showDetails ? 'Ocultar detalles' : 'Ver plan'}
          </button>
          <AnimatePresence initial={false}>
            {showDetails && (
              <motion.div
                key="details"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <p className="text-2xs uppercase tracking-widest font-semibold text-gray-500 mb-1">
                      Áreas afectadas
                    </p>
                    <ul className="space-y-1 text-xs text-gray-700 dark:text-gray-300">
                      {plan.affectedAreas.map((area, i) => (
                        <li key={i}>• {area}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-2xs uppercase tracking-widest font-semibold text-gray-500 mb-1">
                      Riesgos
                    </p>
                    <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-300">
                      {plan.risks.map((risk, i) => (
                        <li key={i}>• {risk}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                {plan.intent.extractedRequirements.length > 0 && (
                  <div className="mt-3">
                    <p className="text-2xs uppercase tracking-widest font-semibold text-gray-500 mb-1">
                      Requisitos extraídos
                    </p>
                    <ul className="space-y-1 text-xs text-gray-700 dark:text-gray-300">
                      {plan.intent.extractedRequirements.map((r, i) => (
                        <li key={i}>– {r}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="mt-2 text-2xs text-gray-500">
                  Confianza: {(plan.intent.confidence * 100).toFixed(0)}% · Trace:{' '}
                  <code className="font-mono">{plan.traceId.slice(-6)}</code>
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Memory action: replace the target picker with the bullets editor. */}
      {isMemoryAction && memoryDraft && (
        <MemoryDraftEditor
          draft={memoryDraft}
          isExecuting={isExecuting}
          hasActiveArtifact={hasActiveArtifact}
          onChangeScope={(scope) => onChangeMemoryScope?.(scope)}
          onChangeBullets={(bullets) => onChangeMemoryBullets?.(bullets)}
          onRetryExtraction={() => onRetryMemoryExtraction?.()}
        />
      )}

      {/* Target picker — only for artifact-mutating actions. */}
      {!isExecuting && !isMemoryAction && plan.actionType !== 'artifact.explainOnly' && (
        <fieldset className="mt-3" disabled={isExecuting}>
          <legend className="text-2xs uppercase tracking-widest font-semibold text-gray-500 mb-1">
            Destino
          </legend>
          <div className="flex gap-2">
            <label className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg border bg-white dark:bg-gray-900 cursor-pointer text-xs border-gray-200 dark:border-gray-700 has-[:checked]:border-primary-500 has-[:checked]:bg-primary-50 dark:has-[:checked]:bg-primary-900/40">
              <input
                type="radio"
                name={`target-${plan.actionId}`}
                value="new_version"
                checked={target === 'new_version'}
                onChange={() => setTarget('new_version')}
                className="accent-primary-600"
              />
              <span className="text-gray-800 dark:text-gray-200">Nueva versión (recomendado)</span>
            </label>
            <label className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg border bg-white dark:bg-gray-900 cursor-pointer text-xs border-gray-200 dark:border-gray-700 has-[:checked]:border-primary-500 has-[:checked]:bg-primary-50 dark:has-[:checked]:bg-primary-900/40">
              <input
                type="radio"
                name={`target-${plan.actionId}`}
                value="current"
                checked={target === 'current'}
                onChange={() => setTarget('current')}
                className="accent-primary-600"
              />
              <span className="text-gray-800 dark:text-gray-200">Sobrescribir actual</span>
            </label>
          </div>
        </fieldset>
      )}

      {/* Action buttons */}
      {!isExecuting ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onConfirm(target)}
            disabled={!canConfirm}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-primary-600 text-white hover:bg-primary-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <SparklesIcon className="h-3.5 w-3.5" />
            {isMemoryAction
              ? `Guardar en ${memoryDraft?.scope === 'global' ? 'memoria global' : memoryDraft?.scope === 'artifact' ? 'memoria del artefacto' : 'memoria del proyecto'}`
              : target === 'current'
                ? 'Aplicar al artefacto'
                : 'Crear nueva versión'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center px-3 py-1.5 rounded-md text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200/60 dark:hover:bg-gray-800 transition-colors"
          >
            Cancelar
          </button>
        </div>
      ) : (
        <div className="mt-3" aria-live="polite">
          <div className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
            <ArrowPathIcon className="h-3.5 w-3.5 animate-spin text-primary-600" />
            <span>{PHASE_LABEL[phase]}</span>
          </div>
          <div className="mt-2 flex gap-1">
            {PHASE_ORDER.map((p, i) => (
              <div
                key={p}
                aria-hidden="true"
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i <= phaseIdx
                    ? 'bg-primary-600 dark:bg-primary-400'
                    : 'bg-gray-200 dark:bg-gray-700'
                }`}
              />
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
};

interface AgentResultCardProps {
  result: AgentActionResult;
  onOpenNewVersion?: () => void;
  onDismiss: () => void;
  /**
   * Optional rollback handler. When provided AND the action created a new
   * version, the card renders a "Revertir" button that restores the previous
   * version. The handler is responsible for using `restoreArtifactVersion`
   * (the existing service); the card never mutates state directly.
   */
  onRollback?: () => void;
  /** When true, disables the rollback button while the rollback is in progress. */
  isRollingBack?: boolean;
}

/** Compact success/failure banner shown after an action wraps up. */
export const AgentResultCard: React.FC<AgentResultCardProps> = ({
  result,
  onOpenNewVersion,
  onDismiss,
  onRollback,
  isRollingBack,
}) => {
  const isSuccess = result.status === 'success';
  const isFailed = result.status === 'failed';

  return (
    <motion.div
      role="status"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl border p-3.5 text-sm ${
        isSuccess
          ? 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800'
          : isFailed
            ? 'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800'
            : 'bg-gray-50 dark:bg-gray-900/30 border-gray-200 dark:border-gray-700'
      }`}
    >
      <div className="flex items-start gap-2">
        {isSuccess ? (
          <CheckCircleIcon className="h-4 w-4 mt-0.5 text-emerald-600 dark:text-emerald-300 flex-shrink-0" />
        ) : isFailed ? (
          <ExclamationTriangleIcon className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-300 flex-shrink-0" />
        ) : (
          <XCircleIcon className="h-4 w-4 mt-0.5 text-gray-500 flex-shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-widest mb-0.5">
            {isSuccess ? 'Acción completada' : isFailed ? 'Acción no aplicada' : 'Acción cancelada'}
          </p>
          {result.messages.map((msg, i) => (
            <p key={i} className="text-sm leading-snug text-gray-800 dark:text-gray-200">
              {msg}
            </p>
          ))}
          {result.appliedChanges.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-gray-700 dark:text-gray-300">
              {result.appliedChanges.map((c, i) => (
                <li key={i}>• {c}</li>
              ))}
            </ul>
          )}
          {result.validationResult && (
            <p className="mt-2 text-2xs uppercase tracking-widest text-gray-500">
              Validación: {result.validationResult.summary}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {isSuccess && (result.newArtifactVersionId || result.newArtifactId) && onOpenNewVersion && (
              <button
                type="button"
                onClick={onOpenNewVersion}
                className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
              >
                {result.newArtifactId && !result.newArtifactVersionId
                  ? 'Abrir artefacto creado'
                  : 'Abrir nueva versión'}
              </button>
            )}
            {(isSuccess || result.status === 'partial') && result.newArtifactVersionId && onRollback && (
              <button
                type="button"
                onClick={onRollback}
                disabled={isRollingBack}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors disabled:opacity-50"
                aria-label="Revertir a la versión anterior"
              >
                <ArrowPathIcon className="h-3.5 w-3.5" />
                {isRollingBack ? 'Revirtiendo…' : 'Revertir'}
              </button>
            )}
            <button
              type="button"
              onClick={onDismiss}
              className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200/60 dark:hover:bg-gray-800 transition-colors"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

interface ProactiveAgentSuggestionCardProps {
  label: string;
  /** Short preview of the instruction the agent will derive. */
  preview: string;
  onAccept: () => void;
  onDismiss: () => void;
}

/**
 * Subtle prompt that appears under the model's response when the assistant
 * itself recommended an action ("podrías regenerar…", "te sugiero corregir…").
 * Lets the user accept the proposal with a single click — no extra typing.
 */
export const ProactiveAgentSuggestionCard: React.FC<ProactiveAgentSuggestionCardProps> = ({
  label,
  preview,
  onAccept,
  onDismiss,
}) => (
  <motion.div
    role="region"
    aria-label="Sugerencia accionable del Arquitecto Agente"
    initial={{ opacity: 0, y: 6 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0 }}
    className="rounded-2xl border border-dashed border-purple-300 dark:border-purple-700/60 bg-purple-50/60 dark:bg-purple-900/15 p-3"
  >
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 rounded-lg bg-purple-600/10 dark:bg-purple-400/10 p-1.5">
        <SparklesIcon className="h-3.5 w-3.5 text-purple-700 dark:text-purple-300" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-2xs uppercase tracking-widest font-semibold text-purple-700 dark:text-purple-300 mb-0.5">
          Acción recomendada
        </p>
        <p className="text-xs text-gray-800 dark:text-gray-200 line-clamp-3">{preview}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onAccept}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-purple-600 text-white hover:bg-purple-700 transition-colors"
          >
            <SparklesIcon className="h-3 w-3" />
            {label}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex items-center px-2 py-1 rounded-md text-2xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-200/60 dark:hover:bg-gray-800 transition-colors"
          >
            Descartar
          </button>
        </div>
      </div>
    </div>
  </motion.div>
);
