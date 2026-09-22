import { describe, expect, it, vi, afterEach } from 'vitest';
import type { Artifact } from '../../../lib/artifacts';
import { clearArtifactPresentationCache, compileArtifactPresentation, getArtifactPresentationStatus } from '../../../services/artifacts/artifactPresentationCompiler';

const baseArtifact = (overrides: Partial<Artifact>): Artifact => ({
  id: 'artifact-1',
  versionGroupId: 'vg-1',
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  name: 'BRD de Pagos',
  type: 'markdown',
  phase: 'Diseño',
  architecturalView: 'Vista SDD',
  content: '',
  objective: 'Alinear alcance y decisiones para el dominio de pagos.',
  keyConcepts: [],
  representation: 'document',
  ...overrides,
});

afterEach(() => {
  vi.unstubAllEnvs();
  clearArtifactPresentationCache();
});

describe('Artifact Presentation Compiler', () => {
  it('compila un documento Markdown en ArtifactPresentationModel sin mutar content', () => {
    const artifact = baseArtifact({
      content: '# BRD Pagos\n\n## Resumen Ejecutivo\nLa plataforma debe soportar pagos seguros para clientes empresariales con conciliación diaria.\n\n## Propósito\nDefinir alcance.\n\n## Próximos pasos\n- Validar PSP\n\n## Trazabilidad\n- REQ-1',
    });
    const original = artifact.content;
    const result = compileArtifactPresentation(artifact, { now: '2026-01-02T00:00:00.000Z' });
    expect(result.model?.title).toBe('BRD Pagos');
    expect(result.model?.sections.length).toBeGreaterThan(1);
    expect(artifact.content).toBe(original);
  });

  it('genera warning si falta resumen ejecutivo y no falla', () => {
    const artifact = baseArtifact({ content: '# Documento\n\n## Alcance\nEste documento describe el alcance operativo y técnico del servicio de pagos para la organización.' });
    const result = compileArtifactPresentation(artifact);
    expect(result.model).not.toBeNull();
    expect(result.warnings.join(' ')).toMatch(/resumen ejecutivo/i);
  });

  it('detecta tablas Markdown como ArtifactPresentationTable', () => {
    const artifact = baseArtifact({
      content: '# Matriz\n\n| Requisito | Estado | Dueño |\n|---|---|---|\n| REQ-1 | Aprobado | Arquitectura |',
      type: 'sdd-traceability',
    });
    const result = compileArtifactPresentation(artifact);
    expect(result.model?.tables).toHaveLength(1);
    expect(result.model?.tables[0].headers).toEqual(['Requisito', 'Estado', 'Dueño']);
  });

  it('compila Mermaid válido como ArtifactPresentationDiagram', () => {
    const artifact = baseArtifact({
      representation: 'diagram',
      type: 'mermaid-graph',
      content: 'flowchart LR\n  A[Cliente] -->|Solicita| B[API]\n  B -->|Persiste| C[(DB)]',
    });
    const result = compileArtifactPresentation(artifact);
    expect(result.model?.diagrams[0].nodeCount).toBeGreaterThan(0);
    expect(result.model?.diagrams[0].exportSafe).toBe(true);
  });

  it('no marca listo para publicación un diagrama sin nodos', () => {
    const artifact = baseArtifact({ representation: 'diagram', type: 'mermaid-graph', content: 'flowchart LR' });
    const result = compileArtifactPresentation(artifact);
    expect(result.model?.quality.readyForPublication).toBe(false);
    expect(result.model?.quality.blockers.join(' ')).toMatch(/nodos/i);
  });

  it('conserva documento y diagrama en híbridos', () => {
    const artifact = baseArtifact({
      representation: 'hybrid',
      type: 'hybrid-text-diagram',
      content: '# Arquitectura\n\n## Resumen Ejecutivo\nArquitectura objetivo para pagos y conciliación con gobierno operativo.\n\n```mermaid\nflowchart TD\n  A[Canal] -->|Orden| B[Pagos]\n```\n\n## Próximos pasos\n- Revisar SLA\n\n## Trazabilidad\n- ADR-1',
    });
    const result = compileArtifactPresentation(artifact);
    expect(result.model?.sections.length).toBeGreaterThan(0);
    expect(result.model?.diagrams.length).toBe(1);
  });

  it('no marca skeleton fallback como listo para publicación', () => {
    const artifact = baseArtifact({ content: '# Skeleton fallback\n\nPendiente de completar TODO: placeholder.' });
    const result = compileArtifactPresentation(artifact);
    expect(result.model?.quality.readyForPublication).toBe(false);
    expect(result.model?.quality.blockers.join(' ')).toMatch(/skeleton|fallback/i);
  });

  it('advierte tablas incompletas por completitud', () => {
    const artifact = baseArtifact({ content: '# Matriz\n\n| A | B |\n|---|---|\n| valor | |' });
    const result = compileArtifactPresentation(artifact);
    expect(result.model?.tables[0].completeness).toBeLessThan(1);
    expect(result.model?.quality.warnings.join(' ')).toMatch(/tabla/i);
  });

  it('recomienda formatos documentales para documentos', () => {
    const artifact = baseArtifact({ content: '# Documento\n\n## Resumen Ejecutivo\nContenido suficientemente claro para publicación ejecutiva.\n\n## Próximos pasos\n- Aprobar\n\n## Trazabilidad\n- REQ-1' });
    const result = compileArtifactPresentation(artifact);
    expect(result.model?.exportProfile.recommendedFormats).toContain('md');
    expect(result.model?.exportProfile.recommendedFormats).toContain('html');
  });

  it('recomienda formatos de diagrama para diagramas', () => {
    const artifact = baseArtifact({ representation: 'diagram', type: 'mermaid-graph', content: 'flowchart LR\nA[Cliente] -->|usa| B[API]' });
    const result = compileArtifactPresentation(artifact);
    expect(result.model?.exportProfile.recommendedFormats).toContain('svg');
    expect(result.model?.exportProfile.recommendedFormats).toContain('png');
  });

  it('feature flag apagado conserva comportamiento anterior', () => {
    vi.stubEnv('VITE_PRESENTATION_COMPILER_ENABLED', 'false');
    const result = compileArtifactPresentation(baseArtifact({ content: '# Documento' }));
    expect(result.enabled).toBe(false);
    expect(result.model).toBeNull();
  });



  it('invalida cache cuando cambia contenido o audiencia', () => {
    const artifact = baseArtifact({ content: '# Documento\n\n## Resumen Ejecutivo\nContenido suficientemente claro para el comité.\n\n## Próximos pasos\n- Aprobar\n\n## Trazabilidad\n- REQ-1' });
    const first = compileArtifactPresentation(artifact, { audience: 'technical' }).model;
    const cached = compileArtifactPresentation(artifact, { audience: 'technical' }).model;
    const changedContent = compileArtifactPresentation({ ...artifact, content: `${artifact.content}\n\n## Riesgos\n- Riesgo operativo` }, { audience: 'technical' }).model;
    const changedAudience = compileArtifactPresentation(artifact, { audience: 'executive' }).model;
    expect(cached).toBe(first);
    expect(changedContent).not.toBe(first);
    expect(changedAudience).not.toBe(first);
  });

  it('no marca falso positivo por simple mención textual de fallback', () => {
    const result = compileArtifactPresentation(baseArtifact({ content: '# Documento\n\n## Resumen Ejecutivo\nEste documento explica una estrategia de fallback operativo sin ser contenido de respaldo determinístico.\n\n## Próximos pasos\n- Aprobar\n\n## Trazabilidad\n- OPS-1' }));
    expect(result.model?.quality.blockers.join(' ')).not.toMatch(/skeleton\/fallback/i);
  });

  it('PublicationCenter puede consultar estado sin fallar', () => {
    const status = getArtifactPresentationStatus(baseArtifact({ content: '# Documento\n\nContenido de trabajo para revisar.' }));
    expect(status.enabled).toBe(true);
    expect(status.score === null || status.score >= 0).toBe(true);
  });
});
