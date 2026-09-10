import { describe, expect, it } from 'vitest';
import type { Project } from '../../types';
import {
  buildDeterministicArtifactBrief,
  inferArtifactFamilyFromRequest,
  inferAudienceFromRequest,
  updateArtifactBriefFromForm,
} from '../../services/artifacts/artifactBriefService';
import { validateArtifactGenerationContract } from '../../services/artifacts/artifactGenerationContract';

const project: Project = {
  id: 'p1',
  name: 'Core bancario',
  description: 'Plataforma core con APIs y eventos de dominio.',
  projectContext: ['El API Gateway es el punto único de entrada.', 'Los eventos viajan por Kafka.'],
  artifacts: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const NOW = '2026-05-18T00:00:00.000Z';

describe('artifactBriefService — deterministic extraction', () => {
  it('#1 transforma texto libre en un contrato determinístico válido', () => {
    const contract = buildDeterministicArtifactBrief(
      project,
      'Necesito documentar el flujo de integración entre el core y los sistemas externos.',
      { now: NOW },
    );
    expect(validateArtifactGenerationContract(contract)).toEqual([]);
    expect(contract.id).toMatch(/^agc-/);
    expect(contract.acceptanceCriteria.length).toBeGreaterThan(0);
    expect(contract.qualityTarget).toBeGreaterThanOrEqual(70);
  });

  it('#2 infiere audiencia ejecutiva', () => {
    const contract = buildDeterministicArtifactBrief(
      project,
      'Explicar al comité gerencial la decisión de modernización del core.',
      { now: NOW },
    );
    expect(contract.audience).toBe('executive');
    expect(inferAudienceFromRequest('Presentar al directivo el board de decisiones')).toBe('executive');
  });

  it('#3 infiere audiencia técnica', () => {
    const contract = buildDeterministicArtifactBrief(
      project,
      'Detallar para el equipo técnico la arquitectura de microservicios y APIs.',
      { now: NOW },
    );
    expect(contract.audience).toBe('technical');
  });

  it('#4 infiere familia documento cuando el usuario pide un documento', () => {
    const contract = buildDeterministicArtifactBrief(
      project,
      'Quiero un documento que resuma las decisiones de arquitectura del proyecto.',
      { now: NOW },
    );
    expect(contract.artifactFamily).toBe('document');
  });

  it('#5 infiere familia diagrama cuando el usuario pide un diagrama', () => {
    const contract = buildDeterministicArtifactBrief(
      project,
      'Quiero un diagrama de secuencia que muestre las llamadas entre servicios.',
      { now: NOW },
    );
    expect(contract.artifactFamily).toBe('diagram');
  });

  it('#6 infiere familia matriz cuando el usuario pide una matriz', () => {
    const contract = buildDeterministicArtifactBrief(
      project,
      'Necesito una matriz de trazabilidad de requerimientos contra casos de prueba.',
      { now: NOW },
    );
    expect(contract.artifactFamily).toBe('matrix');
    expect(inferArtifactFamilyFromRequest('Arma una tabla con el inventario de APIs')).toBe('table');
  });

  it('updateArtifactBriefFromForm normaliza y conserva listas no provistas', () => {
    const base = buildDeterministicArtifactBrief(project, 'Documento de arquitectura del core bancario.', { now: NOW });
    const patched = updateArtifactBriefFromForm(base, { audience: 'executive' });
    expect(patched.audience).toBe('executive');
    expect(patched.acceptanceCriteria).toEqual(base.acceptanceCriteria);
  });
});
