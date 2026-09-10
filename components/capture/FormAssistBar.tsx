/**
 * La asistencia a nivel de formulario: un botón que propone de una vez todo lo
 * que falta, y el sitio donde se dice lo que el asistente NO pudo deducir.
 *
 * Las preguntas abiertas están aquí y no en un campo porque no pertenecen a
 * ninguno: son lo que hay que preguntarle al negocio. Esconderlas convertiría
 * la asistencia en un generador de texto plausible, que es justo lo que no
 * queremos que sea.
 */

import React from 'react';
import { HelpCircle, WandSparkles } from 'lucide-react';
import { Alert, Button, cn } from '../ui';

export interface FormAssistBarProps {
  /** Cuántos campos quedan por completar. Cero oculta el botón. */
  pendingCount: number;
  onAsk: () => void;
  loading?: boolean;
  /** Mensaje del último intento fallido, ya en español. */
  notice?: string | null;
  openQuestions?: readonly string[];
  /** Qué se está completando: «la iniciativa», «el proyecto», «el entregable». */
  subject: string;
  className?: string;
}

export const FormAssistBar: React.FC<FormAssistBarProps> = ({
  pendingCount,
  onAsk,
  loading = false,
  notice,
  openQuestions = [],
  subject,
  className,
}) => (
  <div className={cn('space-y-2', className)}>
    {pendingCount > 0 && (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ai-200 bg-ai-50/60 px-3 py-2 dark:border-ai-800 dark:bg-ai-950/30">
        <p className="text-xs text-gray-700 dark:text-gray-200">
          Quedan <span className="font-semibold">{pendingCount}</span> campo(s) por completar en {subject}.
        </p>
        <Button size="xs" variant="ai" onClick={onAsk} loading={loading}>
          <WandSparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Completar con el asistente
        </Button>
      </div>
    )}

    {notice && <Alert tone="warning">{notice}</Alert>}

    {openQuestions.length > 0 && (
      <Alert tone="info" title="Lo que hace falta preguntarle al negocio">
        <ul className="mt-1 space-y-1">
          {openQuestions.map((question) => (
            <li key={question} className="flex gap-2 text-sm">
              <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{question}</span>
            </li>
          ))}
        </ul>
      </Alert>
    )}
  </div>
);

export default FormAssistBar;
