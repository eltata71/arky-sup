import { describe, expect, it } from 'vitest';
import {
  buildArchitectureContextGraph,
  contextPackBuilder,
  contextRelevanceRanker,
} from '../../services/contextGraph';
import { makeRichProject, makeSettings } from './fixtures';

const NOW = '2026-05-16T00:00:00.000Z';
const settings = makeSettings();
const project = makeRichProject();
const graph = buildArchitectureContextGraph(project, settings, undefined, { now: NOW });

describe('ContextRelevanceRanker', () => {
  it('ranks entities by relevance, intent-matching entities first', () => {
    const ranked = contextRelevanceRanker.rank(graph.entities, { intent: 'pagos con Stripe' });

    // Sorted descending by relevance.
    for (let i = 1; i < ranked.length; i += 1) {
      expect(ranked[i - 1].relevance).toBeGreaterThanOrEqual(ranked[i].relevance);
    }

    const stripe = ranked.find((e) => e.label === 'Stripe');
    const country = ranked.find((e) => e.type === 'country');
    expect(stripe).toBeDefined();
    if (stripe && country) {
      expect(stripe.relevance).toBeGreaterThan(country.relevance);
    }
  });

  it('honours the topK cap', () => {
    const ranked = contextRelevanceRanker.rank(graph.entities, { topK: 3 });
    expect(ranked.length).toBeLessThanOrEqual(3);
  });
});

describe('ContextPackBuilder', () => {
  it('builds a document-oriented context pack', () => {
    const pack = contextPackBuilder.build(graph, {
      artifactType: 'sdd-brd',
      audience: 'executive',
      intent: 'Documento de requisitos de negocio',
      detailLevel: 'standard',
      language: 'es',
    });

    expect(pack.entities.length).toBeGreaterThan(0);
    expect(pack.id.startsWith('ctxpack-')).toBe(true);
    expect(pack.markdown).toContain('## Contexto estructurado del proyecto');
    expect(pack.citations.length).toBe(pack.entities.length);
    // Every included entity carries a citation tag.
    expect(pack.entities.every((e) => e.citation.startsWith('[ctx:'))).toBe(true);
    expect(pack.approximateChars).toBe(pack.markdown.length);
  });

  it('builds a diagram-oriented context pack within the minimal budget', () => {
    const pack = contextPackBuilder.build(graph, {
      artifactType: 'mermaid-c4-context',
      audience: 'technical',
      intent: 'Diagrama de contexto C4',
      detailLevel: 'minimal',
    });

    expect(pack.entities.length).toBeGreaterThan(0);
    expect(pack.entities.length).toBeLessThanOrEqual(10);
    expect(pack.markdown.length).toBeGreaterThan(0);
    // Entities dropped by the cap are still reported for honest traceability.
    expect(Array.isArray(pack.ignoredSignals)).toBe(true);
  });

  it('surfaces conflicts and convenience slices in the pack', () => {
    const conflictProject = makeRichProject({
      projectContext: [
        'La base de datos principal es PostgreSQL.',
        'El equipo movió todo a MongoDB.',
        'Restricción: el despliegue debe ser on-premise.',
      ],
    });
    const conflictGraph = buildArchitectureContextGraph(conflictProject, settings, undefined, { now: NOW });
    const pack = contextPackBuilder.build(conflictGraph, { artifactType: 'sdd-nfr', detailLevel: 'rich' });

    expect(pack.conflicts.length).toBeGreaterThanOrEqual(1);
    expect(pack.constraints.length).toBeGreaterThanOrEqual(1);
    expect(pack.markdown).toContain('Conflictos de contexto');
  });
});
