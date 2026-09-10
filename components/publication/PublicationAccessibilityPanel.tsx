import React from 'react';
import { Badge } from '../ui';
import type { PublicationAccessibilityReport } from '../../services/publicationPipeline';
import { scoreTone, severityLabel, severityTone, verdictLabel, verdictTone } from './publicationUi';

interface PublicationAccessibilityPanelProps {
  report: PublicationAccessibilityReport;
}

/**
 * Accessibility panel: score, level, blocking verdict and per-issue
 * recommendations derived from the content-level accessibility checks.
 */
export const PublicationAccessibilityPanel: React.FC<PublicationAccessibilityPanelProps> = ({ report }) => (
  <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone={verdictTone(report.verdict)} size="sm">{verdictLabel(report.verdict)}</Badge>
      <Badge tone={scoreTone(report.score)} size="sm" outline>{report.score}/100</Badge>
      <Badge tone="gray" size="sm" outline>Nivel: {report.level}</Badge>
      {report.blocked && <Badge tone="danger" size="sm">No cumple el mínimo</Badge>}
    </div>

    {report.blocked && (
      <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
        El paquete no alcanza el nivel de accesibilidad requerido por el perfil. Resuelve los hallazgos
        marcados como críticos o altos antes de publicar.
      </p>
    )}

    <section aria-label="Hallazgos de accesibilidad">
      <h3 className="text-sm font-bold text-slate-900 dark:text-white">
        Hallazgos ({report.issues.length})
      </h3>
      {report.issues.length === 0 ? (
        <p className="mt-1 text-sm text-green-700 dark:text-green-300">
          No se detectaron problemas de accesibilidad en el contenido.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {report.issues.map((issue) => (
            <li key={issue.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-white/10 dark:bg-white/[0.03]">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={severityTone(issue.severity)} size="xs">{severityLabel(issue.severity)}</Badge>
                <code className="text-[11px] text-slate-400 dark:text-slate-500">{issue.code}</code>
                {issue.artifactName && (
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">· {issue.artifactName}</span>
                )}
              </div>
              <p className="mt-1 font-semibold text-slate-900 dark:text-white">{issue.message}</p>
              <p className="mt-0.5 text-slate-600 dark:text-slate-300">{issue.recommendation}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  </div>
);
