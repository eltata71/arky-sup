/**
 * El botón que aparece al lado de un campo y pide ayuda para completarlo.
 *
 * Deliberadamente pequeño y siempre en el mismo sitio: a la derecha de la
 * etiqueta del campo, nunca dentro del control. Un usuario que aprende a
 * reconocerlo en la creación de una iniciativa lo reconoce en el mantenimiento
 * de un entregable, que es la mitad del valor de tenerlo en todas partes.
 *
 * Accesibilidad, y esto está en `lib/a11y.ts` porque ya costó caro una vez: el
 * botón lleva `aria-label` y NO lleva `title`. Sobre un elemento que ya tiene
 * nombre, `title` pasa a ser la *descripción* y un lector de pantalla lee las
 * dos. El afordance de hover lo da `Tooltip`, que está construido para callar.
 */

import React from 'react';
import { Sparkles } from 'lucide-react';
import { Spinner, Tooltip, cn } from '../ui';
import type { CaptureFieldId } from '../../lib/capture';

export interface FieldAssistButtonProps {
  fieldId: CaptureFieldId;
  /** Cómo se llama el campo, para el nombre accesible del botón. */
  label: string;
  onAsk: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** Motivo por el que está deshabilitado, para que el tooltip lo diga. */
  disabledReason?: string;
  className?: string;
}

export const FieldAssistButton: React.FC<FieldAssistButtonProps> = ({
  fieldId,
  label,
  onAsk,
  loading = false,
  disabled = false,
  disabledReason,
  className,
}) => {
  const name = `Sugerir ${label.toLowerCase()} con el arquitecto agente`;
  const hint = disabled && disabledReason ? disabledReason : name;
  return (
    <Tooltip label={hint} side="top">
      <button
        type="button"
        data-field={fieldId}
        onClick={onAsk}
        disabled={disabled || loading}
        aria-label={name}
        aria-busy={loading || undefined}
        className={cn(
          'inline-flex h-6 items-center gap-1 rounded-md border border-ai-200 bg-ai-50 px-1.5',
          'text-2xs font-semibold text-ai-700 transition-colors',
          'hover:bg-ai-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'dark:border-ai-800 dark:bg-ai-950/40 dark:text-ai-300 dark:hover:bg-ai-900/50',
          className,
        )}
      >
        {loading
          ? <Spinner size="xs" />
          : <Sparkles className="h-3 w-3" aria-hidden strokeWidth={2.5} />}
        <span aria-hidden>IA</span>
      </button>
    </Tooltip>
  );
};

export default FieldAssistButton;
