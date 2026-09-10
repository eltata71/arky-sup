/**
 * Un campo con ayuda: el botón, la propuesta y lo que pasa al aceptarla.
 *
 * Existe para que los seis formularios —creación y mantenimiento de iniciativa,
 * proyecto y entregable— usen literalmente el mismo control. Cuando cada
 * pantalla monta el suyo, la de creación y la de mantenimiento acaban pidiendo
 * lo mismo con palabras distintas y aplicando el resultado de dos maneras; el
 * usuario lo nota y no sabe por qué.
 *
 * Aquí sólo vive la composición. El estado está en `useCaptureAssistant`, la
 * política de qué se pregunta en `services/architectureOffice/application` y la
 * llamada al modelo en `services/ai`.
 */

import React from 'react';
import { captureField, type CaptureContext, type CaptureFieldId } from '../../lib/capture';
import type { CaptureAssistantApi } from '../../hooks/useCaptureAssistant';
import { FieldAssistButton } from './FieldAssistButton';
import { CaptureSuggestionCard } from './CaptureSuggestionCard';
import { cn } from '../ui';

export interface CaptureAssistProps {
  fieldId: CaptureFieldId;
  assistant: CaptureAssistantApi;
  /**
   * Lo que el asistente sabe del registro. `null` deshabilita el botón: es lo
   * que ocurre mientras el formulario todavía no tiene nada de lo que partir, y
   * decirlo es mejor que ofrecer una ayuda que no puede ayudar.
   */
  context: CaptureContext | null;
  /** Qué hacer con un valor aceptado. En una lista se llama una vez por entrada. */
  apply: (value: string) => void;
  /** Lo ya escrito en el campo, para que el asistente lo mejore en vez de ignorarlo. */
  current?: string;
  /** Entradas ya presentes, para no volver a proponerlas. */
  applied?: readonly string[];
  /** Etiqueta del botón. Por defecto, la del catálogo. */
  label?: string;
  disabled?: boolean;
  className?: string;
}

export const CaptureAssist: React.FC<CaptureAssistProps> = ({
  fieldId,
  assistant,
  context,
  apply,
  current,
  applied,
  label,
  disabled = false,
  className,
}) => {
  const spec = captureField(fieldId);
  const suggestion = assistant.suggestions[fieldId];

  return (
    <div className={cn('space-y-2', className)}>
      <FieldAssistButton
        fieldId={fieldId}
        label={label ?? spec.label}
        loading={assistant.pendingField === fieldId}
        disabled={disabled || context === null || assistant.pendingField !== null}
        disabledReason={context === null
          ? 'Escribe algo primero: el asistente propone a partir de lo que ya dice el registro.'
          : undefined}
        onAsk={() => {
          if (!context) return;
          void assistant.askField(fieldId, context, current);
        }}
      />
      {suggestion && (
        <CaptureSuggestionCard
          suggestion={suggestion}
          shape={spec.shape}
          applied={applied}
          onAccept={(value) => {
            apply(value);
            // Un campo de un solo valor queda resuelto al aceptarlo; una lista
            // sigue abierta porque lo normal es aceptar varias entradas.
            if (spec.shape === 'text') assistant.dismiss(fieldId);
          }}
          onDismiss={() => assistant.dismiss(fieldId)}
        />
      )}
    </div>
  );
};

export default CaptureAssist;
