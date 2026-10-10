import { describe, expect, it } from 'vitest';
import {
  applyInventoryCommand,
  buildCapabilityMap,
  createInventoryItem,
  flattenCapabilityMap,
  normalizeInventoryItem,
  normalizeInventoryName,
  type InventoryCommand,
  type InventoryItem,
  type InventoryKind,
} from '../../../services/enterpriseRepository';

const NOW = '2026-10-09T10:00:00.000Z';
const user = '00000000-0000-4000-8000-000000000001';

const make = (name: string, kind: InventoryKind = 'capability'): InventoryItem => {
  const r = createInventoryItem({ userId: user, kind, name }, { now: NOW, existing: [], newId: () => `inv_${normalizeInventoryName(name).replace(/\s/g, '_')}` });
  if (!r.ok) throw new Error(r.rejection.reason);
  return r.item;
};

const run = (item: InventoryItem, command: InventoryCommand, others: InventoryItem[] = []) =>
  applyInventoryCommand(item, command, { now: NOW, others });

const apply = (item: InventoryItem, command: InventoryCommand, others: InventoryItem[] = []): InventoryItem => {
  const r = run(item, command, others);
  if (!r.ok) throw new Error(r.rejection.reason);
  return r.item;
};

describe('mapa de capacidades: comandos', () => {
  it('sólo una capacidad tiene atributos de capacidad', () => {
    const app = make('Core', 'application');
    expect(run(app, { type: 'set-capability-maturity', maturity: 3 })).toMatchObject({ ok: false, rejection: { reason: 'not-a-capability' } });
  });

  it('fija y limpia la madurez; repetir no escribe', () => {
    const cap = make('Suscripción');
    const rated = apply(cap, { type: 'set-capability-maturity', maturity: 4 });
    expect(rated.capability?.maturity).toBe(4);
    expect(run(rated, { type: 'set-capability-maturity', maturity: 4 })).toMatchObject({ ok: true, changed: false });
    expect(apply(rated, { type: 'set-capability-maturity', maturity: null }).capability).toBeUndefined();
    expect(run(cap, { type: 'set-capability-maturity', maturity: 9 as never })).toMatchObject({ ok: false, rejection: { reason: 'invalid-value' } });
  });

  it('el nivel se deriva y no pasa de L3', () => {
    const l1 = make('Negocio');
    const l2 = apply(make('Producto'), { type: 'set-capability-parent', parentId: l1.id }, [l1]);
    const l3 = apply(make('Tarificación'), { type: 'set-capability-parent', parentId: l2.id }, [l1, l2]);
    const l4 = make('Reglas');
    expect(run(l4, { type: 'set-capability-parent', parentId: l3.id }, [l1, l2, l3])).toMatchObject({ ok: false, rejection: { reason: 'capability-too-deep', level: 4 } });
    // mover un L2 con hijos bajo un L2 también desborda
    const other = apply(make('Otro L2'), { type: 'set-capability-parent', parentId: l1.id }, [l1]);
    expect(run(l2, { type: 'set-capability-parent', parentId: other.id }, [l1, other, l3])).toMatchObject({ ok: false, rejection: { reason: 'capability-too-deep' } });
  });

  it('rechaza ciclos y padres que no existen', () => {
    const a = make('A');
    const b = apply(make('B'), { type: 'set-capability-parent', parentId: a.id }, [a]);
    expect(run(a, { type: 'set-capability-parent', parentId: b.id }, [b])).toMatchObject({ ok: false, rejection: { reason: 'capability-cycle' } });
    expect(run(a, { type: 'set-capability-parent', parentId: a.id })).toMatchObject({ ok: false, rejection: { reason: 'capability-cycle' } });
    expect(run(a, { type: 'set-capability-parent', parentId: 'nope' })).toMatchObject({ ok: false, rejection: { reason: 'unknown-parent' } });
  });

  it('una aplicación que soporta tiene que existir en el inventario', () => {
    const cap = make('Suscripción');
    const app = make('Core', 'application');
    expect(run(cap, { type: 'link-supporting-application', applicationId: 'x' }, [app])).toMatchObject({ ok: false, rejection: { reason: 'unknown-application' } });
    const linked = apply(cap, { type: 'link-supporting-application', applicationId: app.id }, [app]);
    expect(linked.capability?.supportedByIds).toEqual([app.id]);
    expect(apply(linked, { type: 'unlink-supporting-application', applicationId: app.id }).capability).toBeUndefined();
  });

  it('lee atributos guardados de forma tolerante', () => {
    const cap = make('Suscripción');
    const raw = { ...cap, capability: { parentId: ' p ', maturity: 7, investment: 'high', risk: 'x', supportedByIds: ['a', 'a', 3] } };
    expect(normalizeInventoryItem(raw, user)?.capability).toEqual({ parentId: 'p', investment: 'high', supportedByIds: ['a'] });
    expect(normalizeInventoryItem({ ...make('Core', 'application'), capability: { maturity: 3 } }, user)?.capability).toBeUndefined();
  });
});

