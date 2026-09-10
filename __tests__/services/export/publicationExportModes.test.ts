import { describe, expect, it } from 'vitest';
import type { Artifact } from '../../../types';
import type { ArtifactPresentationModel } from '../../../lib/artifacts/artifactPresentationModel';
import {
  extractPresentationTables,
  renderPresentationModelToHtml,
  renderPresentationModelToJson,
  renderPresentationModelToMarkdown,
  renderPresentationModelToPlainText,
} from '../../../services/export/publicationExportRenderer';
import { exportArtifact } from '../../../services/export/exportService';
import { validateExportRequest } from '../../../services/export/exportValidation';
import { getRecentExportTraces } from '../../../services/export/exportTrace';

// ── Fixtures ────────────────────────────────────────────────────────────────

const baseArtifact = (overrides: Partial<Artifact> = {}): Artifact => ({
  id: 'artifact-pub-1',
  versionGroupId: 'vg-1',
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  name: 'Arquitectura de referencia',
  type: 'markdown',
  phase: 'Diseño',
  architecturalView: 'Vista SDD',
  content: '# Arquitectura\n\nContenido del artefacto original suficiente para exportar.',
  objective: 'Publicar el entregable arquitectónico.',
  keyConcepts: [],
  representation: 'document',
  ...overrides,
});

const baseModel = (overrides: Partial<ArtifactPresentationModel> = {}): ArtifactPresentationModel => ({
  id: 'presentation-test-1',
  artifactId: 'artifact-pub-1',
  artifactName: 'Arquitectura de referencia',
  artifactType: 'markdown',
  compilerVersion: '1.1.0',
  audience: 'mixed',
  mode: 'publication',
  title: 'Arquitectura de referencia',
  subtitle: 'Entregable profesional',
  executiveSummary: 'Resumen ejecutivo con narrativa de negocio y técnica para comité.',
  purpose: 'Propósito del entregable arquitectónico de referencia.',
  scope: 'Alcance acotado al dominio de pagos digitales.',
  sections: [
    { id: 's1', title: 'Contexto', level: 1, content: 'Contenido de contexto suficientemente detallado para publicación profesional.', type: 'body', order: 1 },
    { id: 's2', title: 'Componentes', level: 2, content: 'Detalle de componentes con responsabilidades claras y acopladas al dominio.', type: 'body', order: 2 },
  ],
  diagrams: [
    {
      id: 'd1',
      title: 'Diagrama de contexto',
      purpose: 'Mostrar actores y sistemas del dominio.',
      mermaid: 'flowchart LR\n  A[Cliente] --> B[API]',
      legend: [{ id: 'l1', label: 'API', meaning: 'Servicio de aplicación' }],
      readingNotes: ['Leer de izquierda a derecha.'],
      density: 'balanced',
      orientation: 'LR',
      exportSafe: true,
      nodeCount: 2,
      edgeCount: 1,
      executiveSummary: 'Resumen ejecutivo del diagrama de contexto.',
      technicalSummary: 'Resumen técnico del diagrama de contexto.',
    },
  ],
  tables: [
    {
      id: 't1',
      title: 'Matriz de trazabilidad',
      headers: ['Requisito', 'Estado'],
      rows: [['REQ-1', 'Aprobado'], ['REQ-2', 'En curso']],
      completeness: 0.95,
      exportSafe: true,
      readingNotes: ['Estados confirmados por comité.'],
    },
  ],
  callouts: [],
  decisions: [{ id: 'dec1', type: 'decision', title: 'ADR-1', content: 'Adoptar arquitectura hexagonal.' }],
  risks: [{ id: 'r1', type: 'risk', title: 'Latencia', content: 'Latencia en integración externa.' }],
  assumptions: [{ id: 'a1', type: 'assumption', title: 'Disponibilidad', content: 'El proveedor mantiene su SLA.' }],
  nextSteps: ['Aprobar el entregable en comité de arquitectura.'],
  traceability: ['REQ-1 → Componente API'],
  exportProfile: {
    recommendedFormats: ['pdf', 'docx', 'html', 'md'],
    availableFormats: ['pdf', 'docx', 'html', 'md', 'txt', 'json', 'csv', 'xlsx', 'svg', 'png', 'mermaid', 'diagram-json'],
    blockedFormats: [],
    defaultFormat: 'pdf',
    canExportAsPublication: true,
    requiresUserReview: false,
  },
  quality: {
    score: 88,
    readyForPublication: true,
    blockers: [],
    warnings: [],
    recommendations: [],
    dimensions: { structure: 88, readability: 86, visualHierarchy: 84, traceability: 90, exportReadiness: 92, audienceAlignment: 84 },
  },
  theme: { name: 'audit', density: 'comfortable', colorMode: 'adaptive' },
  trace: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  ...overrides,
});

