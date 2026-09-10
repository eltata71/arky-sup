/**
 * El seguimiento de un proyecto de arquitectura, como reglas.
 *
 * Lo que se prueba aquí es sobre todo lo que el módulo se niega a afirmar: que
 * un proyecto sin medir no avanza un 0 %, que un semáforo no se elige y que una
 * estimación se distingue de un dato.
 */

import { describe, it, expect } from 'vitest';
import {
  attentionDaysRemaining,
  attentionHealth,
  attentionProgress,
  contributionsToInitiative,
  describeAttentionDelivery,
  isClosedAttention,
  summarizeAttentionMilestones,
  summarizeAttentionRisks,
} from '../../services/architectureProjects/attentionTracking';
import type { Project, ProjectAttentionTracking } from '../../services/architectureProjects';

const NOW = Date.parse('2026-09-05T00:00:00.000Z');

const tracking = (overrides: Partial<ProjectAttentionTracking> = {}): ProjectAttentionTracking => ({
  status: 'design',
  priority: 'medium',
  ...overrides,
});

const project = (attention?: ProjectAttentionTracking): Project => ({
  id: 'proj-1',
  name: 'Modernización del alta de póliza',
  description: '',
  projectContext: [],
  artifacts: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  attention,
});

describe('attentionProgress', () => {
  it('devuelve null cuando nadie lo ha declarado y no hay hitos', () => {
    expect(attentionProgress(tracking())).toBeNull();
    expect(attentionProgress(undefined)).toBeNull();
  });

  it('un avance declarado manda, y se marca como declarado', () => {
    expect(attentionProgress(tracking({ progress: 40 }))).toEqual({ value: 0.4, source: 'declared' });
  });

  it('cero declarado es cero, y no se confunde con no declarado', () => {
    expect(attentionProgress(tracking({ progress: 0 }))).toEqual({ value: 0, source: 'declared' });
  });

  it('sin avance declarado lo deduce de los hitos y lo dice', () => {
    const result = attentionProgress(tracking({
      milestones: [
        { id: 'a', name: 'Contexto aprobado', dueAt: '2026-02-01', status: 'met' },
        { id: 'b', name: 'Contenedores', dueAt: '2026-03-01', status: 'pending' },
        { id: 'c', name: 'Plan de migración', dueAt: '2026-04-01', status: 'pending' },
      ],
    }));
    expect(result?.source).toBe('milestones');
    expect(result?.value).toBeCloseTo(1 / 3);
  });

  it('acota un porcentaje fuera de rango en vez de propagarlo', () => {
    expect(attentionProgress(tracking({ progress: 320 }))?.value).toBe(1);
  });
});

describe('attentionHealth', () => {
  it('sin seguimiento no está en rumbo: está sin medir', () => {
    expect(attentionHealth(undefined, NOW)).toBe('unknown');
  });

  it('un hito incumplido saca al proyecto de rumbo', () => {
    expect(attentionHealth(tracking({
      milestones: [{ id: 'a', name: 'Piloto', dueAt: '2026-01-01', status: 'missed' }],
    }), NOW)).toBe('off-track');
  });

  it('un riesgo severo saca al proyecto de rumbo', () => {
    expect(attentionHealth(tracking({
      risks: [{ id: 'r', description: 'El proveedor no confirma la ventana', level: 'critical' }],
    }), NOW)).toBe('off-track');
  });

  it('una fecha objetivo pasada saca al proyecto de rumbo', () => {
    expect(attentionHealth(tracking({ targetEndDate: '2026-08-01' }), NOW)).toBe('off-track');
  });

  it('una pausa es riesgo, no fuera de rumbo', () => {
    expect(attentionHealth(tracking({ status: 'on-hold' }), NOW)).toBe('at-risk');
  });

  it('un proyecto entregado está cerrado, no en rumbo', () => {
    expect(attentionHealth(tracking({ status: 'delivered', targetEndDate: '2020-01-01' }), NOW))
      .toBe('closed');
    expect(isClosedAttention('cancelled')).toBe(true);
  });

  it('sin incidencias y dentro de fecha, está en rumbo', () => {
    expect(attentionHealth(tracking({ targetEndDate: '2026-12-01' }), NOW)).toBe('on-track');
  });
});

describe('resúmenes', () => {
  it('cuenta los hitos por estado y señala el siguiente abierto', () => {
    const summary = summarizeAttentionMilestones([
      { id: 'a', name: 'Uno', dueAt: '2026-05-01', status: 'met' },
      { id: 'b', name: 'Dos', dueAt: '2026-03-01', status: 'at-risk' },
      { id: 'c', name: 'Tres', dueAt: '2026-04-01', status: 'pending' },
      { id: 'd', name: 'Cuatro', dueAt: '2026-01-01', status: 'missed' },
    ]);
    expect(summary).toMatchObject({ total: 4, met: 1, missed: 1, atRisk: 1, pending: 1 });
    expect(summary.next?.id).toBe('b');
  });

  it('separa los riesgos severos, que son los que hereda la iniciativa', () => {
    expect(summarizeAttentionRisks(tracking({
      risks: [
        { id: '1', description: 'a', level: 'low' },
        { id: '2', description: 'b', level: 'high' },
        { id: '3', description: 'c', level: 'critical' },
      ],
    }))).toEqual({ total: 3, severe: 2 });
  });

  it('días restantes: negativo si venció, null si no hay fecha', () => {
    expect(attentionDaysRemaining(tracking({ targetEndDate: '2026-09-15T00:00:00.000Z' }), NOW)).toBe(10);
    expect(attentionDaysRemaining(tracking({ targetEndDate: '2026-08-26T00:00:00.000Z' }), NOW)).toBe(-10);
    expect(attentionDaysRemaining(tracking(), NOW)).toBeNull();
  });
});

describe('el parte para la iniciativa', () => {
  const withContributions = project(tracking({
    progress: 50,
    architectureLead: 'Ana',
    contributions: [
      { id: 'c1', initiativeId: 'ini-1', statement: 'Alta por API', state: 'in-progress' },
      { id: 'c2', initiativeId: 'ini-2', statement: 'Otra cosa', state: 'planned' },
    ],
  }));

  it('sólo lleva las contribuciones de la iniciativa que pregunta', () => {
    expect(contributionsToInitiative(withContributions, 'ini-1').map((entry) => entry.id))
      .toEqual(['c1']);
  });

  it('describe el proyecto con lo que la iniciativa necesita y nada más', () => {
    const report = describeAttentionDelivery(withContributions, 'ini-1', NOW);
    expect(report).toMatchObject({
      projectId: 'proj-1',
      progress: 0.5,
      progressSource: 'declared',
      health: 'on-track',
      architectureLead: 'Ana',
    });
    expect(report.contributions).toHaveLength(1);
  });

  it('un proyecto sin seguimiento produce un parte honesto, no uno vacío', () => {
    const report = describeAttentionDelivery(project(), 'ini-1', NOW);
    expect(report.progress).toBeNull();
    expect(report.progressSource).toBe('none');
    expect(report.health).toBe('unknown');
  });
});
