/**
 * Las operaciones de historia del motor de patches (plan de diagramas, 4.3).
 *
 * El criterio de «terminado» de la tarea es la última prueba: una historia
 * escrita queda marcada `authored` y el planificador la recorre en vez de la
 * derivada. Las demás fijan que el motor la trata como a todo lo demás: se
 * comprueba antes de aplicar, nunca enfoca un id que no existe, y lo que no
 * cambia nada se rechaza.
 */
import { describe, expect, it } from 'vitest';
import type { DiagramIR, DiagramNarrative, DiagramPatchOperation } from '../../lib/diagram';
import { applySemanticPatch } from '../../services/diagram/semanticPatchEngine';
import { buildStoryPlan } from '../../services/diagram/storyPlanner';

const baseIR = (narrative?: DiagramNarrative): DiagramIR => ({
  nodes: [
    { id: 'cliente', label: 'Cliente', kind: 'person' },
    { id: 'api', label: 'API de reservas', kind: 'service' },
    { id: 'db', label: 'Reservas DB', kind: 'data' },
  ],
  edges: [
    { id: 'e1', source: 'cliente', target: 'api', label: 'reserva' },
    { id: 'e2', source: 'api', target: 'db', label: 'persiste' },
  ],
  groups: [],
  metadata: narrative ? { narrative } : {},
});

const apply = (ir: DiagramIR, ...operations: DiagramPatchOperation[]) =>
  applySemanticPatch(ir, { id: 'p', source: 'user', operations });

const narrativeOf = (ir: DiagramIR) => ir.metadata?.narrative as DiagramNarrative;

const scene = (id: string, title: string, focusNodeIds: string[] = []): DiagramPatchOperation =>
  ({ op: 'add-scene', scene: { id, title, focusNodeIds, focusEdgeIds: [] } });

describe('escenas', () => {
  it('se añaden, se reordenan y se quitan, y la narrativa queda escrita', () => {
    const result = apply(
      baseIR(),
      scene('s1', 'Entrada', ['cliente']),
      scene('s2', 'Persistencia', ['db']),
      scene('s0', 'Contexto', ['api']),
      { op: 'move-scene', sceneId: 's0', toIndex: 0 },
      { op: 'remove-scene', sceneId: 's2' },
    );
    expect(result.rejected).toEqual([]);
    const narrative = narrativeOf(result.ir);
    expect(narrative.scenes?.map((s) => s.id)).toEqual(['s0', 's1']);
    expect(narrative.source).toBe('authored');
  });

  it('descarta del foco los ids que no existen, y lo dice', () => {
    const result = apply(baseIR(), scene('s1', 'Entrada', ['cliente', 'fantasma']));
    expect(narrativeOf(result.ir).scenes?.[0].focusNodeIds).toEqual(['cliente']);
    expect(result.applied[0].cascaded).toContain('1 id(s) inexistentes descartados del foco.');
  });

  it('rechaza lo inválido y lo que no cambia nada', () => {
    const withScene = apply(baseIR(), scene('s1', 'Entrada')).ir;
    const codes = (...ops: DiagramPatchOperation[]) => apply(withScene, ...ops).rejected.map((r) => r.code);
    expect(codes(scene('s1', 'Otra'))).toEqual(['duplicate-id']);
    expect(codes(scene('s2', '   '))).toEqual(['invalid-shape']);
    expect(codes({ op: 'remove-scene', sceneId: 'nada' })).toEqual(['unknown-scene']);
    expect(codes({ op: 'move-scene', sceneId: 's1', toIndex: 0 })).toEqual(['no-effect']);
    expect(codes({ op: 'update-scene', sceneId: 's1', changes: { title: '' } })).toEqual(['invalid-shape']);
  });

  it('borrar un nodo o una conexión los retira del foco de las escenas', () => {
    const withScene = apply(baseIR(), {
      op: 'add-scene', scene: { id: 's1', title: 'Datos', focusNodeIds: ['api', 'db'], focusEdgeIds: ['e2'] },
    }).ir;
    const result = apply(withScene, { op: 'remove-node', nodeId: 'db' });
    const [kept] = narrativeOf(result.ir).scenes ?? [];
    expect(kept.focusNodeIds).toEqual(['api']);
    expect(kept.focusEdgeIds).toEqual([]);
    expect(result.applied[0].cascaded).toContain('Retirado del foco de 1 escena(s) de la historia.');
  });
});

describe('mensaje', () => {
  it('se escribe y se retira; repetirlo no es un cambio', () => {
    const written = apply(baseIR(), { op: 'set-story-message', message: 'Toda reserva pasa por una API.' }).ir;
    expect(narrativeOf(written)).toMatchObject({ summary: 'Toda reserva pasa por una API.', source: 'authored' });
    expect(apply(written, { op: 'set-story-message', message: 'Toda reserva pasa por una API.' }).rejected[0].code).toBe('no-effect');
    const cleared = apply(written, { op: 'set-story-message', message: '' }).ir;
    expect(narrativeOf(cleared).summary).toBeUndefined();
    expect(apply(baseIR(), { op: 'set-story-message', message: '' }).rejected[0].code).toBe('no-effect');
  });
});

describe('una historia escrita gana a la derivada', () => {
  const derived = baseIR({ summary: 'Diagrama de 3 nodos y 2 conexiones.', source: 'derived' });

  it('la primera edición retira el resumen que compuso la reparación y lo dice', () => {
    const result = apply(derived, scene('s1', 'Entrada', ['cliente']));
    const narrative = narrativeOf(result.ir);
    expect(narrative.source).toBe('authored');
    expect(narrative.summary).toBeUndefined();
    expect(result.applied[0].cascaded).toContain('El resumen derivado de la topología se retira: la historia pasa a ser escrita.');
  });

  it('una anotación también la hace escrita', () => {
    const result = apply(derived, { op: 'add-callout', callout: { id: 'c1', targetId: 'db', text: 'Único almacén.' } });
    expect(narrativeOf(result.ir).source).toBe('authored');
  });

  it('el planificador recorre las escenas escritas, en su orden, en vez de las derivadas', () => {
    expect(buildStoryPlan(derived)?.source).toBe('derived');
    const written = apply(
      derived,
      scene('s1', 'Los datos', ['db']),
      scene('s2', 'La entrada', ['cliente']),
      { op: 'set-story-message', message: 'La reserva se persiste una sola vez.' },
    ).ir;
    const plan = buildStoryPlan(written);
    expect(plan?.source).toBe('authored');
    expect(plan?.primaryMessage).toBe('La reserva se persiste una sola vez.');
    expect(plan?.steps.map((step) => step.title)).toEqual(['Los datos', 'La entrada']);
  });
});
