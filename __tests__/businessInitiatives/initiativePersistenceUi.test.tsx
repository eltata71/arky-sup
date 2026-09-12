import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BusinessInitiative } from '../../services/businessInitiatives';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  auth: { user: { uid: '00000000-0000-4000-8000-000000000001' } },
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => mocks.auth,
}));

vi.mock('../../services/businessInitiatives', () => ({
  listInitiatives: mocks.list,
  saveInitiative: mocks.save,
  createBusinessInitiative: mocks.create,
  deleteInitiative: mocks.remove,
}));

import { InitiativeProvider, useInitiatives } from '../../context/InitiativeContext';

const ownerId = '00000000-0000-4000-8000-000000000001';
const initiative = {
  id: 'init_offline_draft',
  userId: ownerId,
  code: 'NEG-2026-001',
  title: 'Alta digital',
  need: 'El alta tarda doce días',
  updatedAt: '2026-09-12T00:00:00.000Z',
} as BusinessInitiative;

const wrapper: React.FC<React.PropsWithChildren> = ({ children }) => (
  <InitiativeProvider>{children}</InitiativeProvider>
);

describe('InitiativeContext — confirmación de persistencia', () => {
  it('no informa creación confirmada cuando Supabase sólo pudo dejar un borrador offline', async () => {
    mocks.list.mockResolvedValue([]);
    mocks.create.mockReturnValue({ outcome: 'created', initiative });
    mocks.save.mockResolvedValue({
      success: false,
      status: 'offline',
      target: 'supabase',
      operationId: 'save-initiative-offline',
      message: 'La iniciativa quedó como borrador local y no fue confirmada.',
    });

    const { result } = renderHook(() => useInitiatives(), { wrapper });
    let outcome: Awaited<ReturnType<typeof result.current.createInitiative>> | undefined;
    await act(async () => {
      outcome = await result.current.createInitiative({ title: initiative.title, need: initiative.need });
    });

    expect(outcome).toEqual({
      ok: false,
      reason: 'La iniciativa quedó como borrador local y no fue confirmada.',
    });
  });
});
