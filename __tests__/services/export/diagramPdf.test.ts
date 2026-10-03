/**
 * El PDF vectorial de un diagrama (plan de diagramas, 2.4): se dibuja en
 * vectores con la disposición del lienzo, su texto es texto, lleva el resumen
 * accesible, y sólo sustituye al PDF de documento cuando hay instantánea.
 */
import { describe, expect, it } from 'vitest';
import type { Artifact } from '../../../lib/artifacts';
import { snapshotFromFlow, type DiagramSnapshot } from '../../../services/export';
import { buildDiagramPdfBlob } from '../../../services/export/adapters/diagramPdf';
import { pdfExporter } from '../../../services/export/adapters/pdfExporter';
import { readPdfBlob } from '../../export/pdfTextReader';

const latin1 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
};

const snapshot = (): DiagramSnapshot => snapshotFromFlow(
  [
    { id: 'web', position: { x: 0, y: 0 }, width: 160, height: 60, data: { label: 'Portal de asegurados' } },
    { id: 'api', position: { x: 300, y: 0 }, width: 160, height: 60, data: { label: 'API de pólizas' } },
    { id: 'db', position: { x: 600, y: 120 }, width: 160, height: 60, data: { label: 'Base de datos' } },
  ],
  [
    { source: 'web', target: 'api', label: 'HTTPS' },
    { source: 'api', target: 'db', label: 'SQL', animated: true },
  ],
  ['Diagrama de integración con 3 elementos.', 'El portal llama a la API de pólizas.'],
)!;

const artifact: Artifact = {
  id: 'a1', versionGroupId: 'a1', version: 3, createdAt: '2026-09-28T00:00:00.000Z',
  name: 'Integración de pólizas', type: 'mermaid-graph', phase: 'Diseño',
  architecturalView: 'Vista Lógica y de Diseño', content: 'graph LR; web-->api', objective: 'x',
  keyConcepts: [], representation: 'diagram',
};

describe('snapshotFromFlow', () => {
  it('toma posiciones, medidas y etiquetas del lienzo, y descarta conexiones colgantes', () => {
    const snap = snapshotFromFlow(
      [{ id: 'a', position: { x: 1, y: 2 }, data: { label: 'A' } }, { id: 'b', positionAbsolute: { x: 5, y: 6 }, width: 90, height: 40 }],
      [{ source: 'a', target: 'b', data: { relation: 'async' } }, { source: 'a', target: 'fantasma' }],
    )!;
    expect(snap.nodes).toEqual([
      { id: 'a', label: 'A', x: 1, y: 2, width: 160, height: 64 },
      { id: 'b', label: 'b', x: 5, y: 6, width: 90, height: 40 },
    ]);
    expect(snap.edges).toEqual([{ source: 'a', target: 'b', label: '', dashed: true }]);
  });

  it('sin nodos dibujables no hay instantánea', () => {
    expect(snapshotFromFlow([], [])).toBeNull();
    expect(snapshotFromFlow([{ id: 'x' }], [])).toBeNull();
  });
});

describe('buildDiagramPdfBlob', () => {
  it('dos páginas apaisadas: el diagrama en vectores y el resumen accesible', async () => {
    const blob = await buildDiagramPdfBlob({ title: 'Integración de pólizas', version: 3, date: '2026-09-28T00:00:00Z', snapshot: snapshot() });
    const pdf = await latin1(blob);
    const { runs, text } = await readPdfBlob(blob);
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/Count 2');
    expect(pdf).toContain('/MediaBox [0 0 792 612]');
    // Vectores, no una imagen incrustada.
    expect(pdf).not.toContain('/Image');
    expect((pdf.match(/ re B/g) ?? []).length).toBe(3);
    expect(pdf).toContain('[3 2] 0 d');
    // El texto es texto, en una fuente incrustada que se puede copiar y buscar.
    expect(pdf).toContain('/Encoding /Identity-H');
    expect(runs.map((r) => r.text)).toContain('API de pólizas');
    expect(runs.map((r) => r.text)).toContain('HTTPS');
    expect(text).toContain('Resumen accesible');
    expect(text).toContain('El portal llama a la API de pólizas.');
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('la tabla xref apunta al inicio real de cada objeto', async () => {
    const pdf = await latin1(await buildDiagramPdfBlob({ title: 'X', date: '2026-09-28', snapshot: snapshot() }));
    const xref = pdf.slice(pdf.lastIndexOf('\nxref\n'));
    const offsets = [...xref.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets.length).toBeGreaterThan(5);
    offsets.forEach((offset, index) => expect(pdf.slice(offset, offset + 12)).toMatch(new RegExp(`^${index + 1} 0 obj`)));
    const startxref = Number(pdf.match(/startxref\n(\d+)/)![1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');
  });

  it('lleva la organización y la clasificación en la cabecera', async () => {
    const { text } = await readPdfBlob(await buildDiagramPdfBlob({ title: 'X', date: '2026-09-28', owner: 'Seguros Andinos', confidentiality: 'Uso interno', snapshot: snapshot() }));
    expect(text).toContain('Seguros Andinos');
    expect(text).toContain('Uso interno');
  });

  it('una etiqueta con una flecha la conserva (9.3)', async () => {
    const snap = snapshotFromFlow([{ id: 'a', position: { x: 0, y: 0 }, data: { label: 'Solicitud → Emisión ≤ 24 h' } }], [])!;
    const { text } = await readPdfBlob(await buildDiagramPdfBlob({ title: 'Flujo ⇒ póliza', date: '2026-09-28', snapshot: snap }));
    expect(text).toContain('→');
    expect(text).toContain('≤');
    expect(text).toContain('Flujo ⇒ póliza');
    expect(text).not.toContain('?');
  });
});

describe('pdfExporter con y sin instantánea', () => {
  it('con instantánea dibuja el diagrama', async () => {
    const file = await pdfExporter.export({ artifact, activeView: 'diagram', diagramSnapshot: snapshot() });
    const pdf = await latin1(file.blob);
    expect(pdf).toContain('/MediaBox [0 0 792 612]');
    expect((await readPdfBlob(file.blob)).text).toContain('Resumen accesible');
  });

  it('sin instantánea el PDF es el de siempre', async () => {
    const file = await pdfExporter.export({ artifact, activeView: 'document' });
    const pdf = await latin1(file.blob);
    expect(pdf).toContain('/MediaBox [0 0 612 792]');
    expect((await readPdfBlob(file.blob)).text).not.toContain('Resumen accesible');
  });
});
