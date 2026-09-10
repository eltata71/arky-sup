import { describe, expect, it } from 'vitest';
import {
  EA_LEVELS,
  formatInitiativeCode,
  isInitiativeCode,
  nextInitiativeCode,
} from '../../lib/eaTerminology';
import {
  assessCompleteness,
  buildInitiative,
  daysRemaining,
  initiativeHealth,
  kpiProgress,
  measurableKpis,
  normalizeInitiative,
  rollupInitiatives,
  summarizeMilestones,
  worstInitiativeHealth,
  type BusinessInitiative,
  type InitiativeKpi,
} from '../../services/businessInitiatives';

const NOW = Date.parse('2026-08-27T12:00:00.000Z');
const iso = (offsetDays: number) => new Date(NOW + offsetDays * 86_400_000).toISOString();

const initiative = (
  overrides: Partial<BusinessInitiative> = {},
): BusinessInitiative => ({
  ...buildInitiative(
    { title: 'Iniciativa', need: 'Necesidad del negocio' },
    'user-1',
    [],
    new Date(NOW).toISOString(),
  ),
  ...overrides,
});

describe('eaTerminology', () => {
  it('names the three levels the way the discipline does', () => {
    expect(EA_LEVELS.initiative.singular).toBe('Iniciativa de Negocio');
    expect(EA_LEVELS.engagementProject.singular).toBe('Proyecto de Arquitectura');
    expect(EA_LEVELS.deliverable.singular).toBe('Solicitud de Entregable');
    // The short register is what the rail shows; the long one is what a page
    // title shows. Both are fixed here so a rename cannot quietly swap them.
    expect(EA_LEVELS.engagementProject.shortPlural).toBe('Proyectos');
    expect(EA_LEVELS.deliverable.shortPlural).toBe('Entregables');
    expect(EA_LEVELS.initiative.shortPlural).toBe('Iniciativas');
    // The charter's own items keep a distinct word, so "entregable" is never nested.
    expect(EA_LEVELS.artifact.singular).toBe('Artefacto');
  });

  it('accepts only well-formed initiative codes', () => {
    expect(isInitiativeCode('NEG-2026-001')).toBe(true);
    expect(isInitiativeCode('NEG-26-1')).toBe(false);
    expect(isInitiativeCode('neg-2026-001')).toBe(false);
    expect(isInitiativeCode(42)).toBe(false);
  });

  it('allocates the next free code and reuses gaps', () => {
    expect(formatInitiativeCode(2026, 7)).toBe('NEG-2026-007');
    expect(nextInitiativeCode([], 2026)).toBe('NEG-2026-001');
    expect(nextInitiativeCode(['NEG-2026-001', 'NEG-2026-003'], 2026)).toBe('NEG-2026-002');
    // Codes from another year do not consume this year's sequence.
    expect(nextInitiativeCode(['NEG-2025-001'], 2026)).toBe('NEG-2026-001');
  });
});

describe('kpiProgress', () => {
  const kpi = (overrides: Partial<InitiativeKpi>): InitiativeKpi => ({
    id: 'k', name: 'KPI', unit: '%', ...overrides,
  });

  it('returns null — not zero — when the KPI cannot be measured yet', () => {
    expect(kpiProgress(kpi({}))).toBeNull();
    expect(kpiProgress(kpi({ target: 80 }))).toBeNull();
    expect(kpiProgress(kpi({ current: 40 }))).toBeNull();
  });

  it('measures progress from the baseline toward the target', () => {
    expect(kpiProgress(kpi({ baseline: 0, target: 100, current: 25 }))).toBeCloseTo(0.25);
    expect(kpiProgress(kpi({ baseline: 20, target: 60, current: 40 }))).toBeCloseTo(0.5);
  });

  it('works for a target that improves downward', () => {
    // "Reduce response time from 5 days to 1 day", now at 3 days.
    expect(kpiProgress(kpi({ baseline: 5, target: 1, current: 3 }))).toBeCloseTo(0.5);
  });

  it('clamps rather than reporting more than complete', () => {
    expect(kpiProgress(kpi({ baseline: 0, target: 10, current: 25 }))).toBe(1);
    expect(kpiProgress(kpi({ baseline: 0, target: 10, current: -5 }))).toBe(0);
  });

  it('keeps only the KPIs that can be plotted', () => {
    const kpis = [
      kpi({ id: 'a', baseline: 0, target: 10, current: 5 }),
      kpi({ id: 'b' }),
    ];
    expect(measurableKpis(kpis).map((item) => item.id)).toEqual(['a']);
  });
});

