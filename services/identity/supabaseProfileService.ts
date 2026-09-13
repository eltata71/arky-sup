import type { AuthRole } from '../../lib/authz';
import type { UserProfile } from './userService';

export interface SupabaseProfileRow {
  id?: unknown;
  role?: unknown;
  display_name?: unknown;
  status?: unknown;
}

export interface SupabaseProfileClient {
  from(table: 'user_profiles'): {
    select(columns: string): {
      eq(column: 'id', value: string): {
        maybeSingle(): Promise<{ data: SupabaseProfileRow | null; error: { message?: string } | null }>;
      };
    };
  };
}

const ROLES: ReadonlySet<AuthRole> = new Set([
  'viewer',
  'architect',
  'reviewer',
  'trainer',
  'admin',
  'superadmin',
]);

/**
 * Lee exclusivamente el perfil activo de la identidad de Supabase ya
 * autenticada. Una fila ausente, desactivada o incongruente no representa una
 * cuenta de Arky y por eso devuelve `null`; un error del backend sí se propaga.
 */
export async function readSupabaseProfile(
  client: SupabaseProfileClient,
  userId: string,
  email: string | null,
): Promise<UserProfile | null> {
  const { data, error } = await client
    .from('user_profiles')
    .select('id, role, display_name, status')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw new Error(error.message ?? 'No se pudo leer el perfil Supabase.');
  if (
    !data
    || data.id !== userId
    || data.status !== 'active'
    || typeof data.role !== 'string'
    || !ROLES.has(data.role as AuthRole)
  ) {
    return null;
  }

  return {
    uid: userId,
    email,
    displayName: typeof data.display_name === 'string' && data.display_name.trim() !== ''
      ? data.display_name
      : null,
    role: data.role as AuthRole,
  };
}
