import { describe, expect, it } from 'vitest';
import { createContextManifestRecorder, type ContextManifestRecord } from '../../lib/artifacts';
import { recordAgentGeneration } from '../../services/agent/agentGenerationTrace';

describe('registro histórico del contexto', () => {
  it('no reconstruye ni comparte referencias con el proyecto vivo o con lecturas anteriores', () => {
    const record: ContextManifestRecord = {
      label: 'Generación', sources: [{ id: 'p1', label: 'Proyecto', revision: 2 }],
      sections: [{ scope: 'project', items: [{ text: 'Decisión original' }] }], omitted: [],
    };
    const recorder = createContextManifestRecorder('2026-10-01T00:00:00Z');
    expect(recorder.manifest()).toBeUndefined();
    recorder.capture(record);
    record.sources[0].revision = 3;
    record.sections[0].items[0].text = 'Decisión posterior';
    const persisted = JSON.parse(JSON.stringify(recorder.manifest()));
    expect(persisted.records[0].sources[0].revision).toBe(2);
    expect(persisted.records[0].sections[0].items[0].text).toBe('Decisión original');
    const firstRead = recorder.manifest()!;
    firstRead.records.length = 0;
    expect(recorder.manifest()?.records).toHaveLength(1);
  });
});

describe('traza de una generación del agente (7.5b)', () => {
  it('informa la cita que no corresponde al contexto enviado y no se declara limpia', () => {
    const generation = recordAgentGeneration('op-1', 'on-demand');
    generation.options.onContextCaptured({
      label: 'Grafo de contexto', sources: [], sections: [], omitted: [],
      citations: [{ tag: '[ctx:tech-1]', label: 'Kafka', entityType: 'technology', sources: [] }],
    });
    const clean = generation.trace('Kafka [ctx:tech-1].');
    expect(clean.status).toBe('clean');
    const broken = generation.trace('Kafka [ctx:tech-1] y [ctx:sys-7].');
    expect(broken.status).toBe('warning');
    expect(broken.warnings).toContain('Una cita del documento no corresponde al contexto enviado al modelo: ctx:sys-7.');
  });
});
