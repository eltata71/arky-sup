import React from 'react';
import { Badge, Button } from '../ui';
import type {
  PublicationProfile,
  PublicationReadinessReport,
} from '../../services/publicationPipeline';
import { publicationTierLabel } from '../../services/publicationPipeline';
import { scoreTone, severityLabel, severityTone, verdictLabel, verdictTone, ratioPct } from './publicationUi';

interface PublicationReadinessPanelProps {
  readiness: PublicationReadinessReport;
  profile: PublicationProfile;
  onRecalc: () => void;
  busy?: boolean;
}

const Metric: React.FC<{ label: string; value: string; tone?: 'success' | 'warning' | 'danger' | 'gray' }> = ({
  label, value, tone = 'gray',
}) => (
  <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.03]">
    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{label}</p>
    <p className={
      tone === 'success' ? 'mt-1 text-lg font-black text-green-600 dark:text-green-300'
        : tone === 'warning' ? 'mt-1 text-lg font-black text-amber-600 dark:text-amber-300'
          : tone === 'danger' ? 'mt-1 text-lg font-black text-red-600 dark:text-red-300'
            : 'mt-1 text-lg font-black text-slate-900 dark:text-white'
    }>{value}</p>
  </div>
);

/**
 * Readiness summary panel: aggregate score, per-dimension metrics, blockers,
 * warnings, profile coverage and recommendations. Severity is always shown as
 * text + colour (never colour alone).
 */
export const PublicationReadinessPanel: React.FC<PublicationReadinessPanelProps> = ({
  readiness, profile, onRecalc, busy,
}) => (
  <div className="space-y-4">
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          Veredicto de readiness
        </p>
        <div className="mt-1 flex items-center gap-2">
          <Badge tone={verdictTone(readiness.status)} size="sm">{verdictLabel(readiness.status)}</Badge>
          <Badge tone={scoreTone(readiness.score)} size="sm" outline>
            {readiness.score}/100 · {publicationTierLabel(readiness.tier)}
          </Badge>
        </div>
      </div>
      <Button variant="secondary" size="sm" onClick={onRecalc} disabled={busy}
        aria-label="Recalcular el preflight y la readiness del paquete">
        {busy ? 'Recalculando…' : 'Recalcular'}
      </Button>
    </div>

    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Metric label="Calidad" value={`${readiness.qualityResults.score}`}
        tone={scoreTone(readiness.qualityResults.score) === 'danger' ? 'danger' : scoreTone(readiness.qualityResults.score) === 'warning' ? 'warning' : 'success'} />
      <Metric label="Accesibilidad" value={`${readiness.accessibilityResults.score}`}
        tone={scoreTone(readiness.accessibilityResults.score) === 'danger' ? 'danger' : scoreTone(readiness.accessibilityResults.score) === 'warning' ? 'warning' : 'success'} />
      <Metric label="Trazabilidad req." value={ratioPct(readiness.traceabilityResults.requirementCoverage)} />
      <Metric label="Cobertura grafo" value={ratioPct(readiness.traceabilityResults.graphCoverage)} />
    </div>

    <section aria-label="Bloqueadores">
      <h3 className="text-sm font-bold text-slate-900 dark:text-white">
        Bloqueadores ({readiness.blockers.length})
      </h3>
      {readiness.blockers.length === 0 ? (
        <p className="mt-1 text-sm text-green-700 dark:text-green-300">Sin bloqueadores críticos.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {readiness.blockers.map((b) => (
            <li key={b.id} className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900/50 dark:bg-red-950/30">
              <div className="flex items-center gap-2">
                <Badge tone={severityTone(b.severity)} size="xs">{severityLabel(b.severity)}</Badge>
                <span className="font-semibold text-red-800 dark:text-red-200">{b.message}</span>
              </div>
              <p className="mt-1 text-red-700 dark:text-red-300">{b.recommendation}</p>
            </li>
          ))}
        </ul>
      )}
    </section>

    <section aria-label="Advertencias">
      <h3 className="text-sm font-bold text-slate-900 dark:text-white">
        Advertencias ({readiness.warnings.length})
      </h3>
      {readiness.warnings.length === 0 ? (
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Sin advertencias.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {readiness.warnings.slice(0, 10).map((w) => (
            <li key={w.id} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
              <Badge tone={severityTone(w.severity)} size="xs">{severityLabel(w.severity)}</Badge>
              <span>{w.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>

    <section aria-label="Cobertura del perfil">
      <h3 className="text-sm font-bold text-slate-900 dark:text-white">
        Cobertura del perfil — {profile.name}
      </h3>
      <ul className="mt-2 space-y-1.5">
        {readiness.coverageResults.map((c) => (
          <li key={c.requirementId} className="flex items-start gap-2 text-sm">
            <Badge tone={c.satisfied ? 'success' : c.required ? 'danger' : 'warning'} size="xs">
              {c.satisfied ? 'Cubierto' : c.required ? 'Falta' : 'Opcional'}
            </Badge>
            <span className="text-slate-700 dark:text-slate-300">
              <span className="font-semibold text-slate-900 dark:text-white">{c.label}</span> — {c.message}
            </span>
          </li>
        ))}
        {readiness.coverageResults.length === 0 && (
          <li className="text-sm text-slate-500 dark:text-slate-400">El perfil no define requisitos de artefactos.</li>
        )}
      </ul>
    </section>

    {readiness.recommendations.length > 0 && (
      <section aria-label="Recomendaciones">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Recomendaciones</h3>
        <ul className="mt-2 space-y-1.5">
          {readiness.recommendations.slice(0, 10).map((r) => (
            <li key={r.id} className="text-sm text-slate-700 dark:text-slate-300">
              <span className="font-semibold text-slate-900 dark:text-white">{r.title}</span> — {r.detail}
            </li>
          ))}
        </ul>
      </section>
    )}
  </div>
);