const modelWithoutDiagrams = (): ArtifactPresentationModel => baseModel({ diagrams: [] });
const modelWithoutTables = (): ArtifactPresentationModel => baseModel({ tables: [] });
const skeletonModel = (): ArtifactPresentationModel =>
  baseModel({
    quality: {
      ...baseModel().quality,
      score: 30,
      readyForPublication: false,
      blockers: ['El contenido parece un skeleton/fallback y requiere regeneración antes de publicación profesional.'],
    },
  });

// ── Renderer: per-mode Markdown ─────────────────────────────────────────────

describe('publicationExportRenderer — modos de publicación', () => {
  it('publication genera contenido completo no vacío', () => {
    const md = renderPresentationModelToMarkdown(baseModel(), 'publication');
    expect(md).toContain('## Portada lógica');
    expect(md).toContain('## Resumen ejecutivo');
    expect(md).toContain('## Diagrama 1: Diagrama de contexto');
    expect(md).toContain('## Matriz de trazabilidad');
    expect(md).toContain('## Trazabilidad');
    expect(md.trim().length).toBeGreaterThan(200);
  });

  it('document-diagram incluye secciones y diagramas sin tablas independientes', () => {
    const md = renderPresentationModelToMarkdown(baseModel(), 'document-diagram');
    expect(md).toContain('Diagrama de contexto');
    expect(md).toContain('Componentes');
    expect(md).not.toContain('| Requisito | Estado |');
    expect(md).not.toContain('## Matriz de trazabilidad');
  });

  it('diagram-only incluye sólo diagramas, leyendas, notas y métricas', () => {
    const md = renderPresentationModelToMarkdown(baseModel(), 'diagram-only');
    expect(md).toContain('Diagrama de contexto');
    expect(md).toContain('### Leyenda');
    expect(md).toContain('### Notas de lectura');
    expect(md).toContain('**Métricas:**');
    expect(md).not.toContain('## Matriz de trazabilidad');
    expect(md).not.toContain('## Componentes');
    expect(md).not.toContain('## Riesgos');
  });

  it('table-only incluye sólo tablas y metadatos mínimos', () => {
    const md = renderPresentationModelToMarkdown(baseModel(), 'table-only');
    expect(md).toContain('Matriz de trazabilidad');
    expect(md).toContain('| Requisito | Estado |');
    expect(md).toContain('REQ-1');
    expect(md).not.toContain('Diagrama de contexto');
    expect(md).not.toContain('## Componentes');
  });

  it('un modo sin contenido devuelve un borrador, nunca un archivo vacío', () => {
    const md = renderPresentationModelToMarkdown(modelWithoutDiagrams(), 'diagram-only');
    expect(md.trim().length).toBeGreaterThan(0);
    expect(md).toContain('Borrador');
  });

  it('renderPresentationModelToHtml genera HTML válido', () => {
    const html = renderPresentationModelToHtml(baseModel(), 'publication');
    expect(html).toMatch(/^\s*<!doctype html>/i);
    expect(html).toMatch(/<html[\s>]/i);
  });

  it('renderPresentationModelToHtml no duplica tablas', () => {
    const html = renderPresentationModelToHtml(baseModel(), 'publication');
    expect((html.match(/<table/gi) ?? []).length).toBe(1);
  });

  it('renderPresentationModelToPlainText no queda vacío', () => {
    expect(renderPresentationModelToPlainText(baseModel(), 'publication').length).toBeGreaterThan(80);
  });

  it('renderPresentationModelToJson respeta el modo solicitado', () => {
    const publication = renderPresentationModelToJson(baseModel(), 'publication') as Record<string, unknown>;
    expect(publication).toHaveProperty('schema', 'arky.presentation.publication.v1');
    expect(publication).toHaveProperty('mode', 'publication');
    expect(publication).toHaveProperty('diagrams');
    expect(publication).toHaveProperty('tables');

    const diagramOnly = renderPresentationModelToJson(baseModel(), 'diagram-only') as Record<string, unknown>;
    expect(diagramOnly).toHaveProperty('diagrams');
    expect(diagramOnly).not.toHaveProperty('tables');

    const tableOnly = renderPresentationModelToJson(baseModel(), 'table-only') as Record<string, unknown>;
    expect(tableOnly).toHaveProperty('tables');
    expect(tableOnly).not.toHaveProperty('diagrams');
  });

  it('extractPresentationTables respeta table-only y excluye modos diagramáticos', () => {
    expect(extractPresentationTables(baseModel(), 'table-only')).toHaveLength(1);
    expect(extractPresentationTables(baseModel(), 'diagram-only')).toHaveLength(0);
    expect(extractPresentationTables(baseModel(), 'document-diagram')).toHaveLength(0);
    expect(extractPresentationTables(baseModel())[0].headers).toEqual(['Requisito', 'Estado']);
  });
});

