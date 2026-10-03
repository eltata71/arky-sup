/**
 * Los diagramas Mermaid de un documento llegan al PDF como imagen (9.3, H3), y
 * el que no se pudo dibujar se informa en vez de desaparecer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Artifact } from '../../../lib/artifacts';
import { readPdfBlob } from '../../export/pdfTextReader';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);
const raster = vi.hoisted(() => ({ jpeg: vi.fn() }));
vi.mock('../../../services/export/utils/mermaidRaster', () => ({
  rasterizeMermaidToJpeg: raster.jpeg,
  rasterizeMermaidToPng: async () => null,
}));

import { pdfExporter } from '../../../services/export/adapters/pdfExporter';

const artifact: Artifact = {
  id: 'a1', versionGroupId: 'a1', version: 1, createdAt: '2026-10-03T00:00:00.000Z',
  name: 'Flujo de reclamación', type: 'markdown', phase: 'Diseño', architecturalView: 'Vista Lógica y de Diseño',
  objective: 'x', keyConcepts: [], representation: 'document',
  content: '# Flujo\n\nAntes.\n\n```mermaid\nsequenceDiagram\n  A->>B: hola\n```\n\nDespués.',
};

describe('diagramas en el PDF documental', () => {
  beforeEach(() => raster.jpeg.mockReset());

  it('se incrusta la imagen JPEG como figura con texto alternativo, sin el código', async () => {
    raster.jpeg.mockResolvedValue({ jpegBytes: JPEG, width: 800, height: 400 });
    const file = await pdfExporter.export({ artifact, activeView: 'document' });
    const pdf = await readPdfBlob(file.blob);
    expect(pdf.raw).toMatch(/\/Subtype \/Image \/Width 800 \/Height 400 .*\/Filter \/DCTDecode/);
    expect(pdf.raw).toMatch(/\/Figure <<\/MCID \d+>> BDC\nq\n.* cm\n\/Im1 Do/);
    expect(pdf.raw).toContain('/Alt (Diagrama 1 \\(sequenceDiagram\\).)');
    expect(pdf.text).not.toContain('sequenceDiagram');
    expect(file.technicalDetails).not.toMatch(/no se pudo dibujar/);
  });

  it('si no se pudo dibujar, queda el código y el fichero lo dice', async () => {
    raster.jpeg.mockResolvedValue(null);
    const file = await pdfExporter.export({ artifact, activeView: 'document' });
    const pdf = await readPdfBlob(file.blob);
    expect(pdf.raw).not.toContain('/Subtype /Image');
    expect(pdf.text).toContain('sequenceDiagram');
    expect(file.technicalDetails).toMatch(/El diagrama 1 no se pudo dibujar/);
  });
});
