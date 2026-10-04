import { describe, expect, it, vi } from 'vitest';
import type { Artifact } from '../../../lib/artifacts';
import { createAiUndoEntry, createAiUndoStore, planAiUndo } from '../../../services/artifacts/application/aiUndo';

const version = (id: string, group: string, n: number): Artifact => ({ id, versionGroupId: group, version: n, name: 'A' } as Artifact);

describe('planAiUndo', () => {
  const before = version('v1', 'g', 1);
  const entry = createAiUndoEntry({ projectId: 'p', label: 'x', steps: [{ before, producedId: 'v2' }] });

  it('restaura la anterior cuando la versión de la IA sigue siendo la última', () => {
    const plan = planAiUndo(entry, [before, version('v2', 'g', 2)]);
    expect(plan).toEqual({ kind: 'restore', drafts: [before] });
  });

  it('no deshace si hubo cambios posteriores', () => {
    const plan = planAiUndo(entry, [before, version('v2', 'g', 2), version('v3', 'g', 3)]);
    expect(plan.kind).toBe('superseded');
  });

  it('informa si el artefacto ya no existe', () => {
    expect(planAiUndo(entry, [before]).kind).toBe('missing');
  });

  it('exige todos los pasos de un cambio de varios artefactos', () => {
    const multi = createAiUndoEntry({
      projectId: 'p',
      label: 'm',
      steps: [{ before, producedId: 'v2' }, { before: version('h1', 'h', 1), producedId: 'h2' }],
    });
    const ok = [before, version('v2', 'g', 2), version('h1', 'h', 1), version('h2', 'h', 2)];
    expect(planAiUndo(multi, ok)).toMatchObject({ kind: 'restore' });
    expect(planAiUndo(multi, [...ok, version('h3', 'h', 3)]).kind).toBe('superseded');
  });
});

describe('createAiUndoStore', () => {
  it('guarda sólo el último, avisa y limpia por id', () => {
    const store = createAiUndoStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const a = createAiUndoEntry({ projectId: 'p', label: 'a', steps: [] });
    const b = createAiUndoEntry({ projectId: 'p', label: 'b', steps: [] });
    store.set(a);
    store.set(b);
    expect(store.get()).toBe(b);
    store.clear(a.id);
    expect(store.get()).toBe(b);
    store.clear(b.id);
    expect(store.get()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