describe('mapa de capacidades: construcción', () => {
  const l1 = make('Negocio');
  const l2a = apply(make('Producto'), { type: 'set-capability-parent', parentId: l1.id }, [l1]);
  const l2b = apply(make('Cliente'), { type: 'set-capability-parent', parentId: l1.id }, [l1]);
  const app = make('Core', 'application');

  it('arma el árbol y marca sin medir como null', () => {
    const map = buildCapabilityMap([l1, l2a, l2b, app]);
    expect(map.roots).toHaveLength(1);
    expect(map.roots[0].children.map((c) => c.item.name)).toEqual(['Cliente', 'Producto']);
    expect(map.roots[0].layers.maturity).toEqual({ intensity: null, value: null, source: null });
    expect(map.total).toBe(3);
  });

  it('el valor del padre se deriva de los hijos medidos y lo dice', () => {
    const rated = apply(l2a, { type: 'set-capability-maturity', maturity: 5 }, [l1]);
    const map = buildCapabilityMap([l1, rated, l2b]);
    expect(map.roots[0].layers.maturity).toMatchObject({ value: 5, intensity: 1, source: 'derived' });
    expect(map.roots[0].children.find((c) => c.item.id === rated.id)?.layers.maturity.source).toBe('declared');
  });

  it('la cobertura se deriva de proyecto → iniciativas por el puerto', () => {
    const linked = apply(l2a, { type: 'link-project', projectId: 'p1' }, [l1]);
    const map = buildCapabilityMap([l1, linked, l2b], new Map([['p1', ['i1', 'i2']]]));
    expect(map.roots[0].initiativeIds).toEqual(['i1', 'i2']);
    expect(map.roots[0].layers.coverage.value).toBe(2);
    expect(map.uncoveredIds).toEqual([l2b.id]);
  });

  it('informa lo que no resuelve en vez de descartarlo', () => {
    const orphan = { ...l2a, capability: { parentId: 'gone', supportedByIds: ['ghost'] } };
    const map = buildCapabilityMap([orphan]);
    expect(map.roots).toHaveLength(1);
    expect(map.issues).toEqual(expect.arrayContaining([
      { type: 'unresolved-parent', capabilityId: orphan.id, parentId: 'gone' },
      { type: 'unresolved-application', capabilityId: orphan.id, applicationId: 'ghost' },
    ]));
  });

  it('no se cuelga con un ciclo guardado y el aplanado es en profundidad', () => {
    const a = { ...make('A'), capability: { parentId: 'inv_b' } };
    const b = { ...make('B'), capability: { parentId: 'inv_a' } };
    expect(() => buildCapabilityMap([a, b])).not.toThrow();
    expect(flattenCapabilityMap(buildCapabilityMap([l1, l2a, l2b])).map((n) => n.level)).toEqual([1, 2, 2]);
  });

  it('las capacidades retiradas no aparecen en el mapa', () => {
    const retired = { ...l2b, lifecycle: 'retired' as const };
    expect(buildCapabilityMap([l1, l2a, retired]).total).toBe(2);
  });
});
