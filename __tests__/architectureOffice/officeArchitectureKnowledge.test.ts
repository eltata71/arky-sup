import { describe, expect, it } from 'vitest';
import { buildGraphInputFromProject } from '../../services/architectureKnowledgeGraph';
import { getOfficeArchitectureContext } from '../../services/architectureOffice/officeArchitectureKnowledge';
import { validateProject } from '../../services/architectureProjects/domain/projectRuntimeValidation';
import type { Project } from '../../services/architectureProjects';

const project: Project = {
  id: 'PROJ-2026-001',
  name: 'ArkyPro',
  description: 'Gestión de proyectos de arquitectura',
  projectContext: [],
  linkedBusinessProjects: ['NEG-2026-001'],
  artifacts: [],
  createdAt: '2026-08-23T00:00:00.000Z',
  updatedAt: '2026-08-23T00:00:00.000Z',
};

describe('officeArchitectureKnowledge', () => {
  it('provides versioned standards for all supported domains', () => {
    const context = getOfficeArchitectureContext();
    expect(context.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(new Set(context.standards.map((standard) => standard.domain))).toEqual(
      new Set(['global', 'aws', 'salesforce', 'mulesoft', 'as400', 'software', 'artifacts', 'insurance']),
    );
    expect(context.standards.length).toBeGreaterThanOrEqual(13);
  });

  it('carries the insurance regulatory standards the office is accountable for', () => {
    const ids = getOfficeArchitectureContext().standards.map((standard) => standard.id);
    expect(ids).toEqual(expect.arrayContaining([
      'INS-ACORD-CANONICAL',
      'INS-PII-PHI-MINIMIZATION',
      'INS-REGULATORY-TRACEABILITY',
      'INS-CLAIMS-AUDITABILITY',
    ]));
  });

  it('feeds Architecture Office standards and NEG links into the graph build input', () => {
    const office = getOfficeArchitectureContext();
    const input = buildGraphInputFromProject(project, {
      globalContext: office.promptContext,
    });
    expect(input.globalContext).toEqual(expect.arrayContaining([
      expect.stringContaining('API-First'),
      expect.stringContaining('Zero Trust'),
      expect.stringContaining('NEG-2026-001'),
    ]));
  });

  it('preserves only valid business project links at the runtime boundary', () => {
    const result = validateProject({
      ...project,
      linkedBusinessProjects: ['NEG-2026-001', 'bad-id', 42],
    });
    expect(result.value?.linkedBusinessProjects).toEqual(['NEG-2026-001']);
  });
});
