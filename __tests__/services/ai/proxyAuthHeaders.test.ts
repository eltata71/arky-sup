import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getIdToken, getSession, loadClient } = vi.hoisted(() => ({
  getIdToken: vi.fn(), getSession: vi.fn(), loadClient: vi.fn(),
}));
vi.mock('../../../firebase', () => ({ auth: { currentUser: { getIdToken } } }));
vi.mock('../../../services/adapters', () => ({ loadSupabaseAuthClient: loadClient }));
// Keep the real cohort rules without loading unrelated identity repositories.
vi.mock('../../../services/identity', async () => import('../../../services/identity/pilotRouting'));

import { buildProxyAuthHeaders } from '../../../services/ai/proxyAuthHeaders';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_SUPABASE_PILOT_EMAILS', 'pilot@example.test');
  getIdToken.mockResolvedValue('firebase-token');
  loadClient.mockResolvedValue({ auth: { getSession } });
  getSession.mockResolvedValue({ data: { session: {
    user: { id: 'pilot-id', email: 'pilot@example.test' }, access_token: 'supabase-access-token',
  } } });
});
afterEach(() => vi.unstubAllEnvs());

describe('proxy identity follows the pilot session', () => {
  it('sends the pilot access token rather than a stale Firebase identity', async () => {
    expect(await buildProxyAuthHeaders('tab-1', 'trace-1')).toMatchObject({
      Authorization: 'Bearer supabase-access-token', 'x-arky-session-id': 'tab-1',
    });
    expect(getIdToken).not.toHaveBeenCalled();
  });
});
