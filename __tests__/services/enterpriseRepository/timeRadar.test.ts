import { describe, expect, it } from 'vitest';
import {
  applyInventoryCommand,
  buildApplicationPortfolio,
  buildTechnologyRadar,
  classifyTime,
  createInventoryItem,
  type InventoryItem,
  type InventoryKind,
} from '../../../services/enterpriseRepository';

const NOW = '2026-10-10T10:00:00.000Z';
const user = '00000000-0000-4000-8000-000000000001';

const make = (name: string, kind: InventoryKind = 'application', aliases: string[] = []): InventoryItem => {
  const r = createInventoryItem({ userId: user, kind, name, aliases }, { now: NOW, existing: [], newId: () => `inv_${name}` });
  if (!r.ok) throw new Error(r.rejection.reason);
  return r.item;
};
const apply = (item: InventoryItem, command: Parameters<typeof applyInventoryCommand>[1]) => applyInventoryCommand(item, command, { now: NOW, others: [] });

describe('TIME: el cuadrante se calcula, nunca se elige', () => {
  it('sin las dos puntuaciones no hay cuadrante', () => {
    expect(classifyTime(undefined, undefined)).toBeNull();
    expect(classifyTime(4, undefined)).toBeNull();
    expect(classifyTime(undefined, 2)).toBeNull();
  });

  it('cruza ajuste funcional y técnico', () => {
    expect(classifyTime(5, 5)).toBe('invest');
    expect(classifyTime(5, 1)).toBe('migrate');
    expect(classifyTime(1, 5)).toBe('tolerate');
    expect(classifyTime(1, 1)).toBe('eliminate');
  });

  it('el portafolio separa lo no evaluado y excluye lo retirado', () => {
    const a = { ...make('A'), application: { functionalFit: 5, technicalFit: 5 } } as InventoryItem;
    const b = make('B');
    const c = { ...make('C'), lifecycle: 'retired', application: { functionalFit: 1, technicalFit: 1 } } as InventoryItem;
    const p = buildApplicationPortfolio([a, b, c, make('Tech', 'technology')]);
    expect(p.entries).toHaveLength(2);
    expect(p.byQuadrant.invest.map((e) => e.item.name)).toEqual(['A']);
    expect(p.unassessed.map((e) => e.item.name)).toEqual(['B']);
    expect(p.assessedCount).toBe(1);
  });
});

describe('comandos de TIME y radar', () => {
  it('puntúa una aplicación y rechaza valores fuera de escala', () => {
    const app = make('Core');
    const r = apply(app, { type: 'set-application-functional-fit', score: 4 });
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(apply(app, { type: 'set-application-functional-fit', score: 9 as never })).toMatchObject({ ok: false });
  });

  it('un comando que no cambia nada devuelve el mismo objeto', () => {
    const app = make('Core');
    const r1 = apply(app, { type: 'set-application-technical-fit', score: 2 });
    if (!r1.ok) throw new Error('x');
    const r2 = apply(r1.item, { type: 'set-application-technical-fit', score: 2 });
    expect(r2).toMatchObject({ ok: true, changed: false });
    if (r2.ok) expect(r2.item).toBe(r1.item);
  });

  it('puntuar sólo vale para aplicaciones y el anillo sólo para tecnologías', () => {
    expect(apply(make('T', 'technology'), { type: 'set-application-functional-fit', score: 3 })).toMatchObject({ ok: false, rejection: { reason: 'not-an-application' } });
    expect(apply(make('A'), { type: 'set-technology-ring', ring: 'adopt' })).toMatchObject({ ok: false, rejection: { reason: 'not-a-technology' } });
  });

  it('null borra la puntuación: sin medir no es cero', () => {
    const r1 = apply(make('Core'), { type: 'set-application-functional-fit', score: 3 });
    if (!r1.ok) throw new Error('x');
    const r2 = apply(r1.item, { type: 'set-application-functional-fit', score: null });
    if (!r2.ok) throw new Error('x');
    expect(r2.item.application?.functionalFit).toBeUndefined();
  });
});

describe('radar tecnológico', () => {
  it('agrupa por anillo declarado y deja sin clasificar el resto', () => {
    const ts = apply(make('Kafka', 'technology'), { type: 'set-technology-ring', ring: 'adopt' });
    if (!ts.ok) throw new Error('x');
    const radar = buildTechnologyRadar([ts.item, make('Cobol', 'technology')], []);
    expect(radar.byRing.adopt).toHaveLength(1);
    expect(radar.unclassified.map((e) => e.item.name)).toEqual(['Cobol']);
    expect(radar.standardsCount).toBe(0);
  });

  it('adjunta los estándares que nombran la tecnología, por palabra completa', () => {
    const radar = buildTechnologyRadar(
      [make('Kafka', 'technology'), make('Go', 'technology', ['Golang'])],
      [
        { id: 's1', domain: 'datos', statement: 'Los eventos viajan por Kafka.' },
        { id: 's2', domain: 'x', statement: 'Usar Golangci para lint' },
      ],
    );
    expect(radar.entries.find((e) => e.item.name === 'Kafka')?.standards.map((s) => s.id)).toEqual(['s1']);
    expect(radar.entries.find((e) => e.item.name === 'Go')?.standards).toHaveLength(0);
    expect(radar.standardsCount).toBe(2);
  });
});
