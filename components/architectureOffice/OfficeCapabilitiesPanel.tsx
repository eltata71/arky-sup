import React, { useMemo } from 'react';
import type { Project } from '../../context/AppContext';
import { Badge } from '../ui';
import { InitiativePicker } from '../businessInitiatives/InitiativePicker';
import type { BusinessInitiative } from '../../context/InitiativeContext';
import { describeOfficeCapabilities } from '../../services/architectureOffice';
import { useAttentionInitiativeLinks } from '../../hooks/useAttentionInitiatives';

interface OfficeCapabilitiesPanelProps {
  project: Project;
  /** Every initiative the user may link this attention to. */
  initiatives: BusinessInitiative[];
  /**
   * Persists the link. Receives both halves: the canonical ids and the code
   * mirror derived from them, so the two can never drift apart.
   */
  onChangeInitiativeLinks: (links: { initiativeIds: string[]; codes: string[] }) => void;
}


const toneFor = (status: 'pass' | 'conditional' | 'blocked'): 'success' | 'warning' | 'danger' =>
  status === 'pass' ? 'success' : status === 'conditional' ? 'warning' : 'danger';

export const OfficeCapabilitiesPanel: React.FC<OfficeCapabilitiesPanelProps> = ({
  project,
  initiatives,
  onChangeInitiativeLinks,
}) => {
  const capabilities = useMemo(() => describeOfficeCapabilities(project), [project]);
  // Ids win; a legacy code is honoured only while nothing has migrated it —
  // `services/portfolioGraph` decides, so the picker shows what the rest of
  // the app already believes.
  const links = useAttentionInitiativeLinks(project, initiatives, onChangeInitiativeLinks);

  return (
    <section
      className="rounded-3xl border border-primary-200 bg-primary-50/70 p-4 shadow-sm dark:border-primary-500/25 dark:bg-primary-500/10"
      aria-labelledby="office-capabilities-title"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-primary-600 dark:text-primary-300">Capacidades integradas</p>
          <h2 id="office-capabilities-title" className="mt-1 text-base font-black text-slate-950 dark:text-white">Oficina de Arquitectura</h2>
        </div>
        <Badge tone={toneFor(capabilities.overallStatus)} size="xs" dot>
          {capabilities.overallStatus.toUpperCase()}
        </Badge>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Cobertura de capacidades">
        <Badge tone="ai" size="xs">{capabilities.counts.personas} personas</Badge>
        <Badge tone="info" size="xs">{capabilities.counts.validators} validadores</Badge>
        <Badge tone="primary" size="xs">{capabilities.counts.gates} quality gates</Badge>
        <Badge tone="gray" size="xs">{capabilities.counts.standards} estándares</Badge>
      </div>

      <details className="mt-4 rounded-2xl bg-white/80 p-3 dark:bg-black/20">
        <summary className="cursor-pointer text-sm font-bold text-slate-800 dark:text-slate-100">Estado de quality gates</summary>
        {/*
          The gate evaluation computes `blockers`, `conditions` and the
          artifacts that evidence each gate. Rendering only the status left the
          reviewer with a colour and no reason, so the reasons are shown here.
        */}
        <ul className="mt-3 space-y-2">
          {capabilities.gates.map((gate) => (
            <li key={gate.id} className="space-y-1 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-700 dark:text-slate-200">{gate.label}</span>
                <Badge tone={toneFor(gate.status)} size="xs">{gate.status.toUpperCase()}</Badge>
              </div>
              {gate.blockers.map((blocker) => (
                <p key={blocker} className="leading-snug text-rose-700 dark:text-rose-300">{blocker}</p>
              ))}
              {gate.conditions.map((condition) => (
                <p key={condition} className="leading-snug text-amber-700 dark:text-amber-300">{condition}</p>
              ))}
              {gate.evidenceArtifactIds.length > 0 && (
                <p className="text-slate-500 dark:text-slate-400">
                  Evidencia: {gate.evidenceArtifactIds.length} artefacto(s)
                </p>
              )}
            </li>
          ))}
        </ul>
      </details>

      <div className="mt-4">
        <InitiativePicker
          initiatives={initiatives}
          value={links.linkedIds}
          onChange={links.applyLinks}
          unresolvedCodes={links.unresolvedCodes}
          onDropUnresolvedCode={links.dropUnresolvedCode}
        />
      </div>
    </section>
  );
};

export default OfficeCapabilitiesPanel;
