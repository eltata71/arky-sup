// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Artifact, ContextManifest } from '../../lib/artifacts';
import { exportArtifact } from '../../services/export/exportService';
import { prepareCitationsForExport } from '../../services/export/exportCitations';

const manifest: ContextManifest = {
  version: 1,
  capturedAt: '2026-10-01T00:00:00Z',
  records: [{
    label: 'Grafo de contexto',
    sources: [],
    sections: [],
    omitted: [],
    citations: [{ tag: '[ctx:tech-1]', label: 'Kafka', entityType: 'technology', sources: ['Notas'] }],
  }],
};

const artifact = (overrides: Partial<Artifact> = {}): Artifact => ({
  id: 'art-1', versionGroupId: 'vg-1', version: 1, createdAt: '2026-10-01T00:00:00.000Z',
  name: 'ADR de mensajería', type: 'markdown', phase: 'Lógica', architecturalView: 'Vista de Datos',
  content: '# ADR de mensajería\n\n## Decisión\n\nLos eventos viajan por Kafka [ctx:tech-1]. Un supuesto [ctx:risk-4].\n\n## Consecuencias\n\nMás operación.',
  objective: 'Decidir el bus de eventos.', keyConcepts: [], representation: 'document',
  generationTrace: {
    id: 't', source: 'catalog', status: 'clean', startedAt: '', completedAt: '',
    decisions: [], errors: [], warnings: [], contentLength: 10, contextManifest: manifest,
  } as unknown as Artifact['generationTrace'],
  ...overrides,
});

describe('ninguna exportación contiene una etiqueta opaca (7.5b)', () => {
  it.each(['md', 'html', 'txt', 'json'] as const)('%s: notas numeradas y lo no resuelto, fuera e informado', async (format) => {
    const { file, trace } = await exportArtifact({ artifact: artifact(), activeView: 'document' }, format);
    const raw = await file.blob.text();
    // The technical JSON carries the recorded manifest — the very table that defines each tag — so only its document is checked.
    const text = format === 'json' ? (JSON.parse(raw) as { artifact: Artifact }).artifact.content : raw;
    expect(text).not.toMatch(/\[ctx:/i);
    expect(text).toContain('Kafka [1]');
    expect(text).toContain('Fuentes de contexto');
    expect(trace.citations).toEqual({ notes: 1, removed: ['risk-4'] });
  });

  it('un diagrama pierde las etiquetas sin recibir una sección que rompería su notación', () => {
    const { context } = prepareCitationsForExport({
      artifact: artifact({ representation: 'diagram', type: 'mermaid-c4-context', content: 'flowchart LR\n  A[Kafka [ctx:tech-1]] --> B' }),
      activeView: 'diagram',
    });
    expect(context.artifact.content).toBe('flowchart LR\n  A[Kafka] --> B');
  });

  it('la versión de publicación pierde las etiquetas en todos sus textos', () => {
    const presentationModel = { title: 'ADR [ctx:tech-1]', sections: [{ body: 'Kafka [ctx:tech-1]' }], quality: { score: 90 } };
    const { context } = prepareCitationsForExport({
      artifact: artifact(), activeView: 'document',
      presentationModel: presentationModel as unknown as NonNullable<Parameters<typeof prepareCitationsForExport>[0]['presentationModel']>,
    });
    expect(JSON.stringify(context.presentationModel)).not.toMatch(/\[ctx:/);
    expect(context.presentationModel).toMatchObject({ title: 'ADR', sections: [{ body: 'Kafka' }], quality: { score: 90 } });
  });

  it('un artefacto sin citas sale intacto, sin traza de citas', () => {
    const plain = artifact({ content: '# ADR\n\nSin citas.' });
    const prepared = prepareCitationsForExport({ artifact: plain, activeView: 'document' });
    expect(prepared.context.artifact).toBe(plain);
    expect(prepared.citations).toBeUndefined();
  });
});
