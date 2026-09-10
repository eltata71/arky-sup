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
  const scoreTone = score >= 90 ? 'text-emerald-600' : score >= 80 ? 'text-amber-600' : 'text-red-600';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Validación IA previa: ${artifactName}`}>
      <div className="space-y-4 text-sm">
        <p className="text-gray-600 dark:text-gray-300">Antes de generar el artefacto, validamos consistencia y dependencias para proteger calidad.</p>
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
          <p className="text-xs uppercase text-gray-500">Score estimado de preparación</p>
          <p className={`text-2xl font-bold ${scoreTone}`}>{score}/100</p>
        </div>

        {blockers.length > 0 && (
          <div>
            <h4 className="font-semibold">Bloqueadores</h4>
            <ul className="list-disc list-inside text-gray-600 dark:text-gray-300">
              {blockers.map(item => <li key={item}>{item}</li>)}
            </ul>
          </div>
        )}

        {missingArtifacts.length > 0 && (
          <div>
            <h4 className="font-semibold">Artefactos faltantes requeridos</h4>
            <ul className="list-disc list-inside text-gray-600 dark:text-gray-300">
              {missingArtifacts.map(item => <li key={item}>{item}</li>)}
            </ul>
          </div>
        )}

        {missingInputs.length > 0 && (
          <div>
            <h4 className="font-semibold">Información recomendada</h4>
            <ul className="list-disc list-inside text-gray-600 dark:text-gray-300">
              {missingInputs.map(item => <li key={item}>{item}</li>)}
            </ul>
          </div>
        )}

        <div className="pt-2 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700">Entendido</button>
        </div>
      </div>
    </Modal>
  );
};
