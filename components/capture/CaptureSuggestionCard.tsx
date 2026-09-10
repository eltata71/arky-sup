/**
 * Lo que el asistente propone, antes de que sea de nadie.
 *
 * Una propuesta se muestra *junto* al campo y se aplica con un clic explícito.
 * Nunca se escribe sola: el registro es del arquitecto, y una sugerencia que se
 * aplica sin que nadie la lea es indistinguible de un campo que se rellenó mal.
 *
 * Dos formas, porque hay dos clases de campo:
 *
 *  - `text` — un valor. Se acepta entero o se descarta.
 *  - `list` — varias entradas independientes. Cada una se acepta por separado,
 *    porque de cinco objetivos propuestos lo normal es querer tres.
 */

import React from 'react';
import { Check, Plus, Sparkles, X } from 'lucide-react';
import { Badge, Button, cn } from '../ui';
import type { CaptureFieldSuggestion, CaptureFieldShape } from '../../lib/capture';

export interface CaptureSuggestionCardProps {
  suggestion: CaptureFieldSuggestion;
  shape: CaptureFieldShape;
  /** Aplica un valor. En una lista se llama una vez por entrada aceptada. */
  onAccept: (value: string) => void;
  onDismiss: () => void;
  /** Entradas ya aplicadas, para no ofrecerlas dos veces. */
  applied?: readonly string[];
  className?: string;
}

export const CaptureSuggestionCard: React.FC<CaptureSuggestionCardProps> = ({
  suggestion,
  shape,
  onAccept,
  onDismiss,
  applied = [],
  className,
}) => {
  const appliedSet = new Set(applied.map((value) => value.trim().toLowerCase()));
  const pending = suggestion.values.filter((value) => !appliedSet.has(value.trim().toLowerCase()));
  if (pending.length === 0) return null;

  return (
    <div
      className={cn(
        'rounded-xl border border-ai-200 bg-ai-50/70 p-3 dark:border-ai-800 dark:bg-ai-950/30',
        className,
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <Badge tone="ai" size="xs">
          <Sparkles className="mr-1 h-3 w-3" aria-hidden />
          Propuesta del arquitecto agente
        </Badge>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Descartar la propuesta"
          className="inline-flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:text-gray-200"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      {shape === 'text' ? (
        <div className="space-y-2">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800 dark:text-gray-100">
            {pending[0]}
          </p>
          <Button size="xs" variant="ai" onClick={() => onAccept(pending[0])}>
            <Check className="mr-1 h-3 w-3" aria-hidden />
            Usar esta redacción
          </Button>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {pending.map((value) => (
            <li key={value} className="flex items-start gap-2">
              <button
                type="button"
                onClick={() => onAccept(value)}
                aria-label={`Añadir: ${value}`}
                className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-ai-300 bg-white text-ai-700 transition-colors hover:bg-ai-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-ai-700 dark:bg-gray-900 dark:text-ai-300"
              >
                <Plus className="h-3 w-3" aria-hidden />
              </button>
              <span className="text-sm leading-relaxed text-gray-800 dark:text-gray-100">{value}</span>
            </li>
          ))}
        </ul>
      )}

      {suggestion.rationale && (
        <p className="mt-2 border-t border-ai-200/70 pt-2 text-2xs leading-relaxed text-gray-600 dark:border-ai-800/70 dark:text-gray-400">
          {suggestion.rationale}
        </p>
      )}
    </div>
  );
};

export default CaptureSuggestionCard;
