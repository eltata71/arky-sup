/**
 * The initiative gate: an architecture attention cannot be opened without the
 * business need it answers.
 *
 * Every way of creating an attention passes through here — guided creation,
 * document analysis and templates alike — because a gate that only covers some
 * of the doors is not a gate. The chosen initiatives ride along with the
 * creation write, so an attention never exists, even briefly, with no declared
 * reason.
 *
 * When there is no initiative registered yet the dialog does not let the user
 * improvise one: it sends them to the screen that creates initiatives, which is
 * the level above and has its own intake, KPIs and assistant.
 */

import React, { useEffect, useState } from 'react';
import { Modal } from '../Modal';
import { Alert, Button } from '../ui';
import { InitiativePicker } from '../businessInitiatives/InitiativePicker';
import { codesForInitiativeIds } from '../../services/portfolioGraph';
import { EA_LEVELS } from '../../lib/eaTerminology';
import type { BusinessInitiative } from '../../services/businessInitiatives';

export interface AttentionInitiativeGateProps {
  open: boolean;
  initiatives: BusinessInitiative[];
  /** What the user asked to do, named so the dialog explains itself. */
  intent: string;
  onContinue: (links: { initiativeIds: string[]; codes: string[] }) => void;
  onCreateInitiative: () => void;
  onClose: () => void;
}

export const AttentionInitiativeGate: React.FC<AttentionInitiativeGateProps> = ({
  open,
  initiatives,
  intent,
  onContinue,
  onCreateInitiative,
  onClose,
}) => {
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (open) setSelected([]);
  }, [open]);

  if (!open) return null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="¿Qué necesidad de negocio atiende?"
      description={`Antes de ${intent}, indica la iniciativa de negocio que la origina.`}
    >
      <div className="space-y-4">
        <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-xl bg-gray-50 px-3 py-2 text-2xs font-medium text-gray-500 dark:bg-gray-800/60 dark:text-gray-400">
          <li className={selected.length > 0 ? 'text-primary-600 dark:text-primary-400' : undefined}>
            1 · {EA_LEVELS.initiative.singular}
          </li>
          <li aria-hidden>›</li>
          <li className="text-gray-900 dark:text-gray-100">2 · {EA_LEVELS.engagementProject.singular}</li>
        </ol>

        {initiatives.length === 0 ? (
          <Alert tone="warning">
            <p className="font-medium">Todavía no hay iniciativas de negocio registradas.</p>
            <p className="mt-1 text-xs leading-relaxed">
              Un proyecto de arquitectura es la respuesta a una necesidad del negocio, así que la
              necesidad va primero. Regístrala y vuelve para abrir el proyecto que la atiende.
            </p>
            <Button className="mt-2" size="sm" variant="primary" onClick={onCreateInitiative}>
              Registrar iniciativa de negocio
            </Button>
          </Alert>
        ) : (
          <InitiativePicker
            initiatives={initiatives}
            value={selected}
            onChange={setSelected}
            label="Iniciativa de negocio que atiende (obligatorio)"
            hint="Se guarda por llave, nunca por el código escrito a mano. Puedes atender más de una."
          />
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          {initiatives.length > 0 ? (
            <button
              type="button"
              onClick={onCreateInitiative}
              className="text-xs font-medium text-primary-600 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-400"
            >
              Registrar una iniciativa nueva
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button
              variant="primary"
              disabled={selected.length === 0}
              onClick={() => onContinue({
                initiativeIds: selected,
                codes: codesForInitiativeIds(selected, initiatives),
              })}
            >
              Continuar
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default AttentionInitiativeGate;
