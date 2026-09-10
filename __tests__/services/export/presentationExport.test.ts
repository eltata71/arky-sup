import { describe, it, expect } from 'vitest';
import { getCandidateFormats, getExportCapabilities, getPreferredExportsForArtifact } from '../../../services/export/exportRegistry';
import { pptxExporter } from '../../../services/export/adapters/pptxExporter';
import type { Artifact } from '../../../types';

const buildPresentationArtifact = (over: Partial<Artifact> = {}): Artifact => ({
  id: 'pres-1',
  versionGroupId: 'pres-vg-1',
  version: 1,
  createdAt: '2026-05-21T00:00:00.000Z',
  name: 'Presentación Ejecutiva — Demo',
  type: 'presentation-executive',
  phase: 'General',
  architecturalView: 'Vista de Gestión y Soporte',
  content: JSON.stringify({
    kind: 'presentation',
    version: '1.0.0',
    title: 'Presentación Ejecutiva — Demo',
    audience: 'executive',
    slides: [
      { id: 'slide-1', slideNumber: 1, title: 'Portada', layout: 'titleSlide', contentBlocks: [] },
      {
        id: 'slide-2',
        slideNumber: 2,
        title: 'Objetivo',
        layout: 'executiveSummary',
        contentBlocks: [{ type: 'bullets', content: ['Bullet 1', 'Bullet 2'] }],
      },
      { id: 'slide-3', slideNumber: 3, title: 'Cierre', layout: 'closingSlide', contentBlocks: [] },
    ],
  }),
  objective: 'Demo deck',
  keyConcepts: [],
  representation: 'document',
  ...over,
});

const buildMarkdownArtifact = (): Artifact => ({
  id: 'doc-1',
  versionGroupId: 'doc-vg-1',
  version: 1,
  createdAt: '2026-05-21T00:00:00.000Z',
  name: 'README del Proyecto',
  type: 'markdown',
  phase: 'General',
  architecturalView: 'Vista de Gestión y Soporte',
  content: '# README\n\nProyecto demo.',
  objective: 'README',
  keyConcepts: [],
  representation: 'document',
});

describe('Export · Presentation candidate formats', () => {
  it('returns PPTX/PDF/HTML/JSON as candidates for presentations', () => {
    const candidates = getCandidateFormats({
      artifact: buildPresentationArtifact(),
      activeView: 'document',
    });
    expect(candidates).toContain('pptx');
    expect(candidates).toContain('pdf');
    expect(candidates).toContain('html');
    // CSV/XLSX/PNG/SVG should NOT be candidates for a slide deck
    expect(candidates).not.toContain('csv');
    expect(candidates).not.toContain('xlsx');
    expect(candidates).not.toContain('png');
    expect(candidates).not.toContain('svg');
  });

  it('does NOT offer PPTX for non-presentation artifacts', () => {
    const candidates = getCandidateFormats({
      artifact: buildMarkdownArtifact(),
      activeView: 'document',
    });
    expect(candidates).not.toContain('pptx');
  });

  it('enables PPTX export capability for presentations', () => {
    const caps = getExportCapabilities({
      artifact: buildPresentationArtifact(),
      activeView: 'document',
    });
    const pptx = caps.find(c => c.format === 'pptx');
    expect(pptx).toBeDefined();
    expect(pptx!.enabled).toBe(true);
    expect(pptx!.category).toBe('Presentación');
  });

  it('does NOT surface PPTX as an option for non-presentation artifacts', () => {
    const caps = getExportCapabilities({
      artifact: buildMarkdownArtifact(),
      activeView: 'document',
    });
    const pptx = caps.find(c => c.format === 'pptx');
    // For markdown artifacts, PPTX is intentionally NOT in the export universe.
    // It would only appear if explicitly added via DOCUMENT_FORMATS — and the
    // semantic contract we want is that documents never expose PPTX.
    expect(pptx).toBeUndefined();
  });

  it('promotes PPTX as the first preferred export for presentations', () => {
    const preferred = getPreferredExportsForArtifact({ artifact: buildPresentationArtifact() });
    expect(preferred[0]).toBe('pptx');
  });

  it('does not promote PPTX as a preferred export for documents', () => {
    const preferred = getPreferredExportsForArtifact({ artifact: buildMarkdownArtifact() });
    expect(preferred).not.toContain('pptx');
  });
});

describe('Export · PPTX adapter', () => {
  it('produces a non-empty PPTX (zip) blob', async () => {
    const exported = await pptxExporter.export({
      artifact: buildPresentationArtifact(),
      activeView: 'document',
    });
    expect(exported.format).toBe('pptx');
    expect(exported.extension).toBe('pptx');
    expect(exported.mimeType).toContain('presentationml');
    expect(exported.blob.size).toBeGreaterThan(500); // a tiny zip is still > 500B
    // PPTX is a zip; verify the magic header.
    const bytes = new Uint8Array(await exported.blob.arrayBuffer());
    expect(bytes[0]).toBe(0x50); // 'P'
    expect(bytes[1]).toBe(0x4b); // 'K'
  });

  it('falls back to a parseable deck when content is garbage', async () => {
    const exported = await pptxExporter.export({
      artifact: buildPresentationArtifact({ content: 'this is not a deck' }),
      activeView: 'document',
    });
    expect(exported.blob.size).toBeGreaterThan(500);
  });
});
