import { describe, expect, it } from 'vitest';
import type { Artifact } from '../../lib/artifacts';
import { getExportFormatOptions, validateArtifactForExport } from '../../services/export/artifactExportValidation';
import { buildArtifactExportPayload, extractTablesFromContent } from '../../services/export/artifactExportPayload';

const baseArtifact = (overrides: Partial<Artifact> = {}): Artifact => ({
  id: 'art-1',
  versionGroupId: 'vg-1',
  version: 1,
  createdAt: '2026-05-10T00:00:00.000Z',
  name: 'Diccionario de Datos',
  type: 'markdown',
  phase: 'Lógica',
  architecturalView: 'Vista de Datos',
  content: `# Diccionario de Datos\n\n| Campo | Descripción | Tipo de dato | Longitud | Formato | Reglas de validación | Fuente | Sistema destino | Sensibilidad | PHI/PII | Observaciones |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| Nombre_Completo | Nombre y apellidos del asegurado. | VARCHAR | 100 | Texto | No nulo | Simasec/GMD | WeeCompany PBM | Confidencial | PII | Validar acentos |\n| Fecha_Nacimiento | Fecha de nacimiento del asegurado. | DATE | 10 | YYYY-MM-DD | Fecha válida | Simasec/GMD | WeeClinic | Confidencial | PHI | Usar ISO |`,
  objective: 'Catálogo centralizado de campos, reglas y sensibilidad.',
  keyConcepts: [],
  representation: 'document',
  ...overrides,
});

const failedDiagramPreflight = {
  ready: false,
  checks: [
    { id: 'generation', status: 'fail' as const, label: 'Estado de generación', detail: 'La IA no devolvió contenido parseable.' },
  ],
};

describe('artifact validation and export architecture', () => {
  it('allows a valid document to export document formats without blocking on a failed diagram', () => {
    const artifact = baseArtifact();
    for (const format of ['docx', 'pdf', 'md', 'html'] as const) {
      const result = validateArtifactForExport({ artifact, activeView: 'document', format, diagramPreflight: failedDiagramPreflight });
      expect(result.canExport).toBe(true);
      expect(result.message).not.toMatch(/diagrama no está listo/i);
    }

    const png = validateArtifactForExport({ artifact, activeView: 'document', format: 'png', diagramPreflight: failedDiagramPreflight });
    expect(png.canExport).toBe(false);
    expect(png.blockingScopes).toContain('diagram');
  });

  it('shows document formats for document view and disables diagram-only formats', () => {
    const options = getExportFormatOptions({ artifact: baseArtifact(), activeView: 'document', diagramPreflight: failedDiagramPreflight });
    expect(options.find((option) => option.format === 'docx')?.enabled).toBe(true);
    expect(options.find((option) => option.format === 'pdf')?.enabled).toBe(true);
    expect(options.find((option) => option.format === 'png')?.enabled).toBe(false);
    expect(options.find((option) => option.format === 'svg')?.enabled).toBe(false);
  });

  it('exports data dictionaries to DOCX/PDF/XLSX/CSV and preserves table columns', async () => {
    const artifact = baseArtifact();
    const tables = extractTablesFromContent(artifact.content);
    expect(tables).toHaveLength(1);
    expect(tables[0].headers).toContain('Campo');
    expect(tables[0].headers).toContain('PHI/PII');

    const docx = await buildArtifactExportPayload(artifact, 'docx', { appName: 'Arky 10', modelId: 'gemini-test' });
    expect(docx.content).toBeInstanceOf(Blob);
    expect((docx.content as Blob).type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(Array.from(new Uint8Array(await (docx.content as Blob).slice(0, 2).arrayBuffer()))).toEqual([0x50, 0x4b]);

    const pdf = await buildArtifactExportPayload(artifact, 'pdf');
    expect(pdf.mode).toBe('download');
    expect(String.fromCharCode(...new Uint8Array(await (pdf.content as Blob).slice(0, 4).arrayBuffer()))).toBe('%PDF');

    const xlsx = await buildArtifactExportPayload(artifact, 'xlsx');
    expect(await (xlsx.content as Blob).text()).toContain('Sistema destino');

    const csv = await buildArtifactExportPayload(artifact, 'csv');
    expect(await (csv.content as Blob).text()).toContain('"Campo"');
  });

  it('allows diagram exports only when the diagram preflight is ready', () => {
    const artifact = baseArtifact({ representation: 'diagram', type: 'mermaid-graph', content: 'flowchart TD\nA[Cliente] -->|Solicita| B[API]', ir: { nodes: [{ id: 'A', label: 'Cliente', kind: 'actor' }, { id: 'B', label: 'API', kind: 'service' }], edges: [{ id: 'e1', source: 'A', target: 'B', label: 'Solicita' }], groups: [] } });
    const readyPreflight = { ready: true, checks: [{ id: 'generation', status: 'pass' as const, label: 'Estado de generación', detail: 'Parseable.' }] };
    expect(validateArtifactForExport({ artifact, activeView: 'diagram', format: 'png', diagramPreflight: readyPreflight }).canExport).toBe(true);
    expect(validateArtifactForExport({ artifact, activeView: 'diagram', format: 'svg', diagramPreflight: readyPreflight }).canExport).toBe(true);
    expect(validateArtifactForExport({ artifact, activeView: 'diagram', format: 'mermaid', diagramPreflight: readyPreflight }).canExport).toBe(true);
  });

  it('blocks empty artifacts and never builds an empty export payload', () => {
    const artifact = baseArtifact({ content: '', name: 'Vacío' });
    const result = validateArtifactForExport({ artifact, activeView: 'document', format: 'docx' });
    expect(result.canExport).toBe(false);
    expect(result.message).toMatch(/No existe contenido exportable/i);
  });

  it('allows markdown view to export MD, HTML, PDF and DOCX', () => {
    const artifact = baseArtifact({ name: 'Reporte Markdown', content: '# Reporte\n\n## Hallazgos\n\nContenido ejecutivo con recomendaciones y próximos pasos para arquitectura empresarial.' });
    for (const format of ['md', 'html', 'pdf', 'docx'] as const) {
      expect(validateArtifactForExport({ artifact, activeView: 'markdown', format }).canExport).toBe(true);
    }
  });
});
