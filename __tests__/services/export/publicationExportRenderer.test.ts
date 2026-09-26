import { describe, expect, it } from 'vitest';
import type { Artifact } from '../../../lib/artifacts';
import { compileArtifactPresentation } from '../../../services/artifacts/domain/artifactPresentationCompiler';
import { renderPresentationModelToHtml, renderPresentationModelToJson, renderPresentationModelToMarkdown, extractPresentationTables } from '../../../services/export/publicationExportRenderer';
import { exportArtifact } from '../../../services/export/exportService';

const artifact = (content: string, overrides: Partial<Artifact> = {}): Artifact => ({
  id: 'pub-1',
  versionGroupId: 'vg-1',
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  name: 'Matriz de publicación',
  type: 'sdd-traceability',
  phase: 'Diseño',
  architecturalView: 'Vista SDD',
  content,
  objective: 'Publicar una matriz gobernada.',
  keyConcepts: [],
  representation: 'hybrid',
  ...overrides,
});

const content = `# Entregable

## Resumen Ejecutivo
Documento preparado para comité con una narrativa clara y trazabilidad de decisiones.

## Próximos pasos
- Aprobar plan

## Trazabilidad
- REQ-1

| Requisito | Estado |
|---|---|
| REQ-1 | Aprobado |

\`\`\`mermaid
flowchart LR
  A[Cliente] -->|usa| B[API]
\`\`\``;

describe('publicationExportRenderer', () => {
  it('renderiza Markdown/HTML/JSON profesionales desde ArtifactPresentationModel', () => {
    const model = compileArtifactPresentation(artifact(content)).model;
    expect(model).not.toBeNull();
    const markdown = renderPresentationModelToMarkdown(model!);
    expect(markdown).toContain('## Portada lógica');
    expect(markdown).toContain('```mermaid');
    expect(renderPresentationModelToHtml(model!)).toMatch(/<!doctype html>/i);
    expect(renderPresentationModelToJson(model!)).toHaveProperty('schema', 'arky.presentation.publication.v1');
  });

  it('extrae tablas compiladas normalizadas para CSV/XLSX', () => {
    const model = compileArtifactPresentation(artifact(content)).model!;
    expect(extractPresentationTables(model)[0].headers).toEqual(['Requisito', 'Estado']);
  });

  it('exportArtifact usa presentationModel para Markdown publicación sin romper original', async () => {
    const source = artifact(content);
    const model = compileArtifactPresentation(source).model!;
    const publication = await exportArtifact({ artifact: source, activeView: 'document', presentationModel: model, exportAsPublication: true, publicationMode: 'publication' }, 'md');
    const original = await exportArtifact({ artifact: source, activeView: 'document' }, 'md');
    expect(await publication.file.blob.text()).toContain('Portada lógica');
    expect(await original.file.blob.text()).toBe(source.content);
  });

  it('CSV publicación usa tablas compiladas cuando publicationMode=table-only', async () => {
    const source = artifact(content);
    const model = compileArtifactPresentation(source).model!;
    const result = await exportArtifact({ artifact: source, activeView: 'document', presentationModel: model, exportAsPublication: true, publicationMode: 'table-only' }, 'csv');
    expect(await result.file.blob.text()).toContain('REQ-1');
  });
});
