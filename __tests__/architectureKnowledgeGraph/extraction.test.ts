import { describe, expect, it } from 'vitest';
import {
  architectureEntityExtractor,
  architectureRelationExtractor,
} from '../../services/architectureKnowledgeGraph';
import {
  NOW,
  brdArtifact,
  c4ContainerArtifact,
  fullBuildInput,
  glossaryArtifact,
  nfrArtifact,
  traceabilityArtifact,
} from './fixtures';

describe('ArchitectureEntityExtractor', () => {
  it('extracts entities from projectContext (decisions / microservices)', () => {
    const signals = architectureEntityExtractor.extract({
      projectId: 'p',
      projectContext: ['Decidimos usar una arquitectura de microservicios.'],
      now: NOW,
    });
    expect(signals.some((s) => s.type === 'decision')).toBe(true);
    expect(signals.every((s) => s.source.createdAt === NOW)).toBe(true);
  });

  it('extracts technologies from the project description', () => {
    const signals = architectureEntityExtractor.extract({
      projectId: 'p',
      projectDescription: 'El sistema usa PostgreSQL como base de datos principal.',
      now: NOW,
    });
    expect(signals.some((s) => s.type === 'database')).toBe(true);
  });

  it('extracts glossary terms from artifact keyConcepts', () => {
    const signals = architectureEntityExtractor.extractFromArtifact(glossaryArtifact, NOW);
    const term = signals.find((s) => s.type === 'glossaryTerm' && s.name === 'Pago');
    expect(term).toBeDefined();
    expect(term?.description).toContain('Transacción');
    expect(signals.some((s) => s.type === 'glossaryTerm' && s.name === 'Conciliación')).toBe(true);
    expect(signals.some((s) => /^[-:\s]+$/.test(s.name))).toBe(false);
  });

  it('extracts structured requirement ids from BRD Markdown', () => {
    const signals = architectureEntityExtractor.extractFromArtifact(brdArtifact, NOW);
    expect(signals.some((s) => s.type === 'functionalRequirement' && s.name === 'RF-001')).toBe(true);
    expect(signals.some((s) => s.type === 'functionalRequirement' && s.name === 'RF-002')).toBe(true);
  });

  it('extracts NFR ids from an NFR document', () => {
    const signals = architectureEntityExtractor.extractFromArtifact(nfrArtifact, NOW);
    expect(signals.some((s) => s.type === 'nonFunctionalRequirement' && s.name === 'RNF-001')).toBe(true);
  });

  it('extracts structural entities from a DiagramIR', () => {
    const signals = architectureEntityExtractor.extractFromArtifact(c4ContainerArtifact, NOW);
    expect(signals.some((s) => s.type === 'system' && s.name === 'Sistema de Pagos')).toBe(true);
    expect(signals.some((s) => s.type === 'externalSystem' && s.name === 'Pasarela Stripe')).toBe(true);
    expect(signals.some((s) => s.type === 'dataStore')).toBe(true);
  });

  it('preserves evidence (sourceRefs) on every extracted signal', () => {
    const signals = architectureEntityExtractor.extractFromArtifact(brdArtifact, NOW);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((s) => s.source.sourceId && s.source.createdAt)).toBe(true);
    expect(signals.every((s) => s.source.artifactId === brdArtifact.id || s.source.sourceId.includes(brdArtifact.id))).toBe(true);
  });

  it('does not mutate the artifact input it reads from', () => {
    const irBefore = c4ContainerArtifact.ir;
    const contentBefore = brdArtifact.content;
    architectureEntityExtractor.extract(fullBuildInput);
    expect(c4ContainerArtifact.ir).toBe(irBefore);
    expect(brdArtifact.content).toBe(contentBefore);
  });
});

describe('ArchitectureRelationExtractor', () => {
  it('extracts relations from DiagramIR edges with protocol', () => {
    const relations = architectureRelationExtractor.extractFromIR(c4ContainerArtifact, NOW);
    const restCall = relations.find((r) => r.protocol === 'REST');
    expect(restCall).toBeDefined();
    expect(restCall?.sourceName).toBe('API de Pagos');
    expect(restCall?.targetName).toBe('Pasarela Stripe');
  });

  it('extracts tracesTo links from a traceability matrix', () => {
    const relations = architectureRelationExtractor.extractFromTraceabilityMatrix(traceabilityArtifact, NOW);
    expect(relations.some((r) => r.type === 'tracesTo' && r.sourceName === 'RF-001' && r.targetName === 'TC-001')).toBe(true);
    expect(relations.every((r) => r.type === 'tracesTo')).toBe(true);
  });

  it('extracts integration relations from free text', () => {
    const relations = architectureRelationExtractor.extractFromText(
      'El Servicio de Pagos se integra con la Pasarela Stripe.',
      { sourceType: 'artifact-content', sourceId: 'art-x' },
      NOW,
    );
    expect(relations.length).toBeGreaterThan(0);
  });
});
