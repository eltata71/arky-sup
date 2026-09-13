import { describe, expect, it, vi } from 'vitest';
import {
  completeSupabasePasswordSetup,
  isSupabasePasswordSetupCallback,
  type SupabasePasswordClient,
} from '../../../services/identity/supabasePasswordSetup';

describe('Supabase invitation password setup', () => {
  it.each(['#access_token=token&type=invite', '#access_token=token&type=recovery'])('recognizes an authenticated password callback: %s', (hash) => {
    expect(isSupabasePasswordSetupCallback(hash)).toBe(true);
  });

  it.each(['', '#type=signup', '#type=invite', '#access_token=token'])('does not treat an incomplete or unrelated callback as password setup: %s', (hash) => {
    expect(isSupabasePasswordSetupCallback(hash)).toBe(false);
  });

  it('writes the new password through the authenticated Supabase callback session', async () => {
    const updateUser = vi.fn().mockResolvedValue({ data: { user: { id: 'pilot-1' } }, error: null });
    const client: SupabasePasswordClient = { auth: { updateUser } };

    await expect(completeSupabasePasswordSetup(client, 'contraseña-segura-123')).resolves.toBeUndefined();
    expect(updateUser).toHaveBeenCalledWith({ password: 'contraseña-segura-123' });
  });

  it('rejects a provider error instead of pretending the password was saved', async () => {
    const client: SupabasePasswordClient = {
      auth: { updateUser: vi.fn().mockResolvedValue({ error: new Error('expired link') }) },
    };

    await expect(completeSupabasePasswordSetup(client, 'contraseña-segura-123')).rejects.toThrow('expired link');
  });
});
