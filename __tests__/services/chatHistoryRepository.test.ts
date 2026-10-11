// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const callRpc = vi.fn();
vi.mock('../../services/adapters', () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}));

import { chatHistoryRepository } from '../../services/chat/ChatHistoryRepository';

const msg = (id: string, content = id) => ({ id, role: 'user' as const, content, timestamp: '2026-10-11T10:00:00Z' });

describe('ChatHistoryRepository — un registro por mensaje (14.3)', () => {
  beforeEach(() => {
    callRpc.mockReset();
    callRpc.mockResolvedValue(1);
    chatHistoryRepository.clearCache();
  });

  it('save solo envía los mensajes que el servidor aún no tiene', async () => {
    await chatHistoryRepository.save('p1', [msg('a'), msg('b')]);
    await chatHistoryRepository.save('p1', [msg('a'), msg('b'), msg('c')]);
    const calls = callRpc.mock.calls.filter(([name]) => name === 'append_chat_messages');
    expect(calls).toHaveLength(2);
    expect((calls[1][1] as { p_messages: { id: string }[] }).p_messages.map((m) => m.id)).toEqual(['c']);
  });

  it('no llama al servidor si no hay nada nuevo', async () => {
    await chatHistoryRepository.save('p1', [msg('a')]);
    callRpc.mockClear();
    await chatHistoryRepository.save('p1', [msg('a')]);
    expect(callRpc).not.toHaveBeenCalled();
  });

  it('un mensaje sin id recibe uno estable, así reenviarlo no lo duplica', async () => {
    const legacy = { role: 'user' as const, content: 'hola', timestamp: 't' };
    await chatHistoryRepository.save('p1', [legacy]);
    const first = (callRpc.mock.calls[0][1] as { p_messages: { id: string }[] }).p_messages[0].id;
    chatHistoryRepository.clearCache();
    callRpc.mockClear();
    await chatHistoryRepository.save('p1', [legacy]);
    const second = (callRpc.mock.calls[0][1] as { p_messages: { id: string }[] }).p_messages[0].id;
    expect(first).toMatch(/^legacy-/);
    expect(second).toBe(first);
  });

  it('un fallo no marca los mensajes como enviados: el siguiente guardado los reintenta', async () => {
    callRpc.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: '500' }));
    await chatHistoryRepository.save('p1', [msg('a')]);
    callRpc.mockClear();
    callRpc.mockResolvedValue(1);
    await chatHistoryRepository.save('p1', [msg('a')]);
    expect(callRpc).toHaveBeenCalledWith('append_chat_messages', expect.objectContaining({ p_project_id: 'p1' }));
  });

  it('replace es la única operación que sustituye la lista', async () => {
    await chatHistoryRepository.replace('p1', [msg('z')]);
    expect(callRpc).toHaveBeenCalledWith('replace_chat_history', expect.objectContaining({ p_project_id: 'p1' }));
    expect(callRpc.mock.calls.some(([n]) => n === 'save_chat_history')).toBe(false);
  });
});
