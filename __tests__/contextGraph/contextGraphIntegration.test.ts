import { describe, expect, it } from 'vitest';
import type { ContextManifestRecord } from '../../lib/artifacts';
import { buildContextPackForProject, renderContextGraphReinforcement } from '../../services/contextGraph';
import { makeProject, makeRichProject, makeSettings } from './fixtures';

const settings = makeSettings();

describe('contextGraphIntegration — prompt reinforcement', () => {
  it('renders a citable context block for prompt injection', () => {
    const project = makeRichProject();
    const block = renderContextGraphReinforcement(project, settings, {
      artifactType: 'mermaid-c4-context',
      audience: 'technical',
      intent: 'Diagrama de contexto del sistema',
      language: 'es',
    });

    expect(block).toContain('ARCHITECTURE CONTEXT GRAPH');
    expect(block).toContain('[ctx:');
    expect(block).toContain('INSTRUCCIONES DE TRAZABILIDAD');
  });

  it('degrades to an empty string when there is no structured context', () => {
    const empty = makeProject({ name: '', description: '', projectContext: [] });
    const block = renderContextGraphReinforcement(empty, settings, { artifactType: 'markdown' });
    expect(block).toBe('');
  });
});

describe('contextGraphIntegration — records the context it renders (7.5a)', () => {
  it('captures the rendered pack, its project revision and what relevance left out', () => {
    const project = makeRichProject();
    const records: ContextManifestRecord[] = [];
    const query = { artifactType: 'sdd-brd' as const, audience: 'mixed' as const, intent: 'Requisitos de negocio del asegurado', detailLevel: 'standard' as const };
    const block = renderContextGraphReinforcement(project, settings, query, undefined, (record) => records.push(record));
    const pack = buildContextPackForProject(project, settings, query);

    expect(block).not.toBe('');
    expect(records).toHaveLength(1);
    expect(records[0].label).toBe('Grafo de contexto');
    expect(records[0].sources[0]).toEqual({ id: project.id, label: project.name, revision: project.revision });
    expect(records[0].sections[0].items[0].text).toBe(pack.markdown);
    expect(records[0].omitted).toHaveLength(pack.ignoredSignals.length);
    // 7.5b: every tag the model is asked to cite is recorded with the entity it names.
    expect(records[0].citations?.map((citation) => citation.tag)).toEqual(pack.entities.map((entity) => entity.citation));
    expect(records[0].citations?.[0].label).toBe(pack.entities[0].label);
  });

  it('captures nothing when nothing was rendered', () => {
    const records: ContextManifestRecord[] = [];
    const empty = makeProject({ name: '', description: '', projectContext: [] });
    renderContextGraphReinforcement(empty, settings, { artifactType: 'markdown' }, undefined, (record) => records.push(record));
    expect(records).toHaveLength(0);
  });
});
