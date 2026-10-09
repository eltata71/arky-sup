import { describe, expect, it } from 'vitest';
import {
  applyInventoryCommand,
  buildCapabilityExportRows,
  buildCapabilityMap,
  createInventoryItem,
  normalizeInventoryName,
  type InventoryItem,
} from '../../../services/enterpriseRepository';
import { buildTableDeck } from '../../../services/export';

const NOW = '2026-10-09T10:00:00.000Z';
const make = (name: string): InventoryItem => {
  const r = createInventoryItem(
    { userId: '00000000-0000-4000-8000-000000000001', kind: 'capability', name },
    { now: NOW, existing: [], newId: () => `inv_${normalizeInventoryName(name).replace(/\s/g, '_')}` },
  );
  if (!r.ok) throw new Error(r.rejection.reason);
  return r.item;
};

describe('mapa de capacidades: filas de exportación', () => {
  it('una fila por capacidad, en orden de lectura, con el valor en palabras y lo sin medir sin intensidad', () => {
    const root = make('Negocio');
    const child0 = make('Producto');
    const r = applyInventoryCommand(child0, { type: 'set-capability-parent', parentId: root.id }, { now: NOW, others: [root] });
    if (!r.ok) throw new Error('parent');
    const rated = applyInventoryCommand(root, { type: 'set-capability-maturity', maturity: 4 }, { now: NOW, others: [] });
    if (!rated.ok) throw new Error('maturity');
    const map = buildCapabilityMap([rated.item, r.item], new Map());
    const rows = buildCapabilityExportRows(map, 'maturity', (_l, v) => (v.intensity === null ? 'sin medir' : `valor ${v.value}`));
    expect(rows.map((x) => [x.level, x.name])).toEqual([[1, 'Negocio'], [2, 'Producto']]);
    expect(rows[0].intensity).not.toBeNull();
    expect(rows[1]).toMatchObject({ value: 'sin medir', intensity: null });
  });
});

describe('buildTableDeck', () => {
  const summary = (n: number) => ({
    title: 'Mapa',
    subtitle: 'sub',
    kpis: [{ label: 'Capacidades', value: String(n) }],
    tableTitle: 'Tabla',
    headers: ['A', 'B'],
    rows: Array.from({ length: n }, (_, i) => [`c${i}`, 'x']),
    callout: { title: 'Sin cobertura', body: 'c1' },
  });

  it('pagina la tabla de 10 en 10 y cierra con el aviso', () => {
    const deck = buildTableDeck(summary(25));
    expect(deck.kind).toBe('presentation');
    // portada + KPI + 3 páginas de tabla + resumen
    expect(deck.slides).toHaveLength(6);
  });

  it('una tabla vacía no inventa páginas', () => {
    expect(buildTableDeck(summary(0)).slides.length).toBeLessThanOrEqual(5);
  });
});
