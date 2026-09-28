/**
 * El editor de la historia sin montar el panel (plan de diagramas, 4.3): el
 * borrador es lo que hace el motor, se guarda como una versión con su nota, y
 * no se guarda si el diagrama cambió por debajo mientras se editaba.
 */
import { describe, expect, it } from 'vitest';
import type { Artifact } from '../../../lib/artifacts';
import type { DiagramIR, DiagramPatchOperation } from '../../../lib/diagram';
import {
  acceptsStoryOperation,
  planStoryEdit,
  previewStoryEdit,
  readStoryDraft,
  resolveStoryBase,
} from '../../../services/artifacts/application/diagramStoryEditing';

const ir = (): DiagramIR => ({
  nodes: [
    { id: 'cliente', label: 'Cliente', kind: 'person', position: { x: 0, y: 0 } },
    { id: 'api', label: 'API', kind: 'service', position: { x: 200, y: 0 } },
  ],
  edges: [{ id: 'e1', source: 'cliente', target: 'api', label: 'llama' }],
  groups: [],
  metadata: { layoutMode: 'manual', narrative: { summary: 'Dos nodos.', source: 'derived' }, qualityReview: { score: 90, issues: [] } },
});

const artifact = (overrides: Partial<Artifact> = {}): Artifact => ({
  id: 'a1',
  versionGroupId: 'a1',
  version: 3,
  createdAt: '2026-09-28T00:00:00.000Z',
  name: 'Flujo',
  type: 'mermaid-graph',
  phase: 'Diseño',
  architecturalView: 'Vista Lógica y de Diseño',
  content: 'graph TD; cliente-->api',
  objective: '',
  keyConcepts: [],
  representation: 'diagram',
  ir: ir(),
  ...overrides,
});

const ops: DiagramPatchOperation[] = [
  { op: 'add-scene', scene: { id: 's1', title: 'La entrada', focusNodeIds: ['cliente'], focusEdgeIds: [] } },
  { op: 'set-story-message', message: 'Todo entra por la API.' },
];

describe('borrador', () => {
  it('lee la historia derivada como tal, y el borrador editado como escrito', () => {
    expect(readStoryDraft(ir()).authorship).toBe('derived');
    const preview = previewStoryEdit(resolveStoryBase(artifact())!, ops);
    expect(preview.draft).toMatchObject({ authorship: 'authored', message: 'Todo entra por la API.' });
    expect(preview.draft.scenes.map((s) => s.title)).toEqual(['La entrada']);
    expect(preview.draft.edges[0].label).toBe('Cliente → API (llama)');
  });

  it('un diagrama sin historia se lee como «sin historia»', () => {
    const bare = { ...ir(), metadata: {} };
    expect(readStoryDraft(bare).authorship).toBe('none');
  });

  it('una operación que el motor rechaza no entra en el borrador', () => {
    const base = resolveStoryBase(artifact())!;
    expect(acceptsStoryOperation(base, { op: 'remove-scene', sceneId: 'nada' })?.code).toBe('unknown-scene');
    expect(acceptsStoryOperation(base, ops[0])).toBeNull();
  });
});

describe('guardar', () => {
  const now = () => '2026-09-28T12:00:00.000Z';

  it('crea una versión con la historia escrita, su nota y sin la revisión obsoleta; conserva posiciones y texto', () => {
    const source = artifact();
    const preview = previewStoryEdit(resolveStoryBase(source)!, ops);
    const plan = planStoryEdit({ artifact: source, preview, operations: ops, now });
    expect(plan.kind).toBe('version');
    if (plan.kind !== 'version') return;
    expect(plan.draft.content).toBe(source.content);
    expect(plan.draft.ir?.nodes[1].position).toEqual({ x: 200, y: 0 });
    expect(plan.draft.ir?.metadata?.qualityReview).toBeUndefined();
    expect(plan.draft.ir?.metadata?.narrative).toMatchObject({ source: 'authored', summary: 'Todo entra por la API.' });
    expect(plan.draft.changeNote).toMatchObject({ kind: 'diagram-patch', basedOnVersion: 3, instruction: 'Historia editada a mano', at: now() });
    expect(plan.summary).toHaveLength(2);
  });

  it('no guarda si el diagrama cambió mientras se editaba', () => {
    const preview = previewStoryEdit(resolveStoryBase(artifact())!, ops);
    const changed = artifact({ ir: { ...ir(), nodes: [ir().nodes[1]], edges: [] } });
    expect(planStoryEdit({ artifact: changed, preview, operations: ops }).kind).toBe('stale');
  });

  it('sin operaciones no hay nada que guardar', () => {
    const preview = previewStoryEdit(resolveStoryBase(artifact())!, []);
    expect(planStoryEdit({ artifact: artifact(), preview, operations: [] }).kind).toBe('no-change');
  });
});
