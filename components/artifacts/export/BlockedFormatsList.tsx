import React from 'react';
import type { ArtifactQualityGateResult, ExportFormat, ExportFormatOption } from '../../../services/artifacts/application/artifactAssessment';

export interface BlockedFormatsListProps {
  unavailable: ExportFormatOption[];
  gateByFormat: ReadonlyMap<ExportFormat, ArtifactQualityGateResult>;
}

/** Los formatos que no se ofrecen, con el motivo de cada uno (salió de `ArtifactExportModal` en 9.4). */
export const BlockedFormatsList: React.FC<BlockedFormatsListProps> = ({ unavailable, gateByFormat }) => {
  if (unavailable.length === 0) return null;
  return (
    <details className="mt-4 text-xs text-gray-600 dark:text-gray-300">
      <summary className="cursor-pointer font-medium">
        Formatos bloqueados ({unavailable.length})
      </summary>
      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {unavailable.map((option) => {
          const gate = gateByFormat.get(option.format);
          const reason = !option.enabled
            ? option.reason ?? 'No aplica para el contenido disponible.'
            : gate?.blockers[0]?.message ?? 'Bloqueado por el quality gate.';
          return (
            <div key={option.format} className="rounded-md border border-gray-200 dark:border-gray-700 p-2 opacity-80">
              <strong>{option.label}</strong>
              <p className="mt-0.5">{reason}</p>
              {gate?.blockers[0]?.recommendation && (
                <p className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400">{gate.blockers[0].recommendation}</p>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
};

export default BlockedFormatsList;
