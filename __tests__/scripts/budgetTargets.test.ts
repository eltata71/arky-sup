/**
 * F3-04 — cada presupuesto que importa tiene objetivo, fecha y fase.
 *
 * Un presupuesto que sólo prohíbe empeorar se queda donde lo dejó la última
 * mejora. Esto prueba que el evaluador informa antes de la fecha, falla
 * después, y que ninguna entrada se declara sin las tres cosas.
 */
import { describe, expect, it } from 'vitest';
import { BUDGET_TARGETS, evaluateBudgetTargets } from '../../scripts/budgetTargets.mjs';

const TARGET = [{ id: 'x', label: 'cosas', target: 2, due: '2027-01-31', phase: 'F9-99' }];

describe('the budget targets', () => {
  it('every entry has a target, an ISO date and the phase that meets it', () => {
    expect(BUDGET_TARGETS.length).toBeGreaterThanOrEqual(6);
    for (const entry of BUDGET_TARGETS) {
      expect(entry.target, entry.id).toBeGreaterThanOrEqual(0);
      expect(entry.due, entry.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.phase.trim(), entry.id).not.toBe('');
    }
    expect(new Set(BUDGET_TARGETS.map((entry) => entry.id)).size).toBe(BUDGET_TARGETS.length);
  });

  it('reports progress before the date, without failing', () => {
    const { failures, notes } = evaluateBudgetTargets({ x: 5 }, '2026-09-22', TARGET);
    expect(failures).toEqual([]);
    expect(notes[0]).toContain('cosas = 5 → 2 antes de 2027-01-31');
  });

  it('fails after the date when the target is not met', () => {
    const { failures } = evaluateBudgetTargets({ x: 5 }, '2027-02-01', TARGET);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('objetivo vencido');
    expect(failures[0]).toContain('F9-99');
  });

  it('a met target passes at any date', () => {
    expect(evaluateBudgetTargets({ x: 2 }, '2030-01-01', TARGET).failures).toEqual([]);
  });

  it('evaluates only what the calling gate measured', () => {
    expect(evaluateBudgetTargets({}, '2030-01-01', TARGET)).toEqual({ failures: [], notes: [] });
  });
});
