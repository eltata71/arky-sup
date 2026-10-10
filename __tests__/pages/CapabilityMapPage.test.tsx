import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({ value: { map: null as unknown, isLoading: true, failed: false } }));

vi.mock('../../hooks/useCapabilityMap', () => ({ useCapabilityMap: () => state.value }));
vi.mock('../../hooks/useReducedMotion', () => ({ default: () => false }));
vi.mock('../../context/AppContext', () => ({
  useAppContext: () => ({ t: (k: string, r?: Record<string, string>) => (r ? `${k}|${Object.values(r).join(',')}` : k) }),
}));

import CapabilityMapPage from '../../pages/CapabilityMapPage';

const cell = {
  item: { id: 'c1', name: 'Ventas' },
  level: 1,
  children: [],
  supportingApplications: [],
  initiativeIds: [],
  layers: {
    maturity: { intensity: 0.5, value: 3, source: 'declared' },
    investment: { intensity: null, value: null, source: null },
    risk: { intensity: null, value: null, source: null },
    coverage: { intensity: 0, value: 0, source: 'derived' },
  },
};

describe('CapabilityMapPage', () => {
  beforeEach(() => {
    state.value = { map: null, isLoading: true, failed: false };
  });

  it('carga con un esqueleto', () => {
    render(<CapabilityMapPage />);
    expect(screen.getByRole('status', { name: 'cap.loading' })).toBeTruthy();
  });

  it('informa del fallo y del inventario vacío sin pintar un mapa', () => {
    state.value = { map: null, isLoading: false, failed: true };
    const { unmount } = render(<CapabilityMapPage />);
    expect(screen.getByText('cap.error.title')).toBeTruthy();
    unmount();
    state.value = { map: { total: 0, roots: [], uncoveredIds: [], issues: [] }, isLoading: false, failed: false };
    render(<CapabilityMapPage />);
    expect(screen.getByText('cap.empty.title')).toBeTruthy();
  });

  it('cambia de capa y cuenta lo no cubierto', () => {
    state.value = { map: { total: 1, roots: [cell], uncoveredIds: ['c1'], issues: [] }, isLoading: false, failed: false };
    render(<CapabilityMapPage />);
    expect(screen.getByText('cap.value.maturity|3')).toBeTruthy();
    expect(screen.getByText('cap.uncovered|1')).toBeTruthy();
    fireEvent.click(screen.getByText('cap.layer.risk'));
    expect(screen.queryByText('cap.value.maturity|3')).toBeNull();
    expect(screen.getAllByText('cap.unmeasured').length).toBeGreaterThan(1);
  });
});
