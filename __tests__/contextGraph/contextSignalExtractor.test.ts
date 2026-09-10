import { describe, expect, it } from 'vitest';
import { contextSignalExtractor } from '../../services/contextGraph';
import { makeArtifact } from './fixtures';

const NOW = '2026-05-16T00:00:00.000Z';

describe('ContextSignalExtractor', () => {
  it('extracts entities from projectContext keeping source, date and confidence', () => {
    const { signals } = contextSignalExtractor.extract({
      projectId: 'p1',
      projectContext: ['El sistema usa PostgreSQL como base de datos principal.'],
      now: NOW,
    });

    const tech = signals.find((s) => s.entityType === 'technology' && s.label === 'PostgreSQL');
    expect(tech).toBeDefined();
    expect(tech!.source.type).toBe('project-context');
    expect(tech!.source.scope).toBe('project');
    expect(tech!.extractedAt).toBe(NOW);
    expect(tech!.confidence).toBeGreaterThan(0);
    expect(tech!.mode).toBe('explicit');
    // The phrase "base de datos" yields a data-store signal as well.
    expect(signals.some((s) => s.entityType === 'data-store')).toBe(true);
  });

  it('extracts decisions and applications from agentMemory', () => {
    const { signals } = contextSignalExtractor.extract({
      projectId: 'p1',
      agentMemory: ['Decidimos usar arquitectura de microservicios.'],
      now: NOW,
    });

    expect(signals.some((s) => s.entityType === 'decision')).toBe(true);
    // Plural cue ("microservicios") must still match the "microservicio" keyword.
    expect(signals.some((s) => s.entityType === 'application')).toBe(true);
    expect(signals.every((s) => s.source.type === 'agent-memory')).toBe(true);
    expect(signals.every((s) => s.source.scope === 'agent')).toBe(true);
  });

  it('extracts compliance regulations from initialCapture', () => {
    const { signals } = contextSignalExtractor.extract({
      projectId: 'p1',
      initialCapture: ['El proyecto debe cumplir con GDPR y operar en México.'],
      now: NOW,
    });

    expect(signals.some((s) => s.entityType === 'compliance-regulation' && s.label === 'GDPR')).toBe(true);
    expect(signals.some((s) => s.entityType === 'country' && s.label === 'México')).toBe(true);
    expect(signals.every((s) => s.source.type === 'initial-capture')).toBe(true);
  });

  it('extracts entities from existing artifacts (name, objective, key concepts)', () => {
    const artifact = makeArtifact({
      name: 'Modelo de Datos de Pólizas',
      objective: 'Define las pólizas y reclamaciones del asegurado.',
      keyConcepts: [{ term: 'Cobertura', definition: 'Alcance de protección de una póliza.' }],
      content: 'Las tablas almacenan pólizas en PostgreSQL.',
    });
    const { signals } = contextSignalExtractor.extract({
      projectId: 'p1',
      artifacts: [artifact],
      now: NOW,
    });

    expect(signals.some((s) => s.source.type.startsWith('artifact-'))).toBe(true);
    expect(signals.some((s) => s.source.artifactId === artifact.id)).toBe(true);
    expect(signals.some((s) => s.entityType === 'data-entity')).toBe(true);
    // The named key concept becomes a business-capability candidate.
    expect(signals.some((s) => s.entityType === 'business-capability' && s.label === 'Cobertura')).toBe(true);
    expect(signals.some((s) => s.entityType === 'technology' && s.label === 'PostgreSQL')).toBe(true);
  });

  it('does not invent entities without a real signal (no false positives)', () => {
    const { signals } = contextSignalExtractor.extract({
      projectId: 'p1',
      projectContext: ['El proceso de cierre es muy rápido y simple.'],
      now: NOW,
    });
    // "rápido" contains the substring "api" — the word-boundary guard must
    // prevent a spurious API entity.
    expect(signals.some((s) => s.entityType === 'api')).toBe(false);
  });
});
