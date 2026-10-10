import { describe, expect, it } from 'vitest';
import {
  applyTransitionCommand,
  deriveRoadmap,
  normalizeTransitionPlan,
  type TransitionPlan,
} from '../../../services/architectureProjects/domain/transitionPlan';

const tracking = {
  milestones: [
    { id: 'm1', name: 'Fase 1', dueAt: '2027-03-01', status: 'pending' as const },
    { id: 'm2', name: 'Fase 2', dueAt: '2027-01-01', status: 'met' as const },
  ],
};

const apply = (plan: TransitionPlan | undefined, command: Parameters<typeof applyTransitionCommand>[1]) => {
  const r = applyTransitionCommand(plan, command, tracking);
  if (!r.ok) throw new Error(r.rejection);
  return r;
};

describe('transitionPlan', () => {
  it('normaliza descartando lo inválido y no guarda planes vacíos', () => {
    expect(normalizeTransitionPlan({ baseline: [], target: [], plateaus: [] })).toBeUndefined();
    expect(normalizeTransitionPlan('x')).toBeUndefined();
    const plan = normalizeTransitionPlan({
      baseline: [{ itemId: 'a' }, { itemId: 'a' }, { itemId: '' }],
      target: [{ itemId: 'b', desired: { lifecycle: 'bogus', maturity: 4 } }],
      plateaus: [{ name: 'P1', workPackages: [{ name: 'W', itemIds: ['a', 'a'], startAt: 'nope' }] }, { name: '' }],
    });
    expect(plan?.baseline).toEqual([{ itemId: 'a' }]);
    expect(plan?.target[0].desired).toEqual({ maturity: 4 });
    expect(plan?.plateaus).toHaveLength(1);
    expect(plan?.plateaus[0].workPackages[0]).toMatchObject({ itemIds: ['a'] });
    expect(plan?.plateaus[0].workPackages[0].startAt).toBeUndefined();
  });

  it('un comando que no cambia nada lo dice', () => {
    const first = apply(undefined, { type: 'add-baseline', itemId: 'a' });
    expect(first.changed).toBe(true);
    expect(apply(first.plan, { type: 'add-baseline', itemId: 'a' }).changed).toBe(false);
  });

  it('rechaza hitos que no resuelven, fechas invertidas y duplicados', () => {
    expect(applyTransitionCommand(undefined, { type: 'add-plateau', id: 'p', name: 'P', milestoneId: 'zz' }, tracking))
      .toEqual({ ok: false, rejection: 'unknown-milestone' });
    const withPlateau = apply(undefined, { type: 'add-plateau', id: 'p', name: 'P', milestoneId: 'm1' }).plan;
    expect(applyTransitionCommand(withPlateau, { type: 'add-plateau', id: 'p', name: 'Q' }, tracking))
      .toEqual({ ok: false, rejection: 'duplicate-id' });
    const withWp = apply(withPlateau, { type: 'add-work-package', plateauId: 'p', id: 'w', name: 'W' }).plan;
    expect(applyTransitionCommand(withWp, {
      type: 'schedule-work-package', plateauId: 'p', workPackageId: 'w', startAt: '2027-02-01', endAt: '2027-01-01',
    }, tracking)).toEqual({ ok: false, rejection: 'inverted-dates' });
  });

  it('mueve mesetas y deriva la hoja de ruta: fechas de los hitos, problemas informados', () => {
    let plan = apply(undefined, { type: 'add-plateau', id: 'a', name: 'A', milestoneId: 'm1' }).plan;
    plan = apply(plan, { type: 'add-plateau', id: 'b', name: 'B', milestoneId: 'm2' }).plan;
    plan = apply(plan, { type: 'add-plateau', id: 'c', name: 'C' }).plan;
    const roadmap = deriveRoadmap(plan, tracking);
    expect(roadmap.plateaus.map((p) => p.arrivesAt)).toEqual(['2027-03-01', '2027-01-01', null]);
    expect(roadmap.issues).toEqual([
      { kind: 'out-of-order', plateauId: 'b', previousPlateauId: 'a' },
      { kind: 'plateau-without-milestone', plateauId: 'c' },
    ]);
    const moved = apply(plan, { type: 'move-plateau', plateauId: 'b', toIndex: 0 }).plan;
    expect(moved.plateaus.map((p) => p.id)).toEqual(['b', 'a', 'c']);
    expect(deriveRoadmap(moved, tracking).issues.map((i) => i.kind)).toEqual(['plateau-without-milestone']);
    expect(deriveRoadmap(plan, { milestones: [] }).issues.filter((i) => i.kind === 'dangling-milestone')).toHaveLength(2);
  });
});
