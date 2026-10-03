import { writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { Artifact } from '../../../lib/artifacts';
import type { ExportContext } from '../../../services/export/exportTypes';
import { buildDocxBlob } from '../../../services/export/adapters/docxExporter';
import { readStoredZip } from '../../export/evals/exportEvalHarness';

const PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMISDkBAAKEAX1NusKWAAAAAElFTkSuQmCC',
  'base64',
));

vi.mock('../../../services/export/utils/mermaidRaster', () => ({
  rasterizeMermaidToPng: async () => ({ pngBytes: PNG, width: 800, height: 400 }),
}));

const artifact = {
  id: 'docx-native', versionGroupId: 'vg-docx-native', version: 1,
  createdAt: '2026-10-03T00:00:00.000Z', name: 'Decisión de arquitectura',
  type: 'markdown', phase: 'Diseño',
  architecturalView: 'Vista Lógica y de Diseño', objective: 'Documentar la decisión.',
  keyConcepts: [], representation: 'document',
  content: `# Contexto\nTexto **fuerte**, *énfasis*, \`código\` y [fuente](https://example.com/evidencia).\n\n- Primera\n  - Segunda\n1. Paso uno\n2. Paso dos\n\n| Control | Evidencia |\n| --- | --- |\n| Uno | Dos | Sobrante |\n| Tres | Cuatro |\n\n## Diagrama\n\`\`\`mermaid\nflowchart LR\n  A --> B\n\`\`\`\n`,
} as Artifact;

const context: ExportContext = { artifact, activeView: 'document', generatedAt: new Date('2026-10-03T00:00:00.000Z') };

describe('DOCX nativo', () => {
  it('declara partes y relaciones para estilos, numeración, enlaces e imagen', async () => {
    const bytes = new Uint8Array(await (await buildDocxBlob(context)).arrayBuffer());
    if (process.env.ARKY_DOCX_QA_OUTPUT) writeFileSync(process.env.ARKY_DOCX_QA_OUTPUT, bytes);
    const zip = readStoredZip(bytes);
    const part = (path: string): string => new TextDecoder().decode(zip.get(path));
    expect(part('[Content_Types].xml')).toContain('/word/styles.xml');
    expect(part('[Content_Types].xml')).toContain('/word/numbering.xml');
    expect(part('word/styles.xml')).toContain('w:styleId="Heading1"');
    expect(part('word/numbering.xml')).toContain('w:numFmt w:val="decimal"');
    expect(part('word/numbering.xml')).toContain('w:numFmt w:val="bullet"');
    expect(part('word/_rels/document.xml.rels')).toContain('Target="media/image1.png"');
    expect(part('word/_rels/document.xml.rels')).toContain('Target="https://example.com/evidencia"');
    expect(zip.get('word/media/image1.png')).toEqual(PNG);
  });

  it('conserva tabla y diagrama junto a su sección, con índice y formato de texto', async () => {
    const zip = readStoredZip(new Uint8Array(await (await buildDocxBlob(context)).arrayBuffer()));
    const xml = new TextDecoder().decode(zip.get('word/document.xml'));
    expect(xml).toContain('TOC \\o');
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:i/>');
    expect(xml).toContain('w:rStyle w:val="Code"');
    expect(xml).toContain('<w:numPr>');
    expect(xml).toContain('<w:drawing>');
    expect(xml).not.toContain('flowchart LR');
    expect((xml.match(/<w:tbl>/g) ?? [])).toHaveLength(2); // metadata and content
    expect(xml.indexOf('Contexto')).toBeLessThan(xml.indexOf('Sobrante'));
    expect(xml.indexOf('Sobrante')).toBeLessThan(xml.indexOf('Diagrama'));
  });
});
