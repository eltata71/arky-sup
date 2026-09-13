export interface SupabasePasswordClient {
  auth: {
    updateUser(attributes: { password: string }): Promise<{ error?: unknown }>;
  };
}

/** True only for an invitation or recovery callback that includes a usable session token. */
export function isSupabasePasswordSetupCallback(hash: string): boolean {
  const callback = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const type = callback.get('type');
  return (type === 'invite' || type === 'recovery') && callback.get('access_token') !== null;
}

/** Persists the password selected by the owner in the one-time Supabase callback session. */
export async function completeSupabasePasswordSetup(
  client: SupabasePasswordClient,
  password: string,
): Promise<void> {
  const { error } = await client.auth.updateUser({ password });
  if (error) throw error;
}