// ── Adapters ────────────────────────────────────────────────────────────────

describe('adaptadores de exportación con publicationMode', () => {
  it('Markdown original sigue funcionando sin cambios', async () => {
    const artifact = baseArtifact();
    const result = await exportArtifact({ artifact, activeView: 'document' }, 'md');
    expect(await result.file.blob.text()).toBe(artifact.content);
    expect(result.file.publication?.exportedAsPublication).toBe(false);
  });

  it('Markdown publicación respeta publicationMode', async () => {
    const artifact = baseArtifact();
    const model = baseModel();
    const full = await exportArtifact({ artifact, activeView: 'document', presentationModel: model, exportAsPublication: true, publicationMode: 'publication' }, 'md');
    const tableOnly = await exportArtifact({ artifact, activeView: 'document', presentationModel: model, exportAsPublication: true, publicationMode: 'table-only' }, 'md');
    expect(await full.file.blob.text()).toContain('Diagrama de contexto');
    expect(await tableOnly.file.blob.text()).not.toContain('Diagrama de contexto');
    expect(await tableOnly.file.blob.text()).toContain('Matriz de trazabilidad');
  });

  it('HTML publicación no duplica tablas', async () => {
    const result = await exportArtifact({ artifact: baseArtifact(), activeView: 'document', presentationModel: baseModel(), exportAsPublication: true, publicationMode: 'publication' }, 'html');
    const html = await result.file.blob.text();
    expect((html.match(/<table/gi) ?? []).length).toBe(1);
  });

  it('DOCX publicación no duplica tablas', async () => {
    const result = await exportArtifact({ artifact: baseArtifact(), activeView: 'document', presentationModel: baseModel(), exportAsPublication: true, publicationMode: 'publication' }, 'docx');
    const xml = await result.file.blob.text();
    // "En curso" exists only inside the traceability matrix — exactly one render.
    expect((xml.match(/En curso/g) ?? []).length).toBe(1);
  });

  it('PDF publicación genera cabecera %PDF', async () => {
    const result = await exportArtifact({ artifact: baseArtifact(), activeView: 'document', presentationModel: baseModel(), exportAsPublication: true, publicationMode: 'publication' }, 'pdf');
    const header = String.fromCharCode(...new Uint8Array(await result.file.blob.slice(0, 4).arrayBuffer()));
    expect(header).toBe('%PDF');
  });

  it('CSV publicación usa las tablas de presentación', async () => {
    const result = await exportArtifact({ artifact: baseArtifact(), activeView: 'document', presentationModel: baseModel(), exportAsPublication: true, publicationMode: 'table-only' }, 'csv');
    const csv = await result.file.blob.text();
    expect(csv).toContain('Requisito');
    expect(csv).toContain('REQ-1');
  });

  it('XLSX publicación genera ZIP/OOXML válido', async () => {
    const result = await exportArtifact({ artifact: baseArtifact(), activeView: 'document', presentationModel: baseModel(), exportAsPublication: true, publicationMode: 'table-only' }, 'xlsx');
    const magic = new Uint8Array(await result.file.blob.slice(0, 2).arrayBuffer());
    expect(Array.from(magic)).toEqual([0x50, 0x4b]);
    expect(await result.file.blob.text()).toContain('Requisito');
  });

  it('JSON publicación incluye metadata de presentación', async () => {
    const result = await exportArtifact({ artifact: baseArtifact(), activeView: 'document', presentationModel: baseModel(), exportAsPublication: true, publicationMode: 'publication' }, 'json');
    const payload = JSON.parse(await result.file.blob.text());
    expect(payload).toHaveProperty('schema', 'arky.presentation.publication.v1');
    expect(payload).toHaveProperty('quality');
    expect(payload).toHaveProperty('exportProfile');
  });
});

