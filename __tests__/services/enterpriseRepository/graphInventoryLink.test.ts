import { describe, expect, it } from 'vitest';
import { consolidateEntities } from '../../../services/architectureKnowledgeGraph/ArchitectureGraphDeduplication';
import type { ArchitectureGraph, RawEntitySignal } from '../../../services/architectureKnowledgeGraph/ArchitectureKnowledgeGraphTypes';

describe('el grafo conserva el enlace al inventario al reconstruirse', () => {
  it('una reconstrucción no pierde inventoryItemId', () => {
    const signal = {
      name: 'Core Pólizas',
      type: 'system',
      source: { artifactId: 'a1', artifactName: 'A', artifactType: 'c4', confidence: 0.9 },
    } as unknown as RawEntitySignal;
    const first = consolidateEntities([signal], 'p1', '2026-10-09T00:00:00.000Z');
    const previous = { entities: first.map((e) => ({ ...e, inventoryItemId: 'inv_core' })), relations: [] } as unknown as ArchitectureGraph;
    const again = consolidateEntities([signal], 'p1', '2026-10-10T00:00:00.000Z', previous);
    expect(again[0].inventoryItemId).toBe('inv_core');
    expect(first[0].inventoryItemId).toBeUndefined();
  });
});
