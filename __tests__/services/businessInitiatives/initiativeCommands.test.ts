/**
 * Las operaciones con nombre de una Iniciativa (F3-05).
 *
 * Cada regla de aquí vivía en un `useCallback` de un panel de React y sólo se
 * podía comprobar renderizándolo. Ahora se prueba con datos y un reloj fijo, sin
 * un solo mock: es la aceptación de F3-05 escrita como prueba.
 */
import { describe, expect, it } from 'vitest';
import {
  applyInitiativeCommand,
  buildInitiative,
  expectedRevisionOf,
  toInitiativeRevision,
  UNSTORED_REVISION,
  type BusinessInitiative,
  type InitiativeCommand,
} from '../../../services/businessInitiatives';

const NOW = '2026-09-22T10:00:00.000Z';
const LATER = '2026-09-23T10:00:00.000Z';

const initiative = (overrides: Partial<BusinessInitiative> = {}): BusinessInitiative => ({
  ...buildInitiative({ title: 'Reducir el tiempo de respuesta', need: 'La regulación exige 48 h' }, 'u1', [], NOW),
  ...overrides,
});

const apply = (subject: BusinessInitiative, command: InitiativeCommand, now = LATER) =>
  applyInitiativeCommand(subject, command, { now });

const applied = (subject: BusinessInitiative, command: InitiativeCommand, now = LATER): BusinessInitiative => {
  const result = apply(subject, command, now);
  if (!result.ok) throw new Error(`rechazado: ${result.rejection.message}`);
  return result.initiative;
};

describe('every operation', () => {
  it('stamps updatedAt and never mutates the record it was given', () => {
    const before = initiative();
    const frozen = JSON.stringify(before);
    const after = applied(before, { kind: 'add-objective', objective: 'Responder en 48 h' });
    expect(after.updatedAt).toBe(LATER);
    expect(JSON.stringify(before)).toBe(frozen);
  });

  it('keeps the revision it was read with — the write compares it, the operation does not bump it', () => {
    const after = applied(initiative({ revision: 7 }), { kind: 'reclassify', status: 'approved' });
    expect(after.revision).toBe(7);
  });
});

describe('the rules that used to live in the panels', () => {
  it('a KPI measurement is dated when recorded, and loses its date when cleared', () => {
    const withKpi = applied(initiative(), { kind: 'add-kpi', name: 'Tiempo medio', unit: 'h', baseline: 120, target: 48 });
    const kpiId = withKpi.kpis[0].id;

    const measured = applied(withKpi, { kind: 'record-kpi-measurement', kpiId, value: 70 });
    expect(measured.kpis[0]).toMatchObject({ current: 70, measuredAt: LATER });

    const cleared = applied(measured, { kind: 'record-kpi-measurement', kpiId });
    expect(cleared.kpis[0].current).toBeUndefined();
    expect(cleared.kpis[0].measuredAt).toBeUndefined();
  });

  it('only a met milestone has a completion date, and leaving `met` removes it', () => {
    const planned = applied(initiative(), { kind: 'add-milestone', name: 'Piloto', dueAt: '2026-10-01' });
    const milestoneId = planned.milestones[0].id;
    const met = applied(planned, { kind: 'set-milestone-status', milestoneId, status: 'met' });
    expect(met.milestones[0].completedAt).toBe(LATER);
    const reopened = applied(met, { kind: 'set-milestone-status', milestoneId, status: 'at-risk' });
    expect(reopened.milestones[0].completedAt).toBeUndefined();
  });

  it('milestones read as a calendar: a new one lands in date order, not at the end', () => {
    let subject = applied(initiative(), { kind: 'add-milestone', name: 'Cierre', dueAt: '2026-12-01' });
    subject = applied(subject, { kind: 'add-milestone', name: 'Arranque', dueAt: '2026-10-01' });
    expect(subject.milestones.map((milestone) => milestone.name)).toEqual(['Arranque', 'Cierre']);
  });

  it('a new item gets an id minted by the model, not by the screen', () => {
    const subject = applied(initiative(), { kind: 'add-outcome', statement: 'Menos rechazos' });
    expect(subject.expectedOutcomes[0].id).toMatch(/^out/);
  });
});

describe('what it refuses, and says so', () => {
  it('empty text', () => {
    const result = apply(initiative(), { kind: 'add-kpi', name: '   ', unit: '%' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.code).toBe('empty');
  });

  it('an item that is no longer there, instead of silently doing nothing', () => {
    for (const command of [
      { kind: 'remove-kpi', kpiId: 'gone' },
      { kind: 'record-kpi-measurement', kpiId: 'gone', value: 1 },
      { kind: 'set-milestone-status', milestoneId: 'gone', status: 'met' },
      { kind: 'remove-objective', index: 3 },
    ] as const satisfies readonly InitiativeCommand[]) {
      const result = apply(initiative(), command);
      expect(result.ok, command.kind).toBe(false);
      if (!result.ok) expect(result.rejection.code).toBe('not-found');
    }
  });

  it('a date that is not a date', () => {
    const result = apply(initiative(), { kind: 'reschedule', targetEndDate: 'pronto' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.code).toBe('invalid-date');
  });

  it('a document with nothing to open, the same rule the read path applies', () => {
    const result = apply(initiative(), {
      kind: 'attach-document',
      document: { id: 'doc_1', name: 'Caso', kind: 'business-case', addedAt: NOW, addedBy: 'Ana' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.code).toBe('invalid-document');
  });
});

describe('rescheduling', () => {
  it('sets, keeps and clears each date independently', () => {
    const scheduled = applied(initiative(), { kind: 'reschedule', startDate: '2026-10-01', targetEndDate: '2027-03-01' });
    expect(scheduled.startDate).toBe('2026-10-01T00:00:00.000Z');
    const moved = applied(scheduled, { kind: 'reschedule', targetEndDate: null });
    expect(moved.startDate).toBe('2026-10-01T00:00:00.000Z');
    expect(moved.targetEndDate).toBeUndefined();
  });
});

describe('adopting the intake draft', () => {
  it('is one decision: outcomes, KPIs and risks gain ids, empty proposals are dropped, open questions become a note', () => {
    const subject = applied(initiative(), {
      kind: 'adopt-intake-draft',
      outcomes: [{ statement: 'Responder en 48 h' }, { statement: '  ' }],
      kpis: [{ name: 'Tiempo medio', unit: 'h' }],
      risks: [{ description: 'Datos incompletos', level: 'high' }],
      affectedCapabilities: ['Atención de reclamos'],
      regulatoryDrivers: ['Circular 12'],
      openQuestions: ['¿Quién patrocina?'],
    });
    expect(subject.expectedOutcomes).toHaveLength(1);
    expect(subject.kpis[0].id).toMatch(/^kpi/);
    expect(subject.risks[0].level).toBe('high');
    expect(subject.notes).toEqual(['Preguntas abiertas del asistente: ¿Quién patrocina?']);
  });
});

describe('the revision value object', () => {
  it('accepts only positive integers, and reads anything else as unknown', () => {
    expect(toInitiativeRevision(3)).toBe(3);
    for (const value of [0, -1, 1.5, '3', null, undefined, Number.NaN]) {
      expect(toInitiativeRevision(value)).toBeUndefined();
    }
  });

  it('unknown is compared as «not stored yet», never as 1', () => {
    expect(expectedRevisionOf({})).toBe(UNSTORED_REVISION);
    expect(expectedRevisionOf({ revision: 4 })).toBe(4);
  });
});
