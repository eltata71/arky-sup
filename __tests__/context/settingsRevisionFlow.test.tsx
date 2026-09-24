/**
 * La revisión de las preferencias viaja con ellas (F6-03): la escritura
 * compara contra la que tiene el estado, y el estado recoge la que la base
 * confirma. Antes vivía en un mapa del repositorio.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../types';

const mocks = vi.hoisted(() => ({ save: vi.fn() }));

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../services/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/settings')>()),
  settingsRepository: { save: mocks.save, load: vi.fn(), clearCache: vi.fn() },
}));

import { useSettingsState } from '../../context/app/useSettingsState';

const reporter = {
  persistenceStatus: 'ready' as const,
  persistenceMessage: null,
  setPersistenceStatus: vi.fn(),
  setPersistenceMessage: vi.fn(),
  handleWriteResult: (result: { success: boolean }) => result.success,
};

const confirmed = (revision: number) => ({
  status: 'success', success: true, operationId: 'op', target: 'supabase',
  data: { settings: {}, revision },
});

describe('useSettingsState — la revisión viaja con las preferencias', () => {
  it('cada escritura compara contra la revisión que confirmó la anterior', async () => {
    mocks.save.mockResolvedValueOnce(confirmed(4)).mockResolvedValueOnce(confirmed(5));
    const { result } = renderHook(() => useSettingsState(reporter as never));
    act(() => result.current.setSettings((current: Settings) => ({ ...current, revision: 3 })));

    await act(async () => { await result.current.updateSettings({ theme: 'dark' }); });
    expect(mocks.save.mock.calls[0][0].revision).toBe(3);
    expect(result.current.settings.revision).toBe(4);

    await act(async () => { await result.current.updateSettings({ theme: 'light' }); });
    expect(mocks.save.mock.calls[1][0].revision).toBe(4);
    expect(result.current.settings.revision).toBe(5);
  });

  it('una escritura rechazada deja la revisión donde estaba', async () => {
    mocks.save.mockReset().mockResolvedValueOnce({ status: 'conflict', success: false, operationId: 'op', target: 'supabase' });
    const { result } = renderHook(() => useSettingsState(reporter as never));
    act(() => result.current.setSettings((current: Settings) => ({ ...current, revision: 9 })));

    await act(async () => { await result.current.updateSettings({ theme: 'dark' }); });
    expect(result.current.settings.revision).toBe(9);
  });
});
