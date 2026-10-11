/**
 * 13.4 — the Office's reads fail out loud. A rejected read used to escape a
 * `try/finally`, leave the project marked as loaded, and let the board say
 * «no hay entregables» about work that exists.
 */
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { OfficeEngagement } from '../../services/architectureOffice';
import { useEngagementLoading, type EngagementReads } from '../../context/office/useEngagementLoading';
import { ObservabilityProvider } from '../../context/ObservabilityContext';
import { GlobalObservabilityCenter } from '../../components/GlobalObservabilityCenter';
import { ScreenLoadError } from '../../components/ScreenLoadError';

const engagement = { id: 'e-1', projectId: 'p-1', updatedAt: '2026-10-01T00:00:00Z' } as OfficeEngagement;

const setup = (repository: EngagementReads) => {
  const engagementsRef = { current: [] as OfficeEngagement[] };
  const commit = vi.fn((next: OfficeEngagement[]) => { engagementsRef.current = next; });
  const hook = renderHook(() => useEngagementLoading({
    repository, projectIds: ['p-1'], canApprove: false, authLoading: false, engagementsRef, commit,
  }));
  return { hook, commit, engagementsRef };
};

describe('useEngagementLoading', () => {
  it('reports a failed read as an error — decided, not still resolving — and retries it', async () => {
    const list = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce([engagement]);
    const { hook, engagementsRef } = setup({ list, listForArb: vi.fn() });

    await act(async () => { await hook.result.current.loadEngagements('p-1'); });
    expect(hook.result.current.loadError).toBe('network down');
    expect(hook.result.current.isResolving).toBe(false);

    act(() => { hook.result.current.retryLoad(); });
    await waitFor(() => expect(hook.result.current.loadError).toBeNull());
    expect(list).toHaveBeenCalledTimes(2);
    expect(engagementsRef.current).toEqual([engagement]);
    expect(hook.result.current.isResolving).toBe(false);
  });

  it('a project that loaded is not asked again', async () => {
    const list = vi.fn().mockResolvedValue([engagement]);
    const { hook } = setup({ list, listForArb: vi.fn() });
    await act(async () => { await hook.result.current.loadEngagements('p-1'); });
    await act(async () => { await hook.result.current.loadEngagements('p-1'); });
    expect(list).toHaveBeenCalledTimes(1);
  });
});

describe('ScreenLoadError', () => {
  it('«Ver diagnóstico» opens the observability centre', () => {
    render(
      <ObservabilityProvider>
        <ScreenLoadError subject="los proyectos" error="network down" onRetry={vi.fn()} />
        <GlobalObservabilityCenter />
      </ObservabilityProvider>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ver diagnóstico' }));
    expect(screen.getByRole('dialog', { name: /estado operativo de arky/i })).toBeInTheDocument();
  });

  it('without the observability provider it still offers to retry', () => {
    const onRetry = vi.fn();
    render(<ScreenLoadError subject="los proyectos" error="network down" onRetry={onRetry} />);
    expect(screen.queryByRole('button', { name: 'Ver diagnóstico' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
