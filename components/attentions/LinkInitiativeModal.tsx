import { useUiTranslation } from '../../lib/i18n/UiTranslationContext';
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
import type { Project } from '../../context/AppContext';

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
  const t = useUiTranslation();
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
      title={t("ui.iniciativa-de-negocio-que-at.78a12d")}
      description={`Relaciona «${project.name}» con la necesidad de negocio que responde.`}
    >
      <div className="space-y-4">
        {initiatives.length === 0 ? (
          <div className="rounded-xl bg-amber-50 px-4 py-4 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <p className="font-medium">{t("ui.todavia-no-hay-iniciativas-d.af4c09")}</p>
            <p className="mt-1 text-xs leading-relaxed">
              {t("ui.la-jerarquia-empieza-en-la-n.4d29c2")}
            </p>
            {onCreateInitiative && (
              <Button className="mt-3" size="sm" variant="primary" onClick={onCreateInitiative}>
                {t("ui.registrar-iniciativa-de-nego.b9d36e")}
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
          <Button variant="ghost" onClick={onClose}>{t("ui.cancelar.c111e0")}</Button>
          <Button variant="primary" onClick={save} disabled={initiatives.length === 0}>
            {t("ui.guardar-relacion.304b6d")}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default LinkInitiativeModal;
