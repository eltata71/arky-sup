/**
 * La consolidación de lo que los proyectos mueven en una iniciativa.
 *
 * Las cuatro decisiones que sostiene el módulo son las cuatro cosas que se
 * prueban: lo no declarado no entra en la media, los pesos se respetan o se
 * reparten por igual diciéndolo, las referencias rotas se reportan y la
 * cobertura se mide en las dos direcciones.
 */

import { describe, it, expect } from 'vitest';
import {
  rollUpInitiativeDelivery,
  type DeliveryContributor,
} from '../../services/businessInitiatives/initiativeDelivery';

const initiative = {
  expectedOutcomes: [
    { id: 'out-1', statement: 'Emitir una póliza en menos de 5 minutos' },
    { id: 'out-2', statement: 'Reducir el reproceso de siniestros' },
  ],
  kpis: [
    { id: 'kpi-1', name: 'Tiempo de emisión', unit: 'min' },
    { id: 'kpi-2', name: 'Reproceso', unit: '%' },
  ],
};

const contributor = (overrides: Partial<DeliveryContributor> = {}): DeliveryContributor => ({
  projectId: 'proj-1',
  name: 'Proyecto',
  progress: null,
  health: 'on-track',
  contributions: [],
  risks: { total: 0, severe: 0 },
  ...overrides,
});

describe('rollUpInitiativeDelivery', () => {
  it('sin proyectos no inventa un avance: lo deja sin declarar', () => {
    const rollup = rollUpInitiativeDelivery(initiative, []);
    expect(rollup.total).toBe(0);
    expect(rollup.progress).toBeNull();
    expect(rollup.weighting).toBe('none');
    expect(rollup.uncoveredOutcomeIds).toEqual(['out-1', 'out-2']);
  });

  it('un proyecto sin avance declarado no arrastra la media hacia cero', () => {
    const rollup = rollUpInitiativeDelivery(initiative, [
      contributor({ projectId: 'a', progress: 0.8 }),
      contributor({ projectId: 'b', progress: null }),
    ]);
    expect(rollup.progress).toBeCloseTo(0.8);
    expect(rollup.measured).toBe(1);
    expect(rollup.total).toBe(2);
  });

  it('sin pesos declarados reparte por igual y lo dice', () => {
    const rollup = rollUpInitiativeDelivery(initiative, [
      contributor({ projectId: 'a', progress: 1 }),
      contributor({ projectId: 'b', progress: 0 }),
    ]);
    expect(rollup.progress).toBeCloseTo(0.5);
    expect(rollup.weighting).toBe('even');
    expect(rollup.declaredWeight).toBe(0);
  });

  it('con pesos declarados pondera, y lo dice', () => {
    const rollup = rollUpInitiativeDelivery(initiative, [
      contributor({
        projectId: 'a',
        progress: 1,
        contributions: [{ id: 'c1', statement: 'x', weight: 75, state: 'in-progress' }],
      }),
      contributor({
        projectId: 'b',
        progress: 0,
        contributions: [{ id: 'c2', statement: 'y', weight: 25, state: 'planned' }],
      }),
    ]);
    expect(rollup.progress).toBeCloseTo(0.75);
    expect(rollup.weighting).toBe('declared');
    expect(rollup.declaredWeight).toBe(100);
  });

  it('un proyecto sin peso en un portafolio que sí los usa cuenta como uno', () => {
    const rollup = rollUpInitiativeDelivery(initiative, [
      contributor({
        projectId: 'a',
        progress: 1,
        contributions: [{ id: 'c1', statement: 'x', weight: 3, state: 'in-progress' }],
      }),
      contributor({ projectId: 'b', progress: 0 }),
    ]);
    // 3 · 1 + 1 · 0 sobre 4: el que no declaró peso sigue contando.
    expect(rollup.progress).toBeCloseTo(0.75);
  });

  it('mide la cobertura en las dos direcciones', () => {
    const rollup = rollUpInitiativeDelivery(initiative, [
      contributor({
        contributions: [{ id: 'c1', statement: 'x', outcomeId: 'out-1', kpiId: 'kpi-1', state: 'planned' }],
      }),
    ]);
    expect(rollup.uncoveredOutcomeIds).toEqual(['out-2']);
    expect(rollup.uncoveredKpiIds).toEqual(['kpi-2']);
  });

  it('reporta una referencia rota en vez de descartar la contribución', () => {
    const rollup = rollUpInitiativeDelivery(initiative, [
      contributor({
        projectId: 'a',
        contributions: [{ id: 'c1', statement: 'x', outcomeId: 'out-borrado', state: 'planned' }],
      }),
    ]);
    expect(rollup.danglingReferences).toEqual([
      { projectId: 'a', contributionId: 'c1', reason: 'unknown-outcome', reference: 'out-borrado' },
    ]);
    // Y no cuenta como cobertura de nada.
    expect(rollup.uncoveredOutcomeIds).toEqual(['out-1', 'out-2']);
  });

  it('hereda los riesgos severos y saca a la luz lo bloqueado', () => {
    const rollup = rollUpInitiativeDelivery(initiative, [
      contributor({
        projectId: 'a',
        health: 'off-track',
        risks: { total: 4, severe: 2 },
        contributions: [{ id: 'c1', statement: 'Migración del core', state: 'blocked' }],
      }),
      contributor({ projectId: 'b', health: 'closed' }),
    ]);
    expect(rollup.inheritedSevereRisks).toBe(2);
    expect(rollup.offTrack).toBe(1);
    expect(rollup.closed).toBe(1);
    expect(rollup.blocked).toHaveLength(1);
    expect(rollup.blocked[0].projectId).toBe('a');
  });
});
