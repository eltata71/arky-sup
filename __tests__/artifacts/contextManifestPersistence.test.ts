import { describe, expect, it } from 'vitest';
import { createContextManifestRecorder, type Artifact, type ContextManifestRecord } from '../../lib/artifacts';
import { validateArtifact } from '../../services/architectureProjects/domain/projectRuntimeValidation';

const record = (text: string): ContextManifestRecord => ({
  label: 'Contexto de artefacto',
  profile: 'generate',
  sources: [{ id: 'p', label: 'Proyecto', revision: 2 }],
  sections: [{ scope: 'proyecto', items: [{ text }] }],
  omitted: [],
});

const artifactWith = (manifest: NonNullable<Artifact['generationTrace']>['contextManifest']): Artifact => ({
  id: 'a', revision: 1, versionGroupId: 'a', version: 1, createdAt: '2026-10-01T00:00:00Z', name: 'ADR',
  type: 'markdown', phase: 'Diseño', architecturalView: 'Vista Lógica y de Diseño',
  content: '# ADR', objective: 'Decidir', representation: 'document', keyConcepts: [],
  generationTrace: {
    id: 't', source: 'catalog', status: 'clean', startedAt: '', completedAt: '',
    decisions: [], errors: [], warnings: [], contentLength: 5, contextManifest: manifest,
  } as unknown as Artifact['generationTrace'],
});

describe('el manifiesto de contexto sobrevive al guardado y la recarga (7.5a)', () => {
  it('la lectura saneada conserva el manifiesto tal como se registró', () => {
    const recorder = createContextManifestRecorder('2026-10-01T00:00:00Z');
    recorder.capture(record('Servicio de pólizas'));
    const stored = JSON.parse(JSON.stringify(artifactWith(recorder.manifest())));
    const { value } = validateArtifact(stored);
    expect(value?.generationTrace?.contextManifest).toEqual({
      version: 1,
      capturedAt: '2026-10-01T00:00:00Z',
      records: [record('Servicio de pólizas')],
    });
  });

  it('cambiar la fuente después de capturar no altera lo registrado', () => {
    const recorder = createContextManifestRecorder('2026-10-01T00:00:00Z');
    const live = record('Antes');
    recorder.capture(live);
    live.sections[0].items[0].text = 'Después';
    live.sources[0].revision = 3;
    const manifest = recorder.manifest()!;
    expect(manifest.records[0].sections[0].items[0].text).toBe('Antes');
    expect(manifest.records[0].sources[0].revision).toBe(2);
  });

  it('sin capturas no hay manifiesto, nunca uno vacío', () => {
    expect(createContextManifestRecorder('2026-10-01T00:00:00Z').manifest()).toBeUndefined();
  });
});
