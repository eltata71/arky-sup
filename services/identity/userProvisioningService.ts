/**
 * Provisioning an account — the operation the browser cannot do alone.
 *
 * Crear una identidad exige la clave de servicio, y esa clave no puede estar en
 * el bundle. El reparto es el que ADR-001 aprobó como «backend confiable
 * mínimo», y tiene exactamente dos pasos:
 *
 *  1. La Edge Function `provision-user` invita a la persona. Verifica el token
 *     del administrador y le pregunta a la base de datos si tiene
 *     `users:create` antes de hacer nada; es lo único para lo que existe.
 *  2. El navegador, **con la sesión del administrador**, llama a
 *     `api.provision_user_profile` con el uid devuelto. Ahí viven el permiso,
 *     la regla de que sólo un superadmin concede roles privilegiados y la
 *     entrada de auditoría con el actor real.
 *
 * Que el paso 2 no ocurra dentro de la función es la decisión importante: una
 * regla de autorización escrita dos veces es una que se queda vieja en una de
 * las dos copias, y la copia que se queda vieja siempre es la que concede de
 * más.
 *
 * ## Por qué el administrador nunca elige la contraseña
 *
 * No hay contraseña que elegir. `inviteUserByEmail` crea la cuenta sin
 * credencial y manda un enlace para que la persona fije la suya. Un
 * administrador que teclea la primera contraseña de un colega conoce una
 * credencial que no es suya, y las contraseñas «temporales» son célebremente
 * permanentes.
 */

import { DEFAULT_PROVISIONED_ROLE, type AuthRole } from '../../lib/authz';
import { observabilityService } from '../observability';
import { currentAccessToken, isAuthAvailable } from './authService';
import { userService, type UserProfile } from './userService';

export interface ProvisionUserInput {
  email: string;
  displayName: string;
  role?: AuthRole;
}

export interface ProvisionUserResult {
  ok: boolean;
  profile?: UserProfile;
  /** Stable reason code when provisioning failed. */
  reason?: string;
  /** Message written for the administrator reading the screen. */
  message?: string;
}

const REASONS: Record<string, string> = {
  email_already_in_use: 'Ya existe una cuenta con ese correo. Búscala en el directorio en lugar de crearla otra vez.',
  invalid_email: 'El correo no tiene un formato válido.',
  invalid_name: 'El nombre debe tener al menos 2 caracteres.',
  forbidden: 'Tu cuenta no tiene permiso para crear usuarios.',
  unauthenticated: 'La sesión expiró. Vuelve a entrar e inténtalo otra vez.',
  not_configured: 'El backend no tiene configurada la clave de servicio para crear cuentas.',
  invite_failed: 'No se pudo enviar la invitación. Revisa la consola de observabilidad.',
};

const explain = (reason: string): { reason: string; message: string } => ({
  reason,
  message: REASONS[reason] ?? 'No se pudo crear la cuenta. Revisa la consola de observabilidad.',
});

const functionsUrl = (name: string): string => {
  const base = ((import.meta.env as Record<string, string | undefined>).VITE_SUPABASE_URL ?? '').trim();
  return `${base.replace(/\/$/, '')}/functions/v1/${name}`;
};

interface InviteResponse {
  ok?: boolean;
  uid?: string;
  error?: string;
  detail?: string;
}

const callProvisionFunction = async (body: Record<string, unknown>): Promise<InviteResponse & { status: number }> => {
  const token = await currentAccessToken();
  if (!token) return { status: 401, error: 'unauthenticated' };
  const response = await fetch(functionsUrl('provision-user'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: ((import.meta.env as Record<string, string | undefined>).VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim(),
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as InviteResponse;
  return { ...payload, status: response.status };
};

/**
 * Create an account and hand it to its owner.
 *
 * El llamante comprueba `users:create` antes de llamar — este módulo no sabe
 * quién pregunta. La aplicación real de la regla está en la Edge Function y en
 * la RPC, que rechazan a un no administrador independientemente de lo que la
 * interfaz permitiera.
 */
export async function provisionUser(input: ProvisionUserInput): Promise<ProvisionUserResult> {
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  const role = input.role ?? DEFAULT_PROVISIONED_ROLE;

  if (!isAuthAvailable()) {
    return {
      ok: false,
      reason: 'backend_unavailable',
      message: 'Sin conexión con Supabase no se pueden crear cuentas. Las altas nunca se guardan solo en este navegador.',
    };
  }
  if (!email.includes('@')) return { ok: false, ...explain('invalid_email') };
  if (displayName.length < 2) return { ok: false, ...explain('invalid_name') };

  try {
    const invited = await callProvisionFunction({
      action: 'invite',
      email,
      displayName,
      redirectTo: `${window.location.origin}/auth`,
    });
    if (!invited.ok || typeof invited.uid !== 'string') {
      const explained = explain(invited.error ?? 'invite_failed');
      observabilityService.recordWarning({
        source: 'user-action',
        title: 'No se pudo crear la cuenta',
        message: explained.message,
        metadata: { email, role, reason: explained.reason, status: String(invited.status), detail: invited.detail ?? '' },
        recoverable: true,
        userVisible: false,
      });
      return { ok: false, ...explained };
    }

    // Segundo paso, con la sesión del administrador: aquí se comprueban el
    // permiso y la regla de roles privilegiados, y aquí queda la auditoría.
    await userService.provisionProfile(invited.uid, role, displayName);

    observabilityService.recordWarning({
      source: 'user-action',
      title: 'Cuenta creada por un administrador',
      message: `Se creó la cuenta ${email} con rol ${role} y se envió la invitación para fijar contraseña.`,
      metadata: { uid: invited.uid, email, role },
      recoverable: true,
      userVisible: false,
    });

    return { ok: true, profile: { uid: invited.uid, email, displayName, role, status: 'active' } };
  } catch (error) {
    const explained = explain('invite_failed');
    observabilityService.reportError(error, {
      source: 'user-action',
      title: 'No se pudo crear la cuenta',
      message: explained.message,
      metadata: { email, role, reason: explained.reason },
      recoverable: true,
      userVisible: false,
    });
    return { ok: false, ...explained };
  }
}

/** Re-send the "set your password" invitation for an existing account. */
export async function resendInvitation(email: string): Promise<boolean> {
  if (!isAuthAvailable()) return false;
  try {
    const result = await callProvisionFunction({ action: 'resend', email: email.trim().toLowerCase(), redirectTo: `${window.location.origin}/auth` });
    return result.ok === true;
  } catch {
    return false;
  }
}
