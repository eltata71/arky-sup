/**
 * La motivación de una iniciativa: por qué existe.
 *
 * Salió de `InitiativeRoom` cuando la sala ganó la asistencia de captura, y la
 * separación resultó ser la buena: la sala orquesta —carga, guarda, navega— y
 * cada sección es una unidad completa que se puede leer sola.
 *
 * Una regla del producto vive aquí y conviene no perderla al editar: **la
 * necesidad del negocio se muestra, no se edita**. Es lo que dijo el negocio y
 * es el registro. El driver sí es del arquitecto —es su lectura de la presión
 * que hay detrás— y por eso es el campo que tiene ayuda del asistente.
 */

import React, { useState } from 'react';
import { Badge, Card, CardTitle, Input } from '../ui';
import { CaptureAssist } from '../capture';
import type { CaptureAssistantApi } from '../../hooks/useCaptureAssistant';
import type { CaptureContext } from '../../lib/capture';
import { INITIATIVE_SECTION_ICONS } from './initiativeUiLabels';
import type { BusinessInitiative, InitiativeCommand } from '../../services/businessInitiatives';

export interface InitiativeMotivationPanelProps {
  initiative: BusinessInitiative;
  /** Una operación con nombre (F3-05): reformular el motivo, o mover las fechas. */
  onCommand: (command: InitiativeCommand) => void;
  busy?: boolean;
  assist?: { assistant: CaptureAssistantApi; context: CaptureContext | null };
}

export const InitiativeMotivationPanel: React.FC<InitiativeMotivationPanelProps> = ({
  initiative,
  onCommand,
  busy,
  assist,
}) => {
  /*
   * El borrador local existe porque el driver se guarda al salir del campo, no
   * en cada pulsación: una escritura por tecla contra Firestore es una factura
   * y una condición de carrera. `null` significa «no hay edición en curso».
   */
  const [driverDraft, setDriverDraft] = useState<string | null>(null);
  const MotivationIcon = INITIATIVE_SECTION_ICONS.motivation;

  return (
      <Card id="motivacion" className="scroll-mt-20 space-y-3">
        <div className="flex items-start gap-2.5">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-950/50 dark:text-primary-300">
            <MotivationIcon className="h-4 w-4" aria-hidden strokeWidth={2} />
          </span>
          <div>
            <CardTitle>Motivación</CardTitle>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Por qué existe la iniciativa. Lo que dijo el negocio se conserva sin cambios.
            </p>
          </div>
        </div>

        <div>
          <p className="text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400">
            Necesidad del negocio
          </p>
          <p className="mt-1 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm leading-relaxed text-gray-700 dark:bg-gray-900/50 dark:text-gray-200">
            {initiative.need || 'Sin descripción.'}
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="initiative-driver"
              className="text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400"
            >
              Driver — la presión que la origina
            </label>
            {assist && (
              <CaptureAssist
                fieldId="initiative.driver"
                assistant={assist.assistant}
                context={assist.context}
                current={driverDraft ?? initiative.driver}
                apply={(value) => {
                  // Se escribe en el borrador y se guarda: aceptar una
                  // propuesta es una decisión explícita, y dejarla sólo en el
                  // campo obligaría a un segundo gesto para conservarla.
                  setDriverDraft(null);
                  onCommand({ kind: 'restate-driver', driver: value });
                }}
              />
            )}
          </div>
          <textarea
            id="initiative-driver"
            value={driverDraft ?? initiative.driver}
            onChange={(event) => setDriverDraft(event.target.value)}
            onBlur={() => {
              if (driverDraft !== null && driverDraft !== initiative.driver) {
                onCommand({ kind: 'restate-driver', driver: driverDraft });
              }
              setDriverDraft(null);
            }}
            rows={3}
            placeholder="Ej. La regulación exige respuesta en 48 h y hoy el proceso tarda 5 días."
            className="mt-1 w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm leading-relaxed text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          />
        </div>

        {initiative.affectedCapabilities.length > 0 && (
          <div>
            <p className="text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400">
              Capacidades de negocio afectadas
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {initiative.affectedCapabilities.map((capability) => (
                <Badge key={capability} tone="info" size="xs" outline>{capability}</Badge>
              ))}
            </div>
          </div>
        )}

        {initiative.regulatoryDrivers.length > 0 && (
          <div>
            <p className="text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400">
              Marco regulatorio
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {initiative.regulatoryDrivers.map((driver) => (
                <Badge key={driver} tone="warning" size="xs" outline className="max-w-full whitespace-normal text-left">
                  {driver}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-3 border-t border-gray-100 pt-3 sm:grid-cols-2 dark:border-gray-800">
          <div>
            <label htmlFor="initiative-start-date" className="text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400">
              Inicio previsto
            </label>
            <Input
              id="initiative-start-date"
              type="date"
              className="mt-1"
              value={initiative.startDate?.slice(0, 10) ?? ''}
              onChange={(event) => onCommand({ kind: 'reschedule', startDate: event.target.value || null })}
              disabled={busy}
            />
          </div>
          <div>
            <label htmlFor="initiative-target-date" className="text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400">
              Fecha objetivo
            </label>
            <Input
              id="initiative-target-date"
              type="date"
              className="mt-1"
              value={initiative.targetEndDate?.slice(0, 10) ?? ''}
              onChange={(event) => onCommand({ kind: 'reschedule', targetEndDate: event.target.value || null })}
              disabled={busy}
            />
          </div>
        </div>
      </Card>
  );
};

export default InitiativeMotivationPanel;
