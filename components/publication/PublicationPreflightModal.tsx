import React from 'react';
import { Modal } from '../Modal';
import { Badge } from '../ui';
import type { PublicationPreflightReport } from '../../services/publicationPipeline';
import { scoreTone, severityLabel, severityTone, verdictLabel, verdictTone } from './publicationUi';

interface PublicationPreflightModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: PublicationPreflightReport | null;
}

/**
 * Detailed preflight modal: every finding plus the per-artifact breakdown of
 * the 27-check publication preflight.
 */
export const PublicationPreflightModal: React.FC<PublicationPreflightModalProps> = ({
  isOpen, onClose, report,
}) => (
  <Modal
    isOpen={isOpen}
    onClose={onClose}
    title="Preflight de publicación"
    description="Resultado detallado de las 27 verificaciones de preparación para publicación."
  >
    {!report ? (
      <p className="text-sm text-slate-500 dark:text-slate-400">Aún no se ha ejecutado el preflight.</p>
    ) : (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={verdictTone(report.verdict)} size="sm">{verdictLabel(report.verdict)}</Badge>
          <Badge tone={scoreTone(report.score)} size="sm" outline>{report.score}/100</Badge>
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {report.findings.length} hallazgo(s) · {report.requiredActions.length} acción(es) requerida(s)
          </span>
        </div>

        <section aria-label="Hallazgos del preflight">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Hallazgos</h3>
          {report.findings.length === 0 ? (
            <p className="mt-1 text-sm text-green-700 dark:text-green-300">Sin hallazgos — el paquete superó el preflight.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {report.findings.map((f) => (
                <li key={f.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-white/10 dark:bg-white/[0.03]">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={severityTone(f.severity)} size="xs">{severityLabel(f.severity)}</Badge>
                    {f.blocking && <Badge tone="danger" size="xs" outline>Bloqueante</Badge>}
                    <code className="text-[11px] text-slate-400 dark:text-slate-500">{f.code}</code>
                    {f.artifactName && (
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">· {f.artifactName}</span>
                    )}
                  </div>
                  <p className="mt-1 font-semibold text-slate-900 dark:text-white">{f.message}</p>
                  <p className="mt-0.5 text-slate-600 dark:text-slate-300">{f.recommendation}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {report.artifactResults.length > 0 && (
          <section aria-label="Resultado por artefacto">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Por artefacto</h3>
            <ul className="mt-2 space-y-1.5">
              {report.artifactResults.map((r) => (
                <li key={r.artifactId} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-white/[0.03]">
                  <span className="truncate text-slate-800 dark:text-slate-200">{r.artifactName}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge tone={verdictTone(r.verdict)} size="xs">{verdictLabel(r.verdict)}</Badge>
                    <Badge tone={scoreTone(r.score)} size="xs" outline>{r.score}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    )}
  </Modal>
);
