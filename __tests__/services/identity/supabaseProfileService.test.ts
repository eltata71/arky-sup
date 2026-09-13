import { describe, expect, it, vi } from 'vitest';
import { readSupabaseProfile, type SupabaseProfileClient } from '../../../services/identity/supabaseProfileService';

const USER_ID = 'f0000000-0000-4000-8000-000000000001';

function clientReturning(data: unknown, error: unknown = null): SupabaseProfileClient {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  return { from: vi.fn().mockReturnValue({ select }) };
}

describe('readSupabaseProfile', () => {
  it('maps only an active profile that belongs to the signed-in identity', async () => {
    const client = clientReturning({ id: USER_ID, role: 'superadmin', display_name: 'José Ignacio Vasquez', status: 'active' });

    await expect(readSupabaseProfile(client, USER_ID, 'tataarky@gmail.com')).resolves.toEqual({
      uid: USER_ID,
      email: 'tataarky@gmail.com',
      displayName: 'José Ignacio Vasquez',
      role: 'superadmin',
    });
  });

  it('fails closed for an inactive, mismatched or malformed row', async () => {
    await expect(readSupabaseProfile(clientReturning({ id: USER_ID, role: 'viewer', status: 'disabled' }), USER_ID, null)).resolves.toBeNull();
    await expect(readSupabaseProfile(clientReturning({ id: 'different', role: 'viewer', status: 'active' }), USER_ID, null)).resolves.toBeNull();
    await expect(readSupabaseProfile(clientReturning({ id: USER_ID, role: 'not-a-role', status: 'active' }), USER_ID, null)).resolves.toBeNull();
  });

  it('throws the backend error instead of treating an unavailable profile as absent', async () => {
    await expect(readSupabaseProfile(clientReturning(null, { message: 'network failed' }), USER_ID, null)).rejects.toMatchObject({ message: 'network failed' });
  });
});
