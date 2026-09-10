import React from 'react';
import { Badge, Button } from '../ui';
import {
  publicationTierLabel,
  type PublicationManifest,
} from '../../services/publicationPipeline';
import { ratioPct, scoreTone } from './publicationUi';

interface PublicationManifestViewProps {
  manifest: PublicationManifest | null;
  onGenerate: () => void;
  busy?: boolean;
}

const Field: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-center justify-between gap-3 py-1 text-sm">
    <span className="text-slate-500 dark:text-slate-400">{label}</span>
    <span className="text-right font-medium text-slate-900 dark:text-white">{value}</span>
  </div>
);

/** Manifest view: the auditable record of a published package. */
export const PublicationManifestView: React.FC<PublicationManifestViewProps> = ({
  manifest, onGenerate, busy,
}) => (
  <div className="space-y-4">
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        El manifiesto es el registro auditable de exactamente qué contiene el paquete publicado.
      </p>
      <Button variant="secondary" size="sm" onClick={onGenerate} disabled={busy}
        aria-label="Generar el manifiesto del paquete">
        {busy ? 'Generando…' : 'Generar manifiesto'}
      </Button>
    </div>

    {!manifest ? (
      <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-white/15 dark:text-slate-400">
        Aún no se ha generado un manifiesto para este paquete.
      </p>
    ) : (
      <div className="space-y-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.03]">
          <Field label="Paquete" value={`${manifest.packageId.slice(0, 16)}… v${manifest.packageVersion}`} />
          <Field label="Proyecto" value={manifest.projectName} />
          <Field label="Perfil" value={manifest.profileName} />
          <Field label="Audiencia / propósito" value={`${manifest.audience} · ${manifest.purpose}`} />
          <Field label="Generado" value={manifest.generatedAt.slice(0, 16).replace('T', ' ')} />
          <Field label="Calidad" value={
            <Badge tone={scoreTone(manifest.qualityScore)} size="xs">
              {manifest.qualityScore}/100 · {publicationTierLabel(manifest.qualityTier)}
            </Badge>
          } />
          <Field label="Accesibilidad" value={
            <Badge tone={scoreTone(manifest.accessibilityScore)} size="xs">{manifest.accessibilityScore}/100</Badge>
          } />
          <Field label="Trazabilidad" value={ratioPct(manifest.traceabilityCoverage)} />
          <Field label="Cobertura del grafo" value={ratioPct(manifest.architectureGraphCoverage)} />
          <Field label="Overrides usados" value={String(manifest.audit.overridesUsed)} />
        </div>

        <section aria-label="Artefactos del manifiesto">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            Artefactos ({manifest.artifacts.length})
          </h3>
          <ul className="mt-2 space-y-1">
            {manifest.artifacts.map((a) => (
              <li key={a.artifactId} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-2.5 py-1.5 text-sm dark:bg-white/[0.03]">
                <span className="truncate text-slate-800 dark:text-slate-200">{a.name}</span>
                <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                  {a.type} · v{a.version}{typeof a.qualityScore === 'number' ? ` · ${a.qualityScore}` : ''}
                </span>
              </li>
            ))}
            {manifest.artifacts.length === 0 && (
              <li className="text-sm text-slate-500 dark:text-slate-400">Sin artefactos.</li>
            )}
          </ul>
        </section>

        {manifest.exportedFiles.length > 0 && (
          <section aria-label="Archivos exportados">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Archivos exportados ({manifest.exportedFiles.length})
            </h3>
            <ul className="mt-2 space-y-1 text-sm text-slate-700 dark:text-slate-300">
              {manifest.exportedFiles.map((f, i) => (
                <li key={`${f.filename}-${i}`}>{f.filename} <span className="text-slate-400">({f.format})</span></li>
              ))}
            </ul>
          </section>
        )}
      </div>
    )}
  </div>
);
