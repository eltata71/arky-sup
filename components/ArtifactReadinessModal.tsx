import { useUiTranslation } from '../lib/i18n/UiTranslationContext';
import React from 'react';
import { Modal } from './Modal';

interface Props {
  isOpen: boolean;
  artifactName: string;
  score: number;
  missingArtifacts: string[];
  missingInputs: string[];
  blockers: string[];
  onClose: () => void;
}

export const ArtifactReadinessModal: React.FC<Props> = ({ isOpen, artifactName, score, missingArtifacts, missingInputs, blockers, onClose }) => {
  const t = useUiTranslation();
  const scoreTone = score >= 90 ? 'text-emerald-600' : score >= 80 ? 'text-amber-600' : 'text-red-600';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("uiTemplate.validacion-ia-previa-p0.9f15ed", { p0: String(artifactName) })}>
      <div className="space-y-4 text-sm">
        <p className="text-gray-600 dark:text-gray-300">{t("ui.antes-de-generar-el-artefact.1db598")}</p>
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
          <p className="text-xs uppercase text-gray-500">{t("ui.score-estimado-de-preparacio.7a8cba")}</p>
          <p className={`text-2xl font-bold ${scoreTone}`}>{score}/100</p>
        </div>

        {blockers.length > 0 && (
          <div>
            <h4 className="font-semibold">{t("ui.bloqueadores.2c247b")}</h4>
            <ul className="list-disc list-inside text-gray-600 dark:text-gray-300">
              {blockers.map(item => <li key={item}>{item}</li>)}
            </ul>
          </div>
        )}

        {missingArtifacts.length > 0 && (
          <div>
            <h4 className="font-semibold">{t("ui.artefactos-faltantes-requeri.3b3b5c")}</h4>
            <ul className="list-disc list-inside text-gray-600 dark:text-gray-300">
              {missingArtifacts.map(item => <li key={item}>{item}</li>)}
            </ul>
          </div>
        )}

        {missingInputs.length > 0 && (
          <div>
            <h4 className="font-semibold">{t("ui.informacion-recomendada.55522b")}</h4>
            <ul className="list-disc list-inside text-gray-600 dark:text-gray-300">
              {missingInputs.map(item => <li key={item}>{item}</li>)}
            </ul>
          </div>
        )}

        <div className="pt-2 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700">{t("ui.entendido.ee24e6")}</button>
        </div>
      </div>
    </Modal>
  );
};
