import { describe, expect, it } from 'vitest';
import { createGetInitiativeMotivationTool, createQueryKnowledgeGraphTool, createToolRegistry } from '../../../services/ai/tools';

const registry = createToolRegistry([
  createQueryKnowledgeGraphTool({
    entities: () => [
      { id: 'e1', name: 'Motor de adjudicación', type: 'service', description: 'Decide la cobertura' },
      { id: 'e2', name: 'Base de pólizas', type: 'database' },
    ],
    relations: () => [{ sourceId: 'e1', targetId: 'e2', type: 'reads', label: 'SQL' }],
  }),
  createGetInitiativeMotivationTool({
    list: () => [{ initiativeId: 'i1', title: 'Adjudicar más rápido', need: 'Reducir espera', objectives: ['Bajar a 3 días'], expectedOutcomes: [], kpis: ['Días de adjudicación → 3'] }],
  }),
]);

describe('herramientas de contexto del Despacho', () => {
  it('describe cuándo usarlas y cuándo no, y son de solo lectura', () => {
    for (const tool of registry.list()) {
      expect(tool.definition.description).toContain('Úsala cuando');
      expect(tool.definition.description).toContain('No la uses cuando');
      expect(tool.effect).toBe('read-only');
    }
  });

  it('query_knowledge_graph devuelve relaciones entrantes y salientes con referencia', async () => {
    const out = await registry.execute('query_knowledge_graph', { name: 'adjudic' });
    expect(out.text).toContain('[ctx:graph/e1]');
    expect(out.text).toContain('→ reads (SQL) Base de pólizas');
    const inc = await registry.execute('query_knowledge_graph', { name: 'pólizas' });
    expect(inc.text).toContain('← reads (SQL) Motor de adjudicación');
  });

  it('query_knowledge_graph avisa sin coincidencias y rechaza el nombre vacío', async () => {
    expect((await registry.execute('query_knowledge_graph', { name: 'zzz' })).text).toContain('Ninguna entidad coincide');
    const empty = await registry.execute('query_knowledge_graph', { name: ' ' });
    expect(empty.ok).toBe(false);
  });

  it('get_initiative_motivation cita la iniciativa y explica el error', async () => {
    expect((await registry.execute('get_initiative_motivation', {})).text).toContain('[ctx:initiative/i1]');
    const bad = await registry.execute('get_initiative_motivation', { initiativeId: 'x' });
    expect(bad.ok).toBe(false);
    expect(bad.text).toContain('sin initiativeId');
  });

  it('respeta el tope de respuesta', async () => {
    const big = createToolRegistry([createGetInitiativeMotivationTool({
      list: () => [{ initiativeId: 'i', title: 't', need: 'n'.repeat(9_000), objectives: [], expectedOutcomes: [], kpis: [] }],
    })]);
    const out = await big.execute('get_initiative_motivation', {});
    expect(out.truncated).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(3_000);
  });
});
