/**
 * What the Office brings to one attention, as its capabilities panel shows it
 * (F5-02).
 *
 * `OfficeCapabilitiesPanel` reached four files of this module to assemble it —
 * the personas, the validators, the gate evaluation with its labels, and the
 * standards — which made it one of the screens over the UI fan-out. The
 * composition is a read model, not rendering, so it lives here and the panel
 * calls it once.
 */
import type { Project } from '../../architectureProjects';
import { OFFICE_AGENT_PERSONAS } from '../officeAgentPersonas';
import { OFFICE_VALIDATORS } from '../officeArtifactValidators';
import { getOfficeArchitectureContext } from '../officeArchitectureKnowledge';
import {
  evaluateOfficeQualityGates,
  OFFICE_GATE_LABELS,
  type OfficeQualityAssessment,
  type OfficeQualityGateResult,
} from '../officeQualityGates';

export interface OfficeCapabilityGate extends OfficeQualityGateResult {
  /** The gate's name as a reviewer reads it. */
  readonly label: string;
}

export interface OfficeCapabilities {
  readonly overallStatus: OfficeQualityAssessment['overallStatus'];
  readonly gates: readonly OfficeCapabilityGate[];
  readonly counts: {
    readonly personas: number;
    readonly validators: number;
    readonly gates: number;
    readonly standards: number;
  };
}

export const describeOfficeCapabilities = (project: Project): OfficeCapabilities => {
  const assessment = evaluateOfficeQualityGates(project);
  return {
    overallStatus: assessment.overallStatus,
    gates: assessment.gates.map((gate) => ({ ...gate, label: OFFICE_GATE_LABELS[gate.id] })),
    counts: {
      personas: Object.keys(OFFICE_AGENT_PERSONAS).length,
      validators: OFFICE_VALIDATORS.length,
      gates: assessment.gates.length,
      standards: getOfficeArchitectureContext().standards.length,
    },
  };
};
