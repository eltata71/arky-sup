import { describe, expect, it } from 'vitest';
import {
  applyInventoryCommand,
  createInventoryItem,
  normalizeInventoryItem,
  normalizeInventoryName,
  type InventoryItem,
} from '../../../services/enterpriseRepository';

const NOW = '2026-10-09T10:00:00.000Z';
const LATER = '2026-10-10T10:00:00.000Z';
const user = '00000000-0000-4000-8000-000000000001';

const make = (name: string, extra: Partial<Parameters<typeof createInventoryItem>[0]> = {}, existing: InventoryItem[] = []) => {
  const result = createInventoryItem({ userId: user, kind: 'application', name, ...extra }, { now: NOW, existing, newId: () => `inv_${normalizeInventoryName(name).replace(/\s/g, '_')}` });
  if (!result.ok) throw new Error(result.rejection.reason);
  return result.item;
};

describe('inventario empresarial: dominio', () => {
  it('normaliza nombres sin acentos, mayúsculas ni puntuación', () => {
    expect(normalizeInventoryName('  Núcleo Póliza (v2) ')).toBe(normalizeInventoryName('nucleo poliza v2'));
  });

  it('la fábrica rechaza lo que no es un elemento', () => {
    const ctx = { now: NOW, existing: [] };
    expect(createInventoryItem({ userId: '', kind: 'application', name: 'X' }, ctx)).toMatchObject({ ok: false, rejection: { reason: 'missing-user' } });
    expect(createInventoryItem({ userId: user, kind: 'application', name: '  ' }, ctx)).toMatchObject({ ok: false, rejection: { reason: 'missing-name' } });
    expect(createInventoryItem({ userId: user, kind: 'otro' as never, name: 'X' }, ctx)).toMatchObject({ ok: false, rejection: { reason: 'invalid-kind' } });
  });

  it('rechaza un duplicado por nombre normalizado o por alias, pero no entre tipos', () => {
    const core = make('Core Pólizas', { aliases: ['PolicyCore'] });
    const ctx = { now: NOW, existing: [core] };
    expect(createInventoryItem({ userId: user, kind: 'application', name: 'core polizas' }, ctx)).toMatchObject({ ok: false, rejection: { reason: 'duplicate', existingId: core.id } });
    expect(createInventoryItem({ userId: user, kind: 'application', name: 'policycore' }, ctx)).toMatchObject({ ok: false, rejection: { reason: 'duplicate' } });
    expect(createInventoryItem({ userId: user, kind: 'technology', name: 'Core Pólizas' }, ctx).ok).toBe(true);
  });

  it('nace como candidato', () => {
    expect(make('Portal Corredores').lifecycle).toBe('candidate');
  });

  it('renombrar conserva el nombre anterior como alias', () => {
    const item = make('Portal Corredores');
    const result = applyInventoryCommand(item, { type: 'rename', name: 'Portal de Intermediarios' }, { now: LATER, others: [] });
    expect(result).toMatchObject({ ok: true, changed: true });
    if (result.ok) {
      expect(result.item.name).toBe('Portal de Intermediarios');
      expect(result.item.aliases).toContain('Portal Corredores');
    }
  });

  it('un comando que no cambia nada devuelve el mismo objeto', () => {
    const item = make('Portal Corredores', { projectIds: ['p1'] });
    const result = applyInventoryCommand(item, { type: 'link-project', projectId: 'p1' }, { now: LATER, others: [] });
    expect(result).toMatchObject({ ok: true, changed: false });
    if (result.ok) expect(result.item).toBe(item);
  });

  it('no renombra a un nombre que otro elemento ya usa', () => {
    const a = make('A');
    const b = make('B');
    expect(applyInventoryCommand(b, { type: 'rename', name: 'a' }, { now: LATER, others: [a] })).toMatchObject({ ok: false, rejection: { reason: 'duplicate' } });
  });

  it('el ciclo de vida avanza y retired es terminal', () => {
    const item = make('Legado');
    const ctx = { now: LATER, others: [] };
    const active = applyInventoryCommand(item, { type: 'set-lifecycle', lifecycle: 'active' }, ctx);
    if (!active.ok) throw new Error('active');
    const retired = applyInventoryCommand(active.item, { type: 'set-lifecycle', lifecycle: 'retired' }, ctx);
    if (!retired.ok) throw new Error('retired');
    expect(applyInventoryCommand(retired.item, { type: 'set-lifecycle', lifecycle: 'active' }, ctx)).toMatchObject({ ok: false, rejection: { reason: 'illegal-transition' } });
  });

  it('enlaza y desenlaza proyectos por id', () => {
    const item = make('Legado');
    const ctx = { now: LATER, others: [] };
    const linked = applyInventoryCommand(item, { type: 'link-project', projectId: 'p9' }, ctx);
    if (!linked.ok) throw new Error('link');
    expect(linked.item.projectIds).toEqual(['p9']);
    const unlinked = applyInventoryCommand(linked.item, { type: 'unlink-project', projectId: 'p9' }, ctx);
    if (!unlinked.ok) throw new Error('unlink');
    expect(unlinked.item.projectIds).toEqual([]);
  });

  it('lee un registro guardado y descarta el que no lo es', () => {
    const item = make('Legado');
    expect(normalizeInventoryItem(item, user)).toMatchObject({ id: item.id, kind: 'application' });
    expect(normalizeInventoryItem({ id: 'x', kind: 'raro' }, user)).toBeNull();
    expect(normalizeInventoryItem(null, user)).toBeNull();
  });
});
