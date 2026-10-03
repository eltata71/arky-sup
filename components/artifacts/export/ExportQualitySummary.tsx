import React from 'react';
import {
  describeQualityTier,
  type ArtifactQualityGateResult,
  type assessExportability,
} from '../../../services/artifacts/application/artifactAssessment';

export const RISK_META: Record<ArtifactQualityGateResult['risk'], { label: string; tone: string }> = {
  none: { label: 'Sin riesgo', tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  low: { label: 'Riesgo bajo', tone: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' },
  medium: { label: 'Riesgo medio', tone: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  high: { label: 'Riesgo alto', tone: 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
  critical: { label: 'Riesgo crítico', tone: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
};

const scoreTone = (score: number): string =>
  score >= 90 ? 'text-emerald-600 dark:text-emerald-400'
    : score >= 75 ? 'text-blue-600 dark:text-blue-400'
      : score >= 60 ? 'text-amber-600 dark:text-amber-400'
        : 'text-red-600 dark:text-red-400';

export interface ExportQualitySummaryProps {
  assessment: ReturnType<typeof assessExportability>;
}

/** La calidad formal y la exportabilidad por categoría (salió de `ArtifactExportModal` en 9.4). */
export const ExportQualitySummary: React.FC<ExportQualitySummaryProps> = ({ assessment }) => {
  const { report, state } = assessment;
  return (
    <>
      {/* Formal quality summary */}
      <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
          <span className="block text-gray-500 dark:text-gray-400">Calidad global</span>
          <strong className={`text-base ${scoreTone(report.score.value)}`}>{report.score.unmeasured ? 'Sin medir' : `${report.score.value}/100`}</strong>
          <span className="block text-[10px] text-gray-500 dark:text-gray-400">{describeQualityTier(report.score.tier)}</span>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
          <span className="block text-gray-500 dark:text-gray-400">Documento</span>
          <strong className={report.document ? scoreTone(report.document.score) : 'text-gray-400'}>
            {report.document ? `${report.document.score}/100` : 'N/A'}
          </strong>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
          <span className="block text-gray-500 dark:text-gray-400">Diagrama</span>
          <strong className={report.diagram ? scoreTone(report.diagram.score) : 'text-gray-400'}>
            {report.diagram ? `${report.diagram.score}/100` : 'N/A'}
          </strong>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
          <span className="block text-gray-500 dark:text-gray-400">Tablas</span>
          <strong className={report.tables ? 'text-gray-900 dark:text-white' : 'text-gray-400'}>
            {report.tables ? `${report.tables.count} · ${(report.tables.completeness * 100).toFixed(0)}%` : 'N/A'}
          </strong>
        </div>
      </div>

      {/* Per-category exportability */}
      <section aria-label="Exportabilidad por categoría" className="mb-4 space-y-1.5">
        {(['document', 'diagram', 'table'] as const).map((family) => {
          const gate = state[family];
          const meta = RISK_META[gate.risk];
          const familyLabel = family === 'document' ? 'Documento' : family === 'diagram' ? 'Diagrama' : 'Tablas';
          return (
            <div key={family} className={`text-[11px] rounded-md px-2.5 py-1.5 flex items-center justify-between gap-2 ${meta.tone}`}>
              <span><strong>{familyLabel}:</strong> {gate.message}</span>
              <span className="font-semibold whitespace-nowrap">{gate.passed ? meta.label : 'Bloqueado'}</span>
            </div>
          );
        })}
      </section>
    </>
  );
};

export default ExportQualitySummary;
