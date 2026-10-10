import { describe, expect, it } from 'vitest';
import { analyzeGaps } from '../../../services/enterpriseRepository/application/gapAnalysis';
import type { InventoryItem } from '../../../services/enterpriseRepository/domain/InventoryTypes';

const item = (id: string, over: Partial<InventoryItem> = {}): InventoryItem => ({
  id, schemaVersion: 1, userId: 'u', kind: 'application', name: id.toUpperCase(), normalizedName: id, aliases: [],
  description: '', lifecycle: 'active', projectIds: [], createdAt: '2027-01-01', updatedAt: '2027-01-01', ...over,
});

describe('analyzeGaps', () => {
  const inventory = [
    item('a'), item('b'), item('c'), item('d', { kind: 'capability', capability: { maturity: 2 } }),
  ];

  it('clasifica por pertenencia y por estado deseado', () => {
    const r = analyzeGaps({
      baseline: [{ itemId: 'a' }, { itemId: 'b' }, { itemId: 'd' }],
      target: [{ itemId: 'b' }, { itemId: 'c' }, { itemId: 'd', desired: { maturity: 4 } }],
    }, inventory);
    const byId = Object.fromEntries(r.entries.map((e) => [e.itemId, e]));
    expect(byId.a.action).toBe('eliminate');
    expect(byId.b.action).toBe('keep');
    expect(byId.c.action).toBe('new');
    expect(byId.d.action).toBe('modify');
    expect(byId.d.changes).toEqual(['maturity']);
    expect(r.counts).toEqual({ keep: 1, eliminate: 1, new: 1, modify: 1 });
  });

  it('un estado deseado igual al actual no es modificación', () => {
    const r = analyzeGaps({
      baseline: [{ itemId: 'd' }],
      target: [{ itemId: 'd', desired: { maturity: 2, lifecycle: 'active' } }],
    }, inventory);
    expect(r.entries[0].action).toBe('keep');
  });

  it('informa los ids que no resuelven en vez de descartarlos', () => {
    const r = analyzeGaps({ baseline: [{ itemId: 'zz' }], target: [] }, inventory);
    expect(r.entries).toEqual([]);
    expect(r.issues).toEqual([{ kind: 'unresolved-item', itemId: 'zz', side: 'baseline' }]);
  });

  it('sin plan no hay brechas, no un plan "sin cambios"', () => {
    expect(analyzeGaps(undefined, inventory).entries).toEqual([]);
  });
});
