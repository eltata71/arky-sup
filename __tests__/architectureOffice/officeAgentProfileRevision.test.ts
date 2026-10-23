// @vitest-environment jsdom
/**
 * La ficha viaja con su revisión (plan de agentes 16.4): el guardado la envía
 * como argumento, nunca dentro del documento; el servidor devuelve la nueva; y
 * un conflicto no deja en el espejo local la versión que el servidor rechazó.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const callRpc = vi.fn();
vi.mock('../../services/adapters', () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}));

import {
  normalizeAgentProfileOverride,
  officeAgentProfileRepository,
} from '../../services/architectureOffice/infrastructure/OfficeAgentProfileRepository';
import type { OfficeAgentProfileOverride } from '../../services/architectureOffice/domain/officeAgentProfile';

const override = (patch: Partial<OfficeAgentProfileOverride> = {}): OfficeAgentProfileOverride => ({
  agentId: 'elena',
  userId: 'u-rev',
  schemaVersion: 1,
  alias: 'Ele',
  updatedAt: '2026-10-22T00:00:00.000Z',
  ...patch,
});

const conflictError = () => Object.assign(new Error('Conflicto de ficha: recarga antes de guardar'), { code: 'P0001' });

describe('la revisión de la ficha', () => {
  beforeEach(() => {
    callRpc.mockReset();
    officeAgentProfileRepository.clearCache('u-rev');
  });

  it('la lectura trae la revisión del servidor; ausente o inválida no se inventa', () => {
    expect(normalizeAgentProfileOverride({ ...override(), revision: 4 }, 'u-rev')?.revision).toBe(4);
    expect(normalizeAgentProfileOverride({ ...override() }, 'u-rev')?.revision).toBeUndefined();
    expect(normalizeAgentProfileOverride({ ...override(), revision: -1 }, 'u-rev')?.revision).toBeUndefined();
    expect(normalizeAgentProfileOverride({ ...override(), revision: 1.5 }, 'u-rev')?.revision).toBeUndefined();
  });

  it('una ficha nueva se guarda esperando la revisión cero', async () => {
    callRpc.mockResolvedValueOnce(undefined);
    const result = await officeAgentProfileRepository.save(override());
    const [name, args] = callRpc.mock.calls[0] as [string, { p_profile: Record<string, unknown> }];
    expect(name).toBe('save_agent_profile');
    expect(args.p_profile.revision).toBe(0);
    expect(result.success).toBe(true);
    expect(result.data?.revision).toBe(1);
  });

  it('una edición envía la revisión que leyó y confirma la siguiente', async () => {
    callRpc.mockResolvedValueOnce(undefined);
    const result = await officeAgentProfileRepository.save(override({ revision: 2 }));
    const args = callRpc.mock.calls[0][1] as { p_profile: { revision: number } };
    expect(args.p_profile.revision).toBe(2);
    expect(result.data?.revision).toBe(3);
  });

  it('un conflicto se informa como conflicto y no deja la versión rechazada en el espejo', async () => {
    callRpc.mockResolvedValueOnce(undefined);
    await officeAgentProfileRepository.save(override({ revision: 1, alias: 'Confirmada' }));

    callRpc.mockRejectedValueOnce(conflictError());
    const stale = await officeAgentProfileRepository.save(override({ revision: 1, alias: 'Vieja' }));
    expect(stale.success).toBe(false);
    expect(stale.status).toBe('conflict');

    // Sin servidor: lo que queda en el espejo es lo último confirmado.
    callRpc.mockRejectedValue(Object.assign(new Error('offline'), { code: '500' }));
    officeAgentProfileRepository.clearCache('u-rev');
    const mirrored = await officeAgentProfileRepository.list('u-rev');
    expect(mirrored.find((entry) => entry.agentId === 'elena')?.alias).toBe('Confirmada');
  });

  it('la bitácora se lee por su RPC, se normaliza y degrada a vacía sin servidor', async () => {
    callRpc.mockResolvedValueOnce([
      { agentId: 'elena', action: 'save', changedFields: ['alias', 7], revision: 2, contractVersion: 1, changedAt: '2026-10-22T10:00:00Z' },
      { agentId: 'elena', action: 'borrar', changedAt: 'x' },
      'basura',
    ]);
    const changes = await officeAgentProfileRepository.changes('elena', 10);
    expect(callRpc).toHaveBeenCalledWith('list_agent_profile_changes', { p_agent_id: 'elena', p_limit: 10 });
    expect(changes).toEqual([
      { agentId: 'elena', action: 'save', changedFields: ['alias'], revision: 2, contractVersion: 1, changedAt: '2026-10-22T10:00:00Z' },
    ]);

    callRpc.mockRejectedValueOnce(new Error('offline'));
    expect(await officeAgentProfileRepository.changes()).toEqual([]);
  });
});
