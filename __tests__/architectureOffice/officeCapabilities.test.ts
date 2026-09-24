/**
 * The capabilities panel's read model (F5-02): composed once, outside the
 * panel, from the four pieces of the Office it used to reach itself.
 */
import { describe, expect, it } from 'vitest';
import {
  describeOfficeCapabilities,
  evaluateOfficeQualityGates,
  OFFICE_GATE_LABELS,
} from '../../services/architectureOffice';
import { OFFICE_AGENT_PERSONAS } from '../../services/architectureOffice/officeAgentPersonas';
import { OFFICE_VALIDATORS } from '../../services/architectureOffice/officeArtifactValidators';
import { getOfficeArchitectureContext } from '../../services/architectureOffice/officeArchitectureKnowledge';
import type { Project } from '../../services/architectureProjects';

const project = {
  id: 'prj-1',
  name: 'Reclamos',
  description: 'Modernización',
  artifacts: [],
  projectContext: [],
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
} as unknown as Project;

describe('describeOfficeCapabilities', () => {
  it('carries the gate evaluation, each gate with its label', () => {
    const capabilities = describeOfficeCapabilities(project);
    const assessment = evaluateOfficeQualityGates(project);
    expect(capabilities.overallStatus).toBe(assessment.overallStatus);
    expect(capabilities.gates.map((gate) => gate.id)).toEqual(assessment.gates.map((gate) => gate.id));
    for (const gate of capabilities.gates) expect(gate.label).toBe(OFFICE_GATE_LABELS[gate.id]);
  });

  it('counts what the Office actually has, not a constant', () => {
    expect(describeOfficeCapabilities(project).counts).toEqual({
      personas: Object.keys(OFFICE_AGENT_PERSONAS).length,
      validators: OFFICE_VALIDATORS.length,
      gates: evaluateOfficeQualityGates(project).gates.length,
      standards: getOfficeArchitectureContext().standards.length,
    });
  });
});
