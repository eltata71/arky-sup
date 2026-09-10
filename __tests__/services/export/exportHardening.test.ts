/**
 * @vitest-environment jsdom
 *
 * Renders nothing, but the code it exercises needs a DOM (localStorage,
 * DOMPurify, `window`). The `node` project is the default — see
 * `vite.config.ts` — and this is the exception, declared where it is read.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sanitizeFileName } from '../../../services/export/fileNameSanitizer';
import { parseMarkdownTables } from '../../../lib/markdownTables';
import { getExportCapabilities } from '../../../services/export/exportRegistry';
import { exportArtifact } from '../../../services/export/exportService';
import { downloadFile } from '../../../services/export/downloadService';
import type { Artifact } from '../../../types';

const baseArtifact: Artifact = {
  id: 'art-1',
  versionGroupId: 'vg-1',
  version: 1,
  createdAt: '2026-05-11T00:00:00.000Z',
  name: 'Matriz de Brechas Funcionales y No Funcionales del Proyecto de Administración de Beneficios',
  type: 'markdown',
  phase: 'Diseño',
  architecturalView: 'Vista SDD',
  content: '# Documento\n\nContenido ejecutivo suficiente para validar exportación documental.',
  objective: 'Validar exportación',
  keyConcepts: [],
  representation: 'document',
};

const matrixContent = `# Matriz de brechas

| Requisito | Estado | Observación |
| --- | --- | --- |
| Login | Brecha | Falta MFA |
| Reportes | OK | Exporta CSV |
`;

const matrixArtifact: Artifact = { ...baseArtifact, id: 'matrix-1', content: matrixContent, name: 'Matriz ñandú áéíóú', type: 'sdd-traceability' };
const diagramArtifact: Artifact = { ...baseArtifact, id: 'diagram-1', type: 'mermaid-graph', representation: 'diagram', content: 'flowchart TD\nA[Inicio] --> B[Fin]' };

const bytes = async (blob: Blob, count = 4): Promise<Uint8Array> => new Uint8Array(await blob.slice(0, count).arrayBuffer());

const enabled = (artifact: Artifact, activeView: 'document' | 'diagram' | 'markdown' | 'split') => getExportCapabilities({ artifact, activeView }, false).map((cap) => cap.format);

describe('fileNameSanitizer', () => {
  it('elimina caracteres inválidos, limita longitud y conserva extensión', () => {
    const filename = sanitizeFileName('Matriz: Beneficios / Administración * ñandú áéíóú '.repeat(4), { extension: 'docx', maxLength: 60 });
    expect(filename).toMatch(/\.docx$/);
    expect(filename.length).toBeLessThanOrEqual(60);
    expect(filename).not.toMatch(/[\\/:*?"<>|]/);
    expect(filename).toContain('ñandú');
  });
});

describe('Markdown table parser', () => {
  it('parsea tabla válida', () => {
    const [table] = parseMarkdownTables(matrixContent);
    expect(table?.headers).toEqual(['Requisito', 'Estado', 'Observación']);
    expect(table?.rows).toHaveLength(2);
  });

  it('preserva pipes escapados', () => {
    const [table] = parseMarkdownTables('| A | B |\n| --- | --- |\n| x\\|y | z |');
    expect(table?.rows[0]).toEqual(['x|y', 'z']);
  });

  it('ignora tabla mal formada y contenido sin tabla', () => {
    expect(parseMarkdownTables('| A | B |\n| -- | no |')).toEqual([]);
    expect(parseMarkdownTables('sin tablas')).toEqual([]);
  });

  it('soporta matriz grande', () => {
    const rows = Array.from({ length: 80 }, (_, i) => `| R${i} | E${i} | O${i} |`).join('\n');
    const [table] = parseMarkdownTables(`| A | B | C |\n| --- | --- | --- |\n${rows}`);
    expect(table?.rows).toHaveLength(80);
  });
});

describe('Export registry', () => {
  it('habilita formatos documentales para documento Markdown', () => {
    expect(enabled(baseArtifact, 'markdown')).toEqual(expect.arrayContaining(['md', 'html', 'txt', 'pdf', 'docx']));
    expect(enabled(baseArtifact, 'markdown')).not.toContain('png');
  });

  it('habilita hoja de cálculo para matriz', () => {
    expect(enabled(matrixArtifact, 'document')).toEqual(expect.arrayContaining(['md', 'html', 'txt', 'pdf', 'docx', 'csv', 'xlsx']));
  });

  it('habilita formatos de diagrama sólo para diagrama', () => {
    expect(enabled(diagramArtifact, 'diagram')).toEqual(expect.arrayContaining(['png', 'svg', 'mermaid', 'diagram-json']));
    expect(enabled(baseArtifact, 'document')).not.toContain('png');
  });

  it('documento no se bloquea por falta de diagrama', async () => {
    const result = await exportArtifact({ artifact: baseArtifact, activeView: 'document' }, 'docx');
    expect(result.trace.validationResult?.blockingScopes).not.toContain('diagram');
  });
});

describe('export adapters', () => {
  it('DOCX genera Blob OOXML no vacío con MIME correcto', async () => {
    const { file } = await exportArtifact({ artifact: matrixArtifact, activeView: 'document' }, 'docx');
    expect(file.blob.size).toBeGreaterThan(500);
    expect(file.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(file.filename).toMatch(/\.docx$/);
    expect(Array.from(await bytes(file.blob, 2))).toEqual([0x50, 0x4b]);
    expect(await file.blob.text()).not.toContain('# Matriz de brechas');
  });

  it('PDF genera Blob con cabecera %PDF', async () => {
    const { file } = await exportArtifact({ artifact: matrixArtifact, activeView: 'document' }, 'pdf');
    expect(file.mimeType).toBe('application/pdf');
    expect(String.fromCharCode(...await bytes(file.blob, 4))).toBe('%PDF');
  });

  it('XLSX exporta filas y columnas desde tabla Markdown', async () => {
    const { file } = await exportArtifact({ artifact: matrixArtifact, activeView: 'document' }, 'xlsx');
    expect(file.mimeType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(Array.from(await bytes(file.blob, 2))).toEqual([0x50, 0x4b]);
    const text = await file.blob.text();
    expect(text).toContain('Requisito');
    expect(text).toContain('Falta MFA');
  });

  it('CSV incluye BOM, escapa comillas y saltos de línea', async () => {
    const artifact = { ...matrixArtifact, content: '| A | B |\n| --- | --- |\n| "uno" | línea 1<br>línea 2 |' };
    const { file } = await exportArtifact({ artifact, activeView: 'document' }, 'csv');
    const csvBytes = await bytes(file.blob, 3);
    expect(Array.from(csvBytes)).toEqual([0xef, 0xbb, 0xbf]);
    const text = await file.blob.text();
    expect(text).toContain('"""uno"""');
    expect(text).toContain('línea 1');
  });
});

describe('download service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('rechaza Blob vacío', async () => {
    await expect(downloadFile({ blob: new Blob([]), filename: 'x.txt', mimeType: 'text/plain', extension: 'txt', format: 'txt' })).rejects.toThrow('vacío');
  });

  it('usa nombre sanitizado y libera object URL', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const click = vi.fn();
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const element = originalCreate(tagName);
      if (tagName === 'a') Object.defineProperty(element, 'click', { value: click });
      return element;
    });
    const result = await downloadFile({ blob: new Blob(['ok'], { type: 'text/plain' }), filename: 'a/b.txt', mimeType: 'text/plain', extension: 'txt', format: 'txt' });
    expect(result.filename).toBe('a-b.txt');
    expect(create).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:test');
  });
});

describe('Export flow', () => {
  it('exportar matriz a XLSX usa parser tabular', async () => {
    const { file } = await exportArtifact({ artifact: matrixArtifact, activeView: 'document' }, 'xlsx');
    expect(await file.blob.text()).toContain('Reportes');
  });

  it('formato no disponible informa razón', async () => {
    await expect(exportArtifact({ artifact: baseArtifact, activeView: 'document' }, 'xlsx')).rejects.toThrow('requiere una tabla');
  });
});