// ── Validation ──────────────────────────────────────────────────────────────

describe('quality gate de publicación', () => {
  const publicationContext = (model: ArtifactPresentationModel, extra: Record<string, unknown> = {}) => ({
    artifact: baseArtifact(),
    activeView: 'document' as const,
    presentationModel: model,
    exportAsPublication: true,
    publicationMode: 'publication' as const,
    ...extra,
  });

  it('publicación lista permite exportar', () => {
    const result = validateExportRequest(publicationContext(baseModel()), 'md');
    expect(result.canExport).toBe(true);
  });

  it('publicación con bloqueadores requiere override explícito', () => {
    const blocked = baseModel({
      quality: { ...baseModel().quality, readyForPublication: false, blockers: ['Falta resumen ejecutivo verificado.'] },
    });
    const withoutOverride = validateExportRequest(publicationContext(blocked), 'md');
    expect(withoutOverride.canExport).toBe(false);
    const withOverride = validateExportRequest(publicationContext(blocked, { qualityOverride: true }), 'md');
    expect(withOverride.canExport).toBe(true);
  });

  it('diagram-only sin diagramas se bloquea', () => {
    const result = validateExportRequest(
      publicationContext(modelWithoutDiagrams(), { publicationMode: 'diagram-only' }),
      'html',
    );
    expect(result.canExport).toBe(false);
  });

  it('table-only sin tablas se bloquea', () => {
    const result = validateExportRequest(
      publicationContext(modelWithoutTables(), { publicationMode: 'table-only' }),
      'csv',
    );
    expect(result.canExport).toBe(false);
  });

  it('skeleton/fallback bloquea la publicación profesional incluso con override', () => {
    const withOverride = validateExportRequest(publicationContext(skeletonModel(), { qualityOverride: true }), 'md');
    expect(withOverride.canExport).toBe(false);
    expect(withOverride.checks.some((check) => check.id === 'publication-skeleton')).toBe(true);
  });

  it('la exportación original no se bloquea por fallos de publicación', () => {
    const skeletonArtifact = baseArtifact({ content: '# Documento\n\nContenido original con detalle suficiente para auditoría.' });
    const result = validateExportRequest({ artifact: skeletonArtifact, activeView: 'document' }, 'md');
    expect(result.canExport).toBe(true);
  });
});

// ── Traceability ────────────────────────────────────────────────────────────

describe('trazabilidad de exportación de publicación', () => {
  it('ExportedFile.publication y ExportTrace.publication quedan completos en éxito', async () => {
    const result = await exportArtifact(
      { artifact: baseArtifact(), activeView: 'document', presentationModel: baseModel(), exportAsPublication: true, publicationMode: 'document-diagram' },
      'md',
    );
    expect(result.file.publication).toEqual({
      exportedAsPublication: true,
      mode: 'document-diagram',
      score: 88,
      blockers: 0,
      warnings: 0,
    });
    expect(result.trace.publication?.exportedAsPublication).toBe(true);
    expect(result.trace.publication?.mode).toBe('document-diagram');
    expect(result.trace.success).toBe(true);
  });

  it('el override del usuario queda registrado en la traza', async () => {
    const blocked = baseModel({
      quality: { ...baseModel().quality, readyForPublication: false, blockers: ['Falta validación de comité.'] },
    });
    const result = await exportArtifact(
      { artifact: baseArtifact(), activeView: 'document', presentationModel: blocked, exportAsPublication: true, publicationMode: 'publication', qualityOverride: true },
      'md',
    );
    expect(result.trace.quality?.override).toBe(true);
    expect(result.trace.publication?.blockers).toBe(1);
  });

  it('los fallos de exportación quedan registrados en la traza', async () => {
    await expect(
      exportArtifact(
        { artifact: baseArtifact(), activeView: 'document', presentationModel: modelWithoutTables(), exportAsPublication: true, publicationMode: 'table-only' },
        'csv',
      ),
    ).rejects.toThrow();
    const [latest] = getRecentExportTraces();
    expect(latest.success).toBe(false);
    expect(latest.errorMessage).toBeTruthy();
    expect(latest.publication?.exportedAsPublication).toBe(true);
  });
});
