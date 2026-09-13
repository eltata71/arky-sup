import { describe, expect, it, vi } from 'vitest';
import {
  completeSupabasePasswordSetup,
  isSupabasePasswordSetupCallback,
  type SupabasePasswordClient,
} from '../../../services/identity/supabasePasswordSetup';

describe('Supabase invitation password setup', () => {
  it.each([
    '#access_token=token&refresh_token=refresh&type=invite',
    '#access_token=token&refresh_token=refresh&type=recovery',
  ])('recognizes an authenticated password callback: %s', (hash) => {
    expect(isSupabasePasswordSetupCallback(hash)).toBe(true);
  });

  it.each(['', '#type=signup', '#type=invite', '#access_token=token'])('does not treat an incomplete or unrelated callback as password setup: %s', (hash) => {
    expect(isSupabasePasswordSetupCallback(hash)).toBe(false);
  });

  it('rejects a callback without its refresh token before it can select a cached session', () => {
    expect(isSupabasePasswordSetupCallback('#access_token=forged&type=invite')).toBe(false);
  });

  it('binds the password update to the callback tokens instead of any cached session', async () => {
    const setSession = vi.fn().mockResolvedValue({ data: { session: { user: { id: 'pilot-1' } } }, error: null });
    const updateUser = vi.fn().mockResolvedValue({ data: { user: { id: 'pilot-1' } }, error: null });
    const client: SupabasePasswordClient = { auth: { setSession, updateUser } };

    await expect(completeSupabasePasswordSetup(
      client,
      '#access_token=callback-access&refresh_token=callback-refresh&type=invite',
      'contraseña-segura-123',
    )).resolves.toEqual({ user: { id: 'pilot-1' } });
    expect(setSession).toHaveBeenCalledWith({ access_token: 'callback-access', refresh_token: 'callback-refresh' });
    expect(updateUser).toHaveBeenCalledWith({ password: 'contraseña-segura-123' });
  });

  it('rejects a forged callback before it updates a pre-existing session', async () => {
    const setSession = vi.fn().mockResolvedValue({ data: { session: null }, error: new Error('invalid token') });
    const updateUser = vi.fn();
    const client: SupabasePasswordClient = { auth: { setSession, updateUser } };

    await expect(completeSupabasePasswordSetup(
      client,
      '#access_token=forged&refresh_token=forged&type=invite',
      'contraseña-segura-123',
    )).rejects.toThrow('invalid token');
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('rejects a provider error instead of pretending the password was saved', async () => {
    const client: SupabasePasswordClient = {
      auth: {
        setSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'pilot-1' } } }, error: null }),
        updateUser: vi.fn().mockResolvedValue({ error: new Error('expired link') }),
      },
    };

    await expect(completeSupabasePasswordSetup(
      client,
      '#access_token=callback-access&refresh_token=callback-refresh&type=recovery',
      'contraseña-segura-123',
    )).rejects.toThrow('expired link');
  });
});
