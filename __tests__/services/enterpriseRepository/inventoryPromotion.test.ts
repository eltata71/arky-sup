import { describe, expect, it } from 'vitest';
import {
  acceptPromotion,
  createInventoryItem,
  proposePromotions,
  type InventoryItem,
  type PromotableEntity,
} from '../../../services/enterpriseRepository';

const NOW = '2026-10-09T10:00:00.000Z';
const user = '00000000-0000-4000-8000-000000000001';
const ent = (id: string, projectId: string, name: string, extra: Partial<PromotableEntity> = {}): PromotableEntity => ({
  id, projectId, name, type: 'system', ...extra,
});

describe('promoción asistida al inventario', () => {
  it('propone lo que aparece en dos o más proyectos, agrupando por nombre normalizado', () => {
    const proposals = proposePromotions([
      ent('e1', 'p1', 'Core Pólizas'),
      ent('e2', 'p2', 'core polizas'),
      ent('e3', 'p3', 'Solo Aquí'),
    ], []);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ kind: 'application', projectIds: ['p1', 'p2'] });
    expect(proposals[0].references).toHaveLength(2);
  });

  it('un mismo proyecto repetido no cuenta como dos', () => {
    expect(proposePromotions([ent('e1', 'p1', 'X'), ent('e2', 'p1', 'x')], [])).toEqual([]);
  });

  it('ignora lo ya enlazado y lo que no es inventario', () => {
    const proposals = proposePromotions([
      ent('e1', 'p1', 'Core', { inventoryItemId: 'inv_1' }),
      ent('e2', 'p2', 'Core'),
      ent('e3', 'p1', 'Riesgo', { type: 'risk' }),
      ent('e4', 'p2', 'Riesgo', { type: 'risk' }),
    ], []);
    expect(proposals).toEqual([]);
  });

  it('propone enlazar, no duplicar, cuando el inventario ya responde a ese nombre', () => {
    const existing = createInventoryItem({ userId: user, kind: 'application', name: 'Core Pólizas', aliases: ['PolicyCore'] }, { now: NOW, existing: [], newId: () => 'inv_core' });
    if (!existing.ok) throw new Error('fábrica');
    const [proposal] = proposePromotions([ent('e1', 'p1', 'PolicyCore'), ent('e2', 'p2', 'PolicyCore')], [existing.item]);
    expect(proposal.matchesItem).toEqual({ id: 'inv_core', name: 'Core Pólizas' });
  });

  it('proponer no crea nada: sólo aceptar produce un plan', () => {
    const inventory: InventoryItem[] = [];
    const [proposal] = proposePromotions([ent('e1', 'p1', 'Core'), ent('e2', 'p2', 'Core')], inventory);
    expect(inventory).toEqual([]);
    const plan = acceptPromotion(proposal, { userId: user, now: NOW, inventory, newId: () => 'inv_new' });
    expect(plan).toMatchObject({ ok: true, created: true });
    if (plan.ok) {
      expect(plan.item).toMatchObject({ id: 'inv_new', projectIds: ['p1', 'p2'], lifecycle: 'candidate' });
      expect(plan.references.map((r) => r.entityId)).toEqual(['e1', 'e2']);
    }
  });

  it('aceptar sobre un elemento existente lo extiende sin crear otro', () => {
    const existing = createInventoryItem({ userId: user, kind: 'application', name: 'Core', projectIds: ['p1'] }, { now: NOW, existing: [], newId: () => 'inv_core' });
    if (!existing.ok) throw new Error('fábrica');
    const [proposal] = proposePromotions([ent('e1', 'p1', 'Core'), ent('e2', 'p2', 'Core')], [existing.item]);
    const plan = acceptPromotion(proposal, { userId: user, now: NOW, inventory: [existing.item] });
    expect(plan).toMatchObject({ ok: true, created: false });
    if (plan.ok) expect(plan.item.projectIds).toEqual(['p1', 'p2']);
  });
});
