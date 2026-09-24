import React, { useState } from 'react';
import { Badge, Button } from '../ui';
import type {
  PublicationExportBatchResult,
  PublicationExportJob,
  PublicationExportKind,
  PublicationPackage,
  PublicationProfile,
} from '../../services/publicationPipeline';
import type { ExportFormat } from '../../services/export';

interface PublicationExportPanelProps {
  pkg: PublicationPackage;
  profile: PublicationProfile;
  busy?: boolean;
  lastBatch: PublicationExportBatchResult | null;
  onExport: (jobs: PublicationExportJob[]) => void;
}

const DOCUMENT_KINDS: { kind: PublicationExportKind; label: string }[] = [
  { kind: 'report', label: 'Reporte de publicación' },
  { kind: 'manifest', label: 'Manifiesto' },
  { kind: 'executive-summary', label: 'Resumen ejecutivo' },
  { kind: 'quality-evidence', label: 'Evidencia de calidad' },
  { kind: 'traceability-evidence', label: 'Evidencia de trazabilidad' },
];

/**
 * Export panel: coordinates exports through the existing adapters. Lets the
 * user pick which publication documents (and the package artifacts) to export
 * and in which format from the profile's allowed formats.
 */
export const PublicationExportPanel: React.FC<PublicationExportPanelProps> = ({
  pkg, profile, busy, lastBatch, onExport,
}) => {
  const [selectedKinds, setSelectedKinds] = useState<Set<PublicationExportKind>>(
    new Set<PublicationExportKind>(['report', 'manifest']),
  );
  const [includeArtifacts, setIncludeArtifacts] = useState(true);
  const [format, setFormat] = useState<ExportFormat>(
    profile.exportFormats.includes('pdf') ? 'pdf' : profile.exportFormats[0] ?? 'md',
  );

  const toggleKind = (kind: PublicationExportKind): void => {
    setSelectedKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  const buildJobs = (): PublicationExportJob[] => {
    const jobs: PublicationExportJob[] = [];
    for (const { kind } of DOCUMENT_KINDS) {
      if (selectedKinds.has(kind)) {
        jobs.push({ kind, format: kind === 'manifest' && format === 'pdf' ? 'json' : format });
      }
    }
    if (includeArtifacts) {
      for (const ref of pkg.artifactRefs) {
        jobs.push({ kind: 'artifact', format, artifactId: ref.artifactId });
      }
    }
    return jobs;
  };

  const jobs = buildJobs();

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        La exportación reutiliza los exportadores existentes (DOCX, PDF, HTML, Markdown, JSON, XLSX…).
        Cada artefacto se valida con un preflight antes de exportarse.
      </p>

      <fieldset>
        <legend className="text-sm font-bold text-slate-900 dark:text-white">Documentos de publicación</legend>
        <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {DOCUMENT_KINDS.map(({ kind, label }) => (
            <label key={kind} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={selectedKinds.has(kind)}
                onChange={() => toggleKind(kind)}
                className="h-4 w-4 rounded border-slate-300 text-primary-600 focus-visible:ring-2 focus-visible:ring-primary-500"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input
          type="checkbox"
          checked={includeArtifacts}
          onChange={(e) => setIncludeArtifacts(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-primary-600 focus-visible:ring-2 focus-visible:ring-primary-500"
        />
        Incluir los {pkg.artifactRefs.length} artefacto(s) del paquete
      </label>

      <label className="block">
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Formato</span>
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value as ExportFormat)}
          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-white/15 dark:bg-white/[0.04] dark:text-white"
          aria-label="Formato de exportación"
        >
          {profile.exportFormats.map((f) => (
            <option key={f} value={f}>{f.toUpperCase()}</option>
          ))}
        </select>
      </label>

      <Button variant="primary" size="sm" disabled={busy || jobs.length === 0}
        onClick={() => onExport(jobs)}
        aria-label="Exportar la selección de publicación">
        {busy ? 'Exportando…' : `Exportar (${jobs.length} archivo${jobs.length === 1 ? '' : 's'})`}
      </Button>

      {lastBatch && (
        <section aria-label="Resultado de la última exportación">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            Última exportación
            <Badge tone={lastBatch.allSucceeded ? 'success' : 'danger'} size="xs" className="ml-2">
              {lastBatch.allSucceeded ? 'Completa' : 'Con fallos'}
            </Badge>
          </h3>
          <ul className="mt-2 space-y-1 text-sm">
            {lastBatch.outcomes.map((o, i) => (
              <li key={`${o.job.kind}-${i}`} className="flex items-center justify-between gap-3">
                <span className="truncate text-slate-700 dark:text-slate-300">
                  {o.job.kind} · {o.job.format}
                </span>
                <Badge tone={o.success ? 'success' : 'danger'} size="xs">
                  {o.success ? (o.filename ?? 'OK') : (o.error ?? 'Error')}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};
