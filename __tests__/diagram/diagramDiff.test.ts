/**
 * La comparación semántica de versiones (plan de diagramas, 1.3): el orden y
 * la geometría no son cambios, una regeneración no es «todo nuevo», y lo que
 * sí cambió se dice por su nombre.
 */
import { describe, expect, it } from 'vitest';
import type { DiagramIR } from '../../lib/diagram';
import { applySemanticPatch, diffDiagramIR } from '../../services/diagram';

const base = (): DiagramIR => ({
  nodes: [
    { id: 'web', label: 'Web', kind: 'service', position: { x: 0, y: 0 } },
    { id: 'api', label: 'API', kind: 'service', technology: 'Node', position: { x: 200, y: 0 } },
    { id: 'db', label: 'Base de datos', kind: 'data', position: { x: 400, y: 0 } },
  ],
  edges: [
    { id: 'e1', source: 'web', target: 'api', label: 'HTTPS' },
    { id: 'e2', source: 'api', target: 'db', label: 'SQL' },
  ],
  groups: [{ id: 'g1', label: 'Backend', nodeIds: ['api', 'db'] }],
});

/** PRNG determinista (mulberry32): el mismo caso cada vez que falle. */
const rng = (seed: number) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const shuffle = <T,>(items: T[], random: () => number): T[] => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};
const randomIR = (random: () => number): DiagramIR => {
  const count = 3 + Math.floor(random() * 8);
  const nodes = Array.from({ length: count }, (_, i) => ({ id: `n${i}`, label: `Nodo ${i}`, kind: 'service' }));
  const edges = Array.from({ length: count }, (_, i) => ({
    id: `e${i}`, source: `n${i}`, target: `n${(i + 1 + Math.floor(random() * (count - 1))) % count}`, label: `rel ${i}`,
  })).filter((e) => e.source !== e.target);
  return { nodes, edges, groups: [{ id: 'g', label: 'Zona', nodeIds: nodes.slice(0, 2).map((n) => n.id) }] };
};

describe('diffDiagramIR', () => {
  it('el orden y la posición no son cambios (generador sembrado)', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const random = rng(seed);
      const ir = randomIR(random);
      const shuffled: DiagramIR = {
        nodes: shuffle(ir.nodes, random).map((n) => ({ ...n, position: { x: random() * 900, y: random() * 900 } })),
        edges: shuffle(ir.edges, random),
        groups: ir.groups.map((g) => ({ ...g, nodeIds: shuffle(g.nodeIds, random) })),
      };
      expect(diffDiagramIR(ir, shuffled).identical, `semilla ${seed}`).toBe(true);
    }
  });

  it('un renombrado es un cambio de ese elemento, no un borrado más una alta', () => {
    const after = applySemanticPatch(base(), {
      id: 'p', source: 'user', operations: [{ op: 'update-node', nodeId: 'api', changes: { label: 'API Gateway' } }],
    }).ir;
    const diff = diffDiagramIR(base(), after);
    expect(diff.nodes.added).toEqual([]);
    expect(diff.nodes.removed).toEqual([]);
    expect(diff.nodes.changed).toEqual([{ id: 'api', label: 'API Gateway', changes: [{ field: 'label', before: 'API', after: 'API Gateway' }] }]);
    // Las conexiones y el grupo siguen siendo los mismos: sólo cambió cómo se llama un extremo.
    expect(diff.edges.added).toEqual([]);
    expect(diff.groups.changed).toEqual([]);
  });

  it('una regeneración con ids nuevos reconoce los elementos por su nombre y lo dice', () => {
    const regenerated: DiagramIR = {
      nodes: base().nodes.map((n) => ({ ...n, id: `new-${n.id}` })),
      edges: base().edges.map((e) => ({ ...e, id: `x-${e.id}`, source: `new-${e.source}`, target: `new-${e.target}` })),
      groups: [{ id: 'gx', label: 'Backend', nodeIds: ['new-api', 'new-db'] }],
    };
    const diff = diffDiagramIR(base(), regenerated);
    expect(diff.identical).toBe(true);
    expect(diff.reidentified).toBe(3);
  });

  it('altas, bajas y cambios de conexiones y agrupaciones', () => {
    const after = applySemanticPatch(base(), {
      id: 'p',
      source: 'user',
      operations: [
        { op: 'add-node', node: { id: 'cache', label: 'Caché', kind: 'data' } },
        { op: 'add-edge', edge: { id: 'e3', source: 'api', target: 'cache', label: 'lee' } },
        { op: 'update-edge', edgeId: 'e2', changes: { label: 'SQL/TLS' } },
        { op: 'add-to-group', groupId: 'g1', nodeIds: ['cache'] },
        { op: 'remove-node', nodeId: 'web' },
      ],
    }).ir;
    const diff = diffDiagramIR(base(), after);

    expect(diff.nodes.added.map((n) => n.label)).toEqual(['Caché']);
    expect(diff.nodes.removed.map((n) => n.label)).toEqual(['Web']);
    expect(diff.edges.added).toEqual([{ from: 'API', to: 'Caché', label: 'lee' }]);
    expect(diff.edges.removed).toEqual([{ from: 'Web', to: 'API', label: 'HTTPS' }]);
    expect(diff.edges.changed).toEqual([
      { from: 'API', to: 'Base de datos', label: 'SQL/TLS', changes: [{ field: 'label', before: 'SQL', after: 'SQL/TLS' }] },
    ]);
    expect(diff.groups.changed[0].changes).toEqual([
      { field: 'members', before: 'API, Base de datos', after: 'API, Base de datos, Caché' },
    ]);
    expect(diff.identical).toBe(false);
  });

  it('un cambio de tecnología o criticidad se nombra por campo', () => {
    const after = base();
    after.nodes[1] = { ...after.nodes[1], technology: 'Go', criticality: 'high' };
    const [change] = diffDiagramIR(base(), after).nodes.changed;
    expect(change.changes).toEqual([
      { field: 'technology', before: 'Node', after: 'Go' },
      { field: 'criticality', before: '', after: 'high' },
    ]);
  });
});