describe('initiativeHealth', () => {
  it('treats an open initiative past its target date as at risk, whatever the status says', () => {
    const value = initiative({ status: 'in-progress', targetEndDate: iso(-1) });
    expect(initiativeHealth(value, NOW)).toBe('at-risk');
  });

  it('treats a critical risk as at risk even when the dates are fine', () => {
    const value = initiative({ status: 'in-progress', riskLevel: 'critical', targetEndDate: iso(30) });
    expect(initiativeHealth(value, NOW)).toBe('at-risk');
  });

  it('treats a missed milestone as at risk', () => {
    const value = initiative({
      status: 'in-progress',
      milestones: [{ id: 'm1', name: 'Hito', dueAt: iso(-5), status: 'missed' }],
    });
    expect(initiativeHealth(value, NOW)).toBe('at-risk');
  });

  it('does not chase a closed initiative for a date it already passed', () => {
    expect(initiativeHealth(initiative({ status: 'realized', targetEndDate: iso(-30) }), NOW)).toBe('realized');
    expect(initiativeHealth(initiative({ status: 'cancelled', targetEndDate: iso(-30) }), NOW)).toBe('idle');
  });

  it('maps the remaining statuses onto their bucket', () => {
    expect(initiativeHealth(initiative({ status: 'in-progress' }), NOW)).toBe('active');
    expect(initiativeHealth(initiative({ status: 'proposed' }), NOW)).toBe('awaiting-decision');
    expect(initiativeHealth(initiative({ status: 'draft' }), NOW)).toBe('idle');
    expect(initiativeHealth(initiative({ status: 'on-hold' }), NOW)).toBe('at-risk');
  });

  it('reports the loudest bucket of a set', () => {
    expect(worstInitiativeHealth(['realized', 'at-risk', 'active'])).toBe('at-risk');
    expect(worstInitiativeHealth([])).toBe('idle');
  });
});

describe('rollupInitiatives', () => {
  it('sums investment only over the initiatives that declare one', () => {
    const rollup = rollupInitiatives([
      initiative({ estimatedInvestment: 100_000 }),
      initiative({ estimatedInvestment: 50_000 }),
      initiative({}),
    ], NOW);
    expect(rollup.investment).toBe(150_000);
    expect(rollup.investmentDeclared).toBe(2);
  });

  it('reports null attainment rather than zero when no KPI can be measured', () => {
    const rollup = rollupInitiatives([
      initiative({ kpis: [{ id: 'k', name: 'KPI', unit: '%' }] }),
    ], NOW);
    expect(rollup.kpisTotal).toBe(1);
    expect(rollup.kpisMeasurable).toBe(0);
    expect(rollup.kpiAttainment).toBeNull();
  });

  it('averages only the measurable KPIs', () => {
    const rollup = rollupInitiatives([
      initiative({
        kpis: [
          { id: 'a', name: 'A', unit: '%', baseline: 0, target: 100, current: 100 },
          { id: 'b', name: 'B', unit: '%', baseline: 0, target: 100, current: 0 },
          { id: 'c', name: 'C', unit: '%' },
        ],
      }),
    ], NOW);
    expect(rollup.kpisMeasurable).toBe(2);
    expect(rollup.kpiAttainment).toBeCloseTo(0.5);
  });

  it('separates overdue from due-soon, and ignores closed initiatives for both', () => {
    const rollup = rollupInitiatives([
      initiative({ status: 'in-progress', targetEndDate: iso(-3) }),
      initiative({ status: 'in-progress', targetEndDate: iso(10) }),
      initiative({ status: 'in-progress', targetEndDate: iso(90) }),
      initiative({ status: 'realized', targetEndDate: iso(-100) }),
    ], NOW);
    expect(rollup.overdue).toBe(1);
    expect(rollup.dueSoon).toBe(1);
  });

  it('counts an empty portfolio without inventing numbers', () => {
    const rollup = rollupInitiatives([], NOW);
    expect(rollup.total).toBe(0);
    expect(rollup.kpiAttainment).toBeNull();
    expect(rollup.investment).toBe(0);
  });
});

describe('summarizeMilestones', () => {
  it('names the next open milestone, earliest first', () => {
    const summary = summarizeMilestones([
      { id: 'a', name: 'Tarde', dueAt: iso(20), status: 'pending' },
      { id: 'b', name: 'Pronto', dueAt: iso(5), status: 'at-risk' },
      { id: 'c', name: 'Hecho', dueAt: iso(1), status: 'met' },
    ]);
    expect(summary.next?.name).toBe('Pronto');
    expect(summary.met).toBe(1);
    expect(summary.atRisk).toBe(1);
    expect(summary.total).toBe(3);
  });
});

describe('daysRemaining', () => {
  it('returns null for an absent or unparseable date', () => {
    expect(daysRemaining(undefined, NOW)).toBeNull();
    expect(daysRemaining('mañana', NOW)).toBeNull();
  });

  it('goes negative once the date has passed', () => {
    expect(daysRemaining(iso(3), NOW)).toBe(3);
    expect(daysRemaining(iso(-2), NOW)).toBe(-2);
  });
});

