/**
 * Links an architecture attention to the business initiatives it answers.
 *
 * The picker is the only way to create the relation, and it can only emit ids
 * of initiatives that exist — the `NEG-YYYY-NNN` codes written alongside are a
 * derived mirror kept for the people who quote them in a steering meeting, and
 * are recomputed here rather than typed.
 */

import React, { useEffect, useState } from 'react';
import { Modal } from '../Modal';
import { Button } from '../ui';
import { InitiativePicker } from '../businessInitiatives/InitiativePicker';
import { codesForInitiativeIds } from '../../services/portfolioGraph';
import type { BusinessInitiative } from '../../services/businessInitiatives';
import type { Project } from '../../types';

export interface LinkInitiativeModalProps {
  project: Project | null;
  initiatives: BusinessInitiative[];
  onClose: () => void;
  onSave: (projectId: string, links: { initiativeIds: string[]; codes: string[] }) => void;
  /** Offered when there is no initiative to link to yet. */
  onCreateInitiative?: () => void;
}

export const LinkInitiativeModal: React.FC<LinkInitiativeModalProps> = ({
  project,
  initiatives,
  onClose,
  onSave,
  onCreateInitiative,
}) => {
  const [selected, setSelected] = useState<string[]>([]);
  const [droppedCodes, setDroppedCodes] = useState<string[]>([]);

  useEffect(() => {
    setSelected(project?.initiativeIds ?? []);
    setDroppedCodes([]);
  }, [project]);

  if (!project) return null;

  /** Codes on the record that match no registered initiative — shown, not hidden. */
  const known = new Set<string>(initiatives.map((initiative) => initiative.code));
  const unresolvedCodes = (project.linkedBusinessProjects ?? [])
    .filter((code) => !known.has(code) && !droppedCodes.includes(code));

  const save = (): void => {
    const codes = codesForInitiativeIds(selected, initiatives);
    // Unresolved codes survive unless the user explicitly dropped them: a link
    // we cannot resolve is still a link somebody recorded on purpose.
    onSave(project.id, {
      initiativeIds: selected,
      codes: [...new Set([...codes, ...unresolvedCodes])],
    });
    onClose();
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Iniciativa de negocio que atiende"
      description={`Relaciona «${project.name}» con la necesidad de negocio que responde.`}
    >
      <div className="space-y-4">
        {initiatives.length === 0 ? (
          <div className="rounded-xl bg-amber-50 px-4 py-4 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <p className="font-medium">Todavía no hay iniciativas de negocio registradas.</p>
            <p className="mt-1 text-xs leading-relaxed">
              La jerarquía empieza en la necesidad del negocio: registra primero la iniciativa y
              vuelve aquí para relacionarla.
            </p>
            {onCreateInitiative && (
              <Button className="mt-3" size="sm" variant="primary" onClick={onCreateInitiative}>
                Registrar iniciativa de negocio
              </Button>
            )}
          </div>
        ) : (
          <InitiativePicker
            initiatives={initiatives}
            value={selected}
            onChange={setSelected}
            unresolvedCodes={unresolvedCodes}
            onDropUnresolvedCode={(code) => setDroppedCodes((prev) => [...prev, code])}
          />
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={save} disabled={initiatives.length === 0}>
            Guardar relación
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default LinkInitiativeModal;
