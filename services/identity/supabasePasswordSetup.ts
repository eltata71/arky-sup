export interface SupabasePasswordClient {
  auth: {
    setSession(tokens: { access_token: string; refresh_token: string }): Promise<{
      data?: { session?: SupabasePasswordSetupSession | null } | null;
      error?: unknown;
    }>;
    updateUser(attributes: { password: string }): Promise<{ error?: unknown }>;
  };
}

export interface SupabasePasswordSetupSession {
  user?: { id?: string; email?: string | null } | null;
}

/** True only for an invitation or recovery callback that includes a usable session token. */
export function isSupabasePasswordSetupCallback(hash: string): boolean {
  const callback = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const type = callback.get('type');
  return (type === 'invite' || type === 'recovery')
    && (callback.get('access_token') ?? '') !== ''
    && (callback.get('refresh_token') ?? '') !== '';
}

/** Validates the callback tokens before persisting the password in that exact session. */
export async function completeSupabasePasswordSetup(
  client: SupabasePasswordClient,
  hash: string,
  password: string,
): Promise<SupabasePasswordSetupSession> {
  if (!isSupabasePasswordSetupCallback(hash)) {
    throw new Error('El enlace para definir la contraseña es inválido o expiró. Solicita uno nuevo.');
  }
  const callback = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const { data, error: sessionError } = await client.auth.setSession({
    access_token: callback.get('access_token')!,
    refresh_token: callback.get('refresh_token')!,
  });
  if (sessionError) throw sessionError;
  if (!data?.session) {
    throw new Error('El enlace para definir la contraseña es inválido o expiró. Solicita uno nuevo.');
  }
  const { error } = await client.auth.updateUser({ password });
  if (error) throw error;
  return data.session;
}
