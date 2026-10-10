import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const run = vi.hoisted(() => vi.fn(() => true));

vi.mock('../../hooks/useTransitionPlan', () => ({ useTransitionPlan: () => state.value }));
vi.mock('../../hooks/useTransitionPlanExport', () => ({ useTransitionPlanExport: () => ({ exportPptx: vi.fn(), busy: false, failed: false }) }));
vi.mock('../../context/AppContext', () => ({
  useAppContext: () => ({ t: (k: string, r?: Record<string, string>) => (r ? `${k}|${Object.values(r).join(',')}` : k) }),
}));

import TransitionPlanPage from '../../pages/TransitionPlanPage';

const make = (over: Record<string, unknown> = {}) => ({
  projects: [{ id: 'p1', name: 'Proyecto' }],
  plan: undefined,
  milestones: [{ id: 'm1', name: 'Hito', dueAt: '2027-01-01' }],
  inventory: [],
  gaps: { entries: [], counts: {}, issues: [] },
  roadmap: {
    plateaus: [
      { plateau: { id: 'a', name: 'Uno' }, arrivesAt: '2027-01-01T00:00:00Z', milestoneStatus: null },
      { plateau: { id: 'b', name: 'Dos' }, arrivesAt: null, milestoneStatus: null },
    ],
    issues: [],
  },
  hasTracking: true,
  isLoading: false,
  failed: false,
  run,
  ...over,
});

describe('TransitionPlanPage', () => {
  beforeEach(() => {
    run.mockClear();
    state.value = make();
  });

  it('pide un proyecto antes de mostrar nada', () => {
    render(<TransitionPlanPage />);
    expect(screen.getByText('tp.empty.title')).toBeTruthy();
  });

  it('reordena con botones, sin arrastrar', () => {
    render(<TransitionPlanPage />);
    fireEvent.change(screen.getByRole('combobox', { name: 'tp.project' }), { target: { value: 'p1' } });
    fireEvent.click(screen.getAllByText('tp.plateau.later')[0]);
    expect(run).toHaveBeenCalledWith({ type: 'move-plateau', plateauId: 'a', toIndex: 1 });
    expect(screen.getByText('tp.undated')).toBeTruthy();
  });

  it('avisa si el proyecto no tiene seguimiento', () => {
    state.value = make({ hasTracking: false });
    render(<TransitionPlanPage />);
    fireEvent.change(screen.getByRole('combobox', { name: 'tp.project' }), { target: { value: 'p1' } });
    expect(screen.getByText('tp.notracking.title')).toBeTruthy();
  });
});
