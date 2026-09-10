import { describe, expect, it } from 'vitest';
import {
  mergeOfficeFindings,
  officeAssessmentToPreflight,
  officeGateToPreflightFinding,
} from '../../services/architectureOffice/officePublicationBridge';
import type { OfficeQualityAssessment, OfficeQualityGateResult } from '../../services/architectureOffice/officeQualityGates';
import type { PublicationPreflightFinding } from '../../services/publicationPipeline/PublicationPipelineTypes';

const gate = (overrides: Partial<OfficeQualityGateResult> & Pick<OfficeQualityGateResult, 'id' | 'status'>): OfficeQualityGateResult => ({
  evidenceArtifactIds: [],
  blockers: [],
  conditions: [],
  ...overrides,
});

describe('officePublicationBridge', () => {
  it('drops passing gates — a pass is not a finding', () => {
    expect(officeGateToPreflightFinding(gate({ id: 'cost-review', status: 'pass' }))).toBeNull();
  });

  it('turns a blocked gate into a blocking critical finding', () => {
    const finding = officeGateToPreflightFinding(gate({
      id: 'security-review',
      status: 'blocked',
      blockers: ['El Threat Model existente no supera la validación STRIDE.'],
    }));
    expect(finding).toMatchObject({ severity: 'critical', blocking: true });
    expect(finding?.message).toContain('Security Review');
    expect(finding?.message).toContain('STRIDE');
    expect(finding?.recommendation).toBeTruthy();
  });

  it('turns a conditional gate into a non-blocking finding carrying its conditions', () => {
    const finding = officeGateToPreflightFinding(gate({
      id: 'compliance-check',
      status: 'conditional',
      conditions: ['Falta evidencia de: retención y conservación.'],
    }));
    expect(finding).toMatchObject({ severity: 'medium', blocking: false });
    expect(finding?.message).toContain('retención');
  });

  it('maps the office verdict onto the publication verdict vocabulary', () => {
    const build = (overallStatus: OfficeQualityAssessment['overallStatus']): OfficeQualityAssessment => ({
      overallStatus,
      evaluatedAt: '2026-08-26T00:00:00.000Z',
      gates: [gate({ id: 'spec-freeze', status: overallStatus, blockers: ['x'], conditions: ['y'] })],
    });

    expect(officeAssessmentToPreflight(build('pass')).verdict).toBe('passed');
    expect(officeAssessmentToPreflight(build('conditional')).verdict).toBe('warning');
    expect(officeAssessmentToPreflight(build('blocked')).verdict).toBe('blocked');
    expect(officeAssessmentToPreflight(build('blocked')).blocking).toBe(true);
    expect(officeAssessmentToPreflight(build('conditional')).blocking).toBe(false);
  });

  it('treats a missing assessment as no contribution rather than a failure', () => {
    expect(officeAssessmentToPreflight(undefined)).toEqual({ findings: [], verdict: 'passed', blocking: false });
  });

  it('merges into an existing report without dropping or duplicating findings', () => {
    const existing: PublicationPreflightFinding[] = [{
      id: 'artifact-empty-1',
      code: 'artifact-empty',
      severity: 'critical',
      blocking: true,
      message: 'Artefacto vacío',
      recommendation: 'Regenerar',
    }];
    const assessment: OfficeQualityAssessment = {
      overallStatus: 'blocked',
      evaluatedAt: '2026-08-26T00:00:00.000Z',
      gates: [gate({ id: 'security-review', status: 'blocked', blockers: ['falta STRIDE'] })],
    };

    const merged = mergeOfficeFindings(existing, assessment);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toBe(existing[0]);

    // Merging twice must not duplicate the office finding.
    expect(mergeOfficeFindings(merged, assessment)).toHaveLength(2);
  });
});
