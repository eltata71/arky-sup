/**
 * La ayuda de la plataforma, abierta desde el raíl.
 *
 * Es el segundo asistente del producto y **no es el equipo de la Oficina**. La
 * diferencia es de propósito y hay que verla en la primera línea: el equipo
 * responde preguntas de arquitectura sobre un registro concreto —una
 * iniciativa, un proyecto, un entregable— y se abre desde ese registro; esto
 * responde «¿cómo funciona esto?» y por eso vive en el raíl, donde no depende
 * de dónde estés parado.
 *
 * Tres decisiones de forma:
 *
 *  - **Un panel, no dos.** El dock del equipo enseña la coordinación al lado de
 *    la conversación, porque ahí hay varios agentes y hay que poder verlos. Aquí
 *    responde uno solo: un panel de coordinación con un único nombre sería
 *    teatro.
 *  - **La respuesta dice de dónde viene.** Cuando el modelo no está disponible
 *    se contesta con los temas del catálogo, marcados como «respuesta de la
 *    guía». Una respuesta enlatada disfrazada de redactada es peor que una que
 *    se declara: la segunda se puede completar preguntando a una persona.
 *  - **Abre con preguntas, no en blanco.** Quien no sabe cómo funciona algo
 *    tampoco sabe cómo preguntarlo.
 */

import React, { useRef, useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import { Badge, Button, Spinner, cn } from '../ui';
import { SafeRichText } from '../ui/SafeRichText';
import { AIArchitectAvatar } from '../ui/AIArchitectIdentity';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { usePlatformGuide } from '../../hooks/usePlatformGuide';
import { PRODUCT_NAME } from '../../lib/eaTerminology';
import type { Settings } from '../../types';

export interface PlatformGuideDockProps {
  open: boolean;
  onClose: () => void;
  settings: Settings;
}

export const PlatformGuideDock: React.FC<PlatformGuideDockProps> = ({ open, onClose, settings }) => {
  const { turns, loading, suggestions, ask } = usePlatformGuide(settings);
  const [input, setInput] = useState('');
  const dialogRef = useFocusTrap<HTMLDivElement>(open);
  const listRef = useRef<HTMLDivElement>(null);

  if (!open) return null;

  const send = (question: string): void => {
    setInput('');
    void ask(question);
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex justify-end bg-gray-950/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Guía de uso de la plataforma"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
        className="flex h-full w-full max-w-xl flex-col bg-white shadow-pop dark:bg-gray-950"
      >
        <header className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-3 dark:border-gray-800">
          <div className="flex min-w-0 items-center gap-3">
            <AIArchitectAvatar size="sm" />
            <div className="min-w-0">
              <p className="text-2xs font-semibold uppercase tracking-widest-2 text-primary-600 dark:text-primary-400">
                Guía de uso · {PRODUCT_NAME}
              </p>
              <h2 className="truncate text-base font-bold text-gray-900 dark:text-gray-50">
                ¿Cómo funciona la plataforma?
              </h2>
            </div>
          </div>
          <Button variant="ghost" size="sm" iconOnly aria-label="Cerrar la guía" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {turns.length === 0 && (
            <div className="rounded-2xl border border-dashed border-gray-300 p-5 dark:border-gray-700">
              <p className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                <BookOpen className="h-4 w-4 shrink-0 text-primary-500" aria-hidden />
                Pregunta cómo se usa el producto: para qué es cada nivel, cómo se crea algo, qué hace
                cada agente.
              </p>
              <p className="mt-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                Para una pregunta de arquitectura sobre un registro concreto, abre el equipo de la
                Oficina desde su iniciativa, su proyecto o su entregable: allí responde el equipo
                completo con el contexto de ese registro.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {suggestions.map((topic) => (
                  <button
                    key={topic.id}
                    type="button"
                    onClick={() => send(topic.question)}
                    className="rounded-lg bg-primary-50 px-2.5 py-1.5 text-left text-2xs font-medium text-primary-700 transition-colors hover:bg-primary-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:bg-primary-950/40 dark:text-primary-300 dark:hover:bg-primary-900/50"
                  >
                    {topic.question}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((turn) => (
            <div key={turn.id} className={cn('flex', turn.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[88%] rounded-2xl px-4 py-2.5 text-sm',
                  turn.role === 'user'
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-100',
                )}
              >
                {turn.role === 'guide'
                  ? <SafeRichText className="prose prose-sm max-w-none dark:prose-invert" markdown={turn.text} />
                  : turn.text}

                {turn.source === 'guide' && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge tone="warning" size="xs">Respuesta de la guía</Badge>
                    {turn.notice && (
                      <span className="text-2xs text-gray-500 dark:text-gray-400">{turn.notice}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400" role="status">
              <Spinner />
              Buscando en la guía…
            </div>
          )}
        </div>

        <form
          className="flex items-end gap-2 border-t border-gray-200 px-5 py-3 dark:border-gray-800"
          onSubmit={(event) => { event.preventDefault(); send(input); }}
        >
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                send(input);
              }
            }}
            rows={2}
            // El nombre accesible y el marcador de posición son el mismo
            // texto a propósito: VoiceOver lee los dos seguidos, y dos frases
            // distintas son el mismo campo leído dos veces. Los ejemplos ya
            // están arriba, como preguntas que se pueden pulsar.
            aria-label="Pregunta sobre el uso de la plataforma"
            placeholder="Pregunta sobre el uso de la plataforma"
            className="min-h-[44px] flex-1 resize-none rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          />
          <Button type="submit" variant="primary" disabled={loading || input.trim().length === 0}>
            Preguntar
          </Button>
        </form>
      </div>
    </div>
  );
};

export default PlatformGuideDock;
