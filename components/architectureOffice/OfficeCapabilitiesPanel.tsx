import React, { useMemo } from 'react';
import type { Project } from '../../context/AppContext';
import { Badge } from '../ui';
import { InitiativePicker } from '../businessInitiatives/InitiativePicker';
import { codesForInitiativeIds } from '../../services/portfolioGraph';
import type { BusinessInitiative } from '../../services/businessInitiatives/BusinessInitiativeTypes';
import { OFFICE_AGENT_PERSONAS } from '../../services/architectureOffice/officeAgentPersonas';
import { OFFICE_VALIDATORS } from '../../services/architectureOffice/officeArtifactValidators';
import { evaluateOfficeQualityGates, OFFICE_GATE_LABELS } from '../../services/architectureOffice/officeQualityGates';
import { getOfficeArchitectureContext } from '../../services/architectureOffice/officeArchitectureKnowledge';
import { isInitiativeCode } from '../../lib/eaTerminology';

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
  const assessment = useMemo(() => evaluateOfficeQualityGates(project), [project]);
  const officeContext = getOfficeArchitectureContext();

  /**
   * Ids win; a legacy code is honoured only while nothing has migrated it yet,
   * exactly as `portfolioGraph` resolves them. Doing it here too keeps the
   * picker showing what the rest of the app already believes.
   */
  const linkedIds = useMemo(() => {
    const stored = project.initiativeIds ?? [];
    if (stored.length > 0) return stored;
    const byCode = new Map<string, string>(initiatives.filter((item) => item.code).map((item) => [item.code, item.id]));
    return (project.linkedBusinessProjects ?? [])
      .map((code) => byCode.get(code))
      .filter((id): id is string => Boolean(id));
  }, [project.initiativeIds, project.linkedBusinessProjects, initiatives]);

  const unresolvedCodes = useMemo(() => {
    const known = new Set(initiatives.map((item) => item.code).filter(Boolean));
    return (project.linkedBusinessProjects ?? [])
      .filter((code) => isInitiativeCode(code) && !known.has(code));
  }, [project.linkedBusinessProjects, initiatives]);

  const applyLinks = (initiativeIds: string[]): void => {
    // Both halves move together: the ids are the relation, the codes are the
    // label people read. Writing one without the other is how they drift.
    onChangeInitiativeLinks({
      initiativeIds,
      codes: codesForInitiativeIds(initiativeIds, initiatives),
    });
  };

  const dropUnresolvedCode = (code: string): void => {
    onChangeInitiativeLinks({
      initiativeIds: linkedIds,
      codes: (project.linkedBusinessProjects ?? []).filter((current) => current !== code),
    });
  };

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
        <Badge tone={toneFor(assessment.overallStatus)} size="xs" dot>
          {assessment.overallStatus.toUpperCase()}
        </Badge>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Cobertura de capacidades">
        <Badge tone="ai" size="xs">{Object.keys(OFFICE_AGENT_PERSONAS).length} personas</Badge>
        <Badge tone="info" size="xs">{OFFICE_VALIDATORS.length} validadores</Badge>
        <Badge tone="primary" size="xs">{assessment.gates.length} quality gates</Badge>
        <Badge tone="gray" size="xs">{officeContext.standards.length} estándares</Badge>
      </div>

      <details className="mt-4 rounded-2xl bg-white/80 p-3 dark:bg-black/20">
        <summary className="cursor-pointer text-sm font-bold text-slate-800 dark:text-slate-100">Estado de quality gates</summary>
        {/*
          The gate evaluation computes `blockers`, `conditions` and the
          artifacts that evidence each gate. Rendering only the status left the
          reviewer with a colour and no reason, so the reasons are shown here.
        */}
        <ul className="mt-3 space-y-2">
          {assessment.gates.map((gate) => (
            <li key={gate.id} className="space-y-1 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-700 dark:text-slate-200">{OFFICE_GATE_LABELS[gate.id]}</span>
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
          value={linkedIds}
          onChange={applyLinks}
          unresolvedCodes={unresolvedCodes}
          onDropUnresolvedCode={dropUnresolvedCode}
        />
      </div>
    </section>
  );
};

export default OfficeCapabilitiesPanel;