describe('assessCompleteness', () => {
  it('counts whether the questions were answered, and names the gaps', () => {
    const bare = assessCompleteness(initiative({ need: 'Necesidad', driver: '' }));
    expect(bare.ratio).toBeLessThan(0.5);
    expect(bare.missing).toContain('Driver / motivación');
    expect(bare.missing).toContain('Indicadores (KPI)');
  });

  it('reaches 1 once every section carries something', () => {
    const full = assessCompleteness(initiative({
      need: 'n',
      driver: 'd',
      objectives: ['o'],
      expectedOutcomes: [{ id: 'o1', statement: 's' }],
      kpis: [{ id: 'k', name: 'K', unit: '%' }],
      affectedCapabilities: ['c'],
      stakeholders: [{ id: 's', name: 'Ana', role: 'CIO', kind: 'sponsor' }],
      targetEndDate: iso(30),
      risks: [{ id: 'r', description: 'riesgo', level: 'low' }],
      documents: [{ id: 'd', name: 'Caso', kind: 'business-case', url: 'https://x', addedAt: iso(0), addedBy: 'Ana' }],
    }));
    expect(full.ratio).toBe(1);
    expect(full.missing).toEqual([]);
  });
});

describe('normalizeInitiative', () => {
  it('refuses an entry with no identity', () => {
    expect(normalizeInitiative(null)).toBeNull();
    expect(normalizeInitiative({})).toBeNull();
    expect(normalizeInitiative({ title: 'Sin id' })).toBeNull();
  });

  it('drops a malformed code rather than keeping something plausible', () => {
    // A wrong code would silently break the join with the architecture projects.
    expect(normalizeInitiative({ id: 'i1', code: 'NEG-26-1' })?.code).toBe('');
    expect(normalizeInitiative({ id: 'i1', code: 'NEG-2026-004' })?.code).toBe('NEG-2026-004');
  });

  it('falls back to a usable default for every unknown enum', () => {
    const value = normalizeInitiative({
      id: 'i1',
      status: 'inventado',
      priority: 'urgentísima',
      horizon: 'algún día',
      riskLevel: 'catastrófico',
    });
    expect(value?.status).toBe('draft');
    expect(value?.priority).toBe('medium');
    expect(value?.horizon).toBe('next');
    expect(value?.riskLevel).toBe('medium');
  });

  it('drops list entries that carry nothing usable', () => {
    const value = normalizeInitiative({
      id: 'i1',
      objectives: ['bueno', '', 42, null],
      kpis: [{ name: 'Con nombre', unit: '%' }, { unit: 'sin nombre' }],
      risks: [{ description: 'real', level: 'high' }, { level: 'high' }],
      // A document with neither link nor content would open onto nothing.
      documents: [
        { name: 'Enlazado', url: 'https://x' },
        { name: 'Pegado', content: 'texto' },
        { name: 'Vacío' },
      ],
    });
    expect(value?.objectives).toEqual(['bueno']);
    expect(value?.kpis).toHaveLength(1);
    expect(value?.risks).toHaveLength(1);
    expect(value?.documents.map((doc) => doc.name)).toEqual(['Enlazado', 'Pegado']);
  });

  it('keeps every collection present so consumers never guard', () => {
    const value = normalizeInitiative({ id: 'i1' });
    expect(value?.objectives).toEqual([]);
    expect(value?.kpis).toEqual([]);
    expect(value?.milestones).toEqual([]);
    expect(value?.stakeholders).toEqual([]);
    expect(value?.documents).toEqual([]);
    expect(value?.notes).toEqual([]);
  });
});

describe('buildInitiative', () => {
  it('allocates a code and starts every collection empty', () => {
    const created = buildInitiative(
      { title: '  Automatizar pre-autorizaciones  ', need: '  Necesidad  ' },
      'user-1',
      ['NEG-2026-001'],
      new Date(NOW).toISOString(),
    );
    expect(created.code).toBe('NEG-2026-002');
    expect(created.title).toBe('Automatizar pre-autorizaciones');
    expect(created.need).toBe('Necesidad');
    expect(created.status).toBe('draft');
    expect(created.userId).toBe('user-1');
    expect(created.kpis).toEqual([]);
  });

  it('honours a caller-supplied code only when it is well formed', () => {
    const good = buildInitiative(
      { title: 't', need: 'n', code: 'NEG-2026-042' }, 'u', [], new Date(NOW).toISOString(),
    );
    expect(good.code).toBe('NEG-2026-042');

    const bad = buildInitiative(
      { title: 't', need: 'n', code: 'basura' }, 'u', [], new Date(NOW).toISOString(),
    );
    expect(bad.code).toBe('NEG-2026-001');
  });
});

describe('regressions found by rendering the board', () => {
  it('counts an initiative awaiting approval even when its risk makes it at-risk', () => {
    // Deriving this from the health bucket dropped it: a proposed initiative
    // with a critical risk reports as at-risk, and the tile then claimed
    // nothing was waiting for a decision while something was.
    const value = initiative({ status: 'proposed', riskLevel: 'critical' });
    expect(initiativeHealth(value, NOW)).toBe('at-risk');

    const rollup = rollupInitiatives([value], NOW);
    expect(rollup.awaitingDecision).toBe(1);
    expect(rollup.healthMix['at-risk']).toBe(1);
  });

  it('does not count an approved-but-unstarted initiative as awaiting a decision', () => {
    expect(rollupInitiatives([initiative({ status: 'approved' })], NOW).awaitingDecision).toBe(0);
  });
});
