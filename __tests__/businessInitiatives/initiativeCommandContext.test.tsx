/**
 * El proveedor sólo hace lo que es de un proveedor (F3-05).
 *
 * Las reglas de cada operación se prueban en `initiativeCommands.test.ts`, sin
 * React. Aquí se prueba el resto: que un rechazo del dominio no llega a
 * escribir, que una escritura confirmada deja el registro confirmado, y que una
 * que la base no confirma se revierte en pantalla.
 */
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildInitiative, type BusinessInitiative } from '../../services/businessInitiatives';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  auth: { user: { uid: 'u1' } },
}));

vi.mock('../../context/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../services/businessInitiatives', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/businessInitiatives')>()),
  listInitiatives: mocks.list,
  saveInitiative: mocks.save,
}));

import { InitiativeProvider, useInitiatives } from '../../context/InitiativeContext';

const stored: BusinessInitiative = {
  ...buildInitiative({ title: 'Alta digital', need: 'El alta tarda doce días' }, 'u1', [], '2026-09-12T00:00:00.000Z'),
  revision: 3,
};

const wrapper: React.FC<React.PropsWithChildren> = ({ children }) => (
  <InitiativeProvider>{children}</InitiativeProvider>
);

const mount = async () => {
  const hook = renderHook(() => useInitiatives(), { wrapper });
  await waitFor(() => expect(hook.result.current.initiatives).toHaveLength(1));
  return hook;
};

beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue([stored]);
  mocks.save.mockReset();
});

describe('runInitiativeCommand', () => {
  it('a rejected operation never reaches the database, and says why', async () => {
    const { result } = await mount();
    let outcome: Awaited<ReturnType<typeof result.current.runInitiativeCommand>> | undefined;
    await act(async () => {
      outcome = await result.current.runInitiativeCommand(stored.id, { kind: 'remove-kpi', kpiId: 'gone' });
    });
    expect(outcome).toEqual({ ok: false, reason: 'El indicador ya no existe en la iniciativa.' });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('writes the result of the operation, carrying the revision it was read with', async () => {
    mocks.save.mockImplementation(async (next: BusinessInitiative) => ({
      success: true, status: 'success', target: 'supabase', operationId: 'op', data: { ...next, revision: 4 },
    }));
    const { result } = await mount();
    await act(async () => {
      await result.current.runInitiativeCommand(stored.id, { kind: 'add-objective', objective: 'Alta en un día' });
    });
    const sent = mocks.save.mock.calls[0][0] as BusinessInitiative;
    expect(sent.objectives).toEqual(['Alta en un día']);
    expect(sent.revision).toBe(3);
    expect(result.current.getInitiative(stored.id)?.revision).toBe(4);
  });

  it('rolls the screen back when the database does not confirm', async () => {
    mocks.save.mockResolvedValue({
      success: false, status: 'conflict', target: 'supabase', operationId: 'op', message: 'Conflicto',
    });
    const { result } = await mount();
    await act(async () => {
      await result.current.runInitiativeCommand(stored.id, { kind: 'add-objective', objective: 'Alta en un día' });
    });
    expect(result.current.getInitiative(stored.id)?.objectives).toEqual([]);
  });
});
