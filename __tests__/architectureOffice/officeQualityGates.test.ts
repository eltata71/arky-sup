import { describe, expect, it } from 'vitest';
import type { Artifact } from '../../lib/artifacts';
import type { Project } from '../../services/architectureProjects';
import {
  evaluateOfficeQualityGates,
  OFFICE_QUALITY_GATE_IDS,
} from '../../services/architectureOffice/domain/officeQualityGates';

const artifact = (overrides: Partial<Artifact>): Artifact => ({
  id: `artifact-${Math.random()}`,
  versionGroupId: `group-${Math.random()}`,
  version: 1,
  createdAt: '2026-08-23T00:00:00.000Z',
  name: 'Documento',
  type: 'markdown',
  phase: 'General',
  architecturalView: 'Vista de Calidad y Validación',
  content: '# Documento',
  objective: 'Validar',
  keyConcepts: [],
  representation: 'document',
  ...overrides,
});

const project = (artifacts: Artifact[]): Project => ({
  id: 'PROJ-2026-001',
  name: 'Proyecto',
  description: 'Proyecto de arquitectura',
  projectContext: ['API-first', 'Zero Trust'],
  artifacts,
  createdAt: '2026-08-23T00:00:00.000Z',
  updatedAt: '2026-08-23T00:00:00.000Z',
});

describe('officeQualityGates', () => {
  it('evaluates the six approved project-level gates', () => {
    const assessment = evaluateOfficeQualityGates(project([]));
    expect(OFFICE_QUALITY_GATE_IDS).toHaveLength(6);
    expect(assessment.gates).toHaveLength(6);
    expect(assessment.overallStatus).toBe('conditional');
  });

  it('keeps security review conditional until a threat model becomes required', () => {
    const assessment = evaluateOfficeQualityGates(project([]));
    const security = assessment.gates.find((gate) => gate.id === 'security-review');
    expect(security?.status).toBe('conditional');
    expect(security?.conditions).toContain('Crear un Threat Model STRIDE antes de promover el proyecto a security review.');
    expect(security?.blockers).toEqual([]);
  });

  it('blocks security review when an existing threat model is invalid', () => {
    const assessment = evaluateOfficeQualityGates(project([
      artifact({ name: 'Threat Model STRIDE', content: '# STRIDE\n- Spoofing' }),
    ]));
    const security = assessment.gates.find((gate) => gate.id === 'security-review');
    expect(security?.status).toBe('blocked');
    expect(security?.blockers).toContain('El Threat Model existente no supera la validación STRIDE.');
  });

  it('passes spec freeze when valid OpenAPI and AsyncAPI contracts are present', () => {
    const assessment = evaluateOfficeQualityGates(project([
      artifact({
        name: 'Contrato de API (OpenAPI)',
        type: 'yaml',
        content: 'openapi: 3.1.0\ninfo:\n  title: API\n  version: 1.0.0\npaths:\n  /claims:\n    get:\n      summary: Lista\ncomponents:\n  securitySchemes:\n    bearerAuth:\n      type: http\n      scheme: bearer',
      }),
      artifact({
        name: 'Contrato de Eventos (AsyncAPI)',
        type: 'yaml',
        content: 'asyncapi: 3.0.0\ninfo:\n  title: Events\n  version: 1.0.0\nchannels:\n  artifact.generated:\n    address: artifact.generated',
      }),
    ]));
    expect(assessment.gates.find((gate) => gate.id === 'spec-freeze')?.status).toBe('pass');
  });
});
