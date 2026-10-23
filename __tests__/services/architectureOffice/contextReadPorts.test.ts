import { describe, expect, it } from 'vitest';
import {
  createArtifactReadPort,
  createKnowledgeGraphReadPort,
  createMotivationReadPort,
  createStandardsReadPort,
} from '../../../services/architectureOffice/application/contextReadPorts';

describe('puertos de lectura de la Oficina', () => {
  it('lee los estándares reales de la Oficina', () => {
    const items = createStandardsReadPort().list();
    expect(items.some((s) => s.id === 'GLOBAL-ZERO-TRUST')).toBe(true);
  });

  it('traduce el grafo y tolera su ausencia', () => {
    const port = createKnowledgeGraphReadPort({
      entities: [{ id: 'e1', name: 'API', type: 'component' }],
      relations: [{ sourceEntityId: 'e1', targetEntityId: 'e2', type: 'calls' }],
    });
    expect(port.relations()[0]).toMatchObject({ sourceId: 'e1', targetId: 'e2' });
    expect(createKnowledgeGraphReadPort(null).entities()).toEqual([]);
  });

  it('usa el código de la iniciativa como id y expone artefactos', () => {
    const m = createMotivationReadPort([{ title: 'T', code: 'NEG-2026-001', need: 'n', objectives: [], expectedOutcomes: [], kpis: [] }]);
    expect(m.list()[0].initiativeId).toBe('NEG-2026-001');
    const a = createArtifactReadPort([{ id: 'a', name: 'n', type: 't', version: 1, objective: 'o', content: 'c' }]);
    expect(a.list()).toHaveLength(1);
  });
});
